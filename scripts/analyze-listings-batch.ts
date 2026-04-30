/**
 * Vision-Backfill für Crawler-Listings.
 *
 * Läuft analyzeListing() für eine Charge gefilterter Listings — so werden
 * gecrawlte Inserate (Bazaraki, INDEX, c-r-e) mit Title/Description/Features/
 * room-Tags angereichert. Output: identisch zu Sophies Owner-Trigger-Pipeline,
 * d.h. wenn der ursprüngliche Inserent später auf Home4U registriert, sieht
 * er sein Inserat besser aufbereitet als auf der Quelle (Wow-Effekt).
 *
 * Voraussetzungen (.env.local):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - ANTHROPIC_API_KEY
 *
 * Aufruf:
 *   node --env-file=.env.local --import tsx scripts/analyze-listings-batch.ts \
 *     --limit 20 --filter paphos_houses --model haiku
 *
 *   node --env-file=.env.local --import tsx scripts/analyze-listings-batch.ts \
 *     --ids 9fdfe8a6-...,27829252-...
 *
 * Optionen:
 *   --limit <n>        Anzahl Listings (Default 10)
 *   --filter <name>    Vordefinierter Filter (paphos_houses, all_unanalyzed,
 *                      paphos_villas_3br). Default: all_unanalyzed
 *   --ids <csv>        Statt Filter: explizite Listing-IDs (Komma-getrennt)
 *   --model <m>        haiku | sonnet (Default haiku — günstiger für Backfill)
 *   --concurrency <n>  Parallele Calls (Default 3, max 5)
 *   --dry              Keine DB-Writes (würde nur den Anthropic-Call machen,
 *                      Output zeigen). Achtung: ANTHROPIC_API kostet trotzdem.
 *   --reanalyze        Auch schon analysierte Listings (ai_analyzed_at IS NOT NULL)
 */
import { createClient } from "@supabase/supabase-js";
import { analyzeListing, type AnalyzeModel } from "../lib/listing-analyze/analyze";

type Filter =
  | "paphos_houses"
  | "all_unanalyzed"
  | "paphos_villas_3br"
  | "paphos_rent_houses"
  | "paphos_rent_houses_3br"
  | "paphos_rent_3br_in_budget"
  | "paphos_sale_houses";

type Opts = {
  limit: number;
  filter: Filter;
  ids: string[] | null;
  model: AnalyzeModel;
  concurrency: number;
  dryRun: boolean;
  reanalyze: boolean;
};

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    limit: 10,
    filter: "all_unanalyzed",
    ids: null,
    model: "haiku",
    concurrency: 3,
    dryRun: false,
    reanalyze: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") opts.limit = Math.max(1, Math.min(200, parseInt(argv[++i], 10)));
    else if (a === "--filter") {
      const f = argv[++i];
      const known: Filter[] = [
        "paphos_houses",
        "all_unanalyzed",
        "paphos_villas_3br",
        "paphos_rent_houses",
        "paphos_rent_houses_3br",
        "paphos_rent_3br_in_budget",
        "paphos_sale_houses",
      ];
      if ((known as string[]).includes(f)) {
        opts.filter = f as Filter;
      }
    } else if (a === "--ids") opts.ids = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--model") {
      const m = argv[++i];
      if (m === "haiku" || m === "sonnet") opts.model = m;
    } else if (a === "--concurrency") {
      opts.concurrency = Math.max(1, Math.min(5, parseInt(argv[++i], 10)));
    } else if (a === "--dry") opts.dryRun = true;
    else if (a === "--reanalyze") opts.reanalyze = true;
  }
  return opts;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pickListingIds(supabase: any, opts: Opts): Promise<string[]> {
  if (opts.ids && opts.ids.length > 0) return opts.ids;

  // Nur canonical Listings — Duplikate (canonical_id != id) zeigen wir
  // im Match eh nicht, Vision-Analyse dort wäre verschwendet. PostgREST
  // kann nicht "spalte = andere-spalte" filtern, also holen wir id +
  // canonical_id und filtern in JS.
  let q = supabase
    .from("listings")
    .select("id, canonical_id")
    .eq("status", "active")
    .not("media", "is", null);

  if (!opts.reanalyze) q = q.is("ai_analyzed_at", null);

  if (opts.filter === "paphos_houses") {
    q = q.ilike("location_city", "Paphos%").eq("property_type", "house");
  } else if (opts.filter === "paphos_villas_3br") {
    q = q.ilike("location_city", "Paphos%").eq("property_type", "house").eq("rooms", 3);
  } else if (opts.filter === "paphos_rent_houses") {
    q = q.ilike("location_city", "Paphos%").eq("property_type", "house").eq("type", "rent");
  } else if (opts.filter === "paphos_rent_houses_3br") {
    q = q
      .ilike("location_city", "Paphos%")
      .eq("property_type", "house")
      .eq("type", "rent")
      .eq("rooms", 3);
  } else if (opts.filter === "paphos_sale_houses") {
    q = q.ilike("location_city", "Paphos%").eq("property_type", "house").eq("type", "sale");
  } else if (opts.filter === "paphos_rent_3br_in_budget") {
    // Gesamter Match-Bereich für Mietsuche-Profil 1500-2000 €:
    // Paphos-Region, rent, alle house-Familien (incl. villa/townhouse/bungalow/
    // maisonette/penthouse), 2-4 Zimmer, Preis 1275-2300 €.
    q = q
      .ilike("location_city", "Paphos%")
      .eq("type", "rent")
      .in("property_type", ["house", "villa", "townhouse", "bungalow", "maisonette", "penthouse"])
      .gte("rooms", 2)
      .lte("rooms", 4)
      .gte("price", 1275)
      .lte("price", 2300);
  }

  // Großzügiger fetchen weil wir client-side noch auf canonical + ≥3
  // Bilder filtern. Faktor 3 reicht bei realistischen Daten.
  q = q.order("updated_at", { ascending: false }).limit(opts.limit * 3);

  const { data, error } = await q;
  if (error) throw new Error(`pickListingIds failed: ${error.message}`);

  const ids: string[] = [];
  for (const row of (data ?? []) as Array<{ id: string; canonical_id: string | null }>) {
    if (ids.length >= opts.limit) break;
    // Nur canonical Listings (canonical_id null oder selbstreferenziert).
    if (row.canonical_id !== null && row.canonical_id !== row.id) continue;
    const { data: l } = await supabase
      .from("listings")
      .select("media")
      .eq("id", row.id)
      .maybeSingle();
    const media = ((l as { media: string[] | null } | null)?.media ?? []) as string[];
    const photos = media.filter((u) => /\.(jpe?g|png|webp|heic|avif)(\?|$)/i.test(u));
    if (photos.length >= 3) ids.push(row.id);
  }
  return ids;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[analyze-batch] NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[analyze-batch] ANTHROPIC_API_KEY fehlt");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  console.log("[analyze-batch] opts:", JSON.stringify(opts, null, 2));

  const ids = await pickListingIds(supabase, opts);
  console.log(`[analyze-batch] picked ${ids.length} listing(s)`);
  if (ids.length === 0) {
    console.log("[analyze-batch] nothing to do");
    return;
  }

  if (opts.dryRun) {
    console.log("[analyze-batch] DRY-RUN: would analyze:");
    for (const id of ids) console.log(`  - ${id}`);
    return;
  }

  type R = Awaited<ReturnType<typeof analyzeListing>>;
  const results: R[] = [];
  let inFlight = 0;
  let cursor = 0;
  const startTs = Date.now();

  await new Promise<void>((resolve) => {
    const tick = async () => {
      while (inFlight < opts.concurrency && cursor < ids.length) {
        const id = ids[cursor++];
        inFlight++;
        const i = cursor;
        // Cast: createClient ohne Schema-Generic vs. analyzeListing's typed
        // SupabaseLike — beide laufen gegen dieselbe REST-API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analyzeListing(supabase as any, id, { model: opts.model })
          .then((r) => {
            results.push(r);
            const tag = r.ok ? "ok" : `ERR(${r.error})`;
            const head = r.ok
              ? `features=[${r.features.join(",")}] photos=${r.photos_tagged}`
              : r.detail ?? "";
            console.log(`  [${i}/${ids.length}] ${id.slice(0, 8)} ${tag} ${head}`);
          })
          .catch((e) => {
            results.push({ ok: false, listing_id: id, error: "exception", detail: String(e) });
            console.log(`  [${i}/${ids.length}] ${id.slice(0, 8)} EXC ${e}`);
          })
          .finally(() => {
            inFlight--;
            if (cursor < ids.length || inFlight > 0) tick();
            else resolve();
          });
      }
    };
    tick();
  });

  const ok = results.filter((r): r is Extract<R, { ok: true }> => r.ok);
  const err = results.filter((r): r is Extract<R, { ok: false }> => !r.ok);
  const totalIn = ok.reduce((a, r) => a + r.usage.input_tokens, 0);
  const totalOut = ok.reduce((a, r) => a + r.usage.output_tokens, 0);
  // Haiku 4.5: $0.80/$4.00 per 1M | Sonnet 4.6: $3/$15 per 1M
  const inRate = opts.model === "haiku" ? 0.8 : 3;
  const outRate = opts.model === "haiku" ? 4 : 15;
  const cost = (totalIn * inRate + totalOut * outRate) / 1_000_000;

  console.log(`\n[analyze-batch] done in ${((Date.now() - startTs) / 1000).toFixed(1)}s`);
  console.log(`  ok:    ${ok.length}`);
  console.log(`  err:   ${err.length}`);
  console.log(`  tokens in/out: ${totalIn} / ${totalOut}`);
  console.log(`  cost:  $${cost.toFixed(4)} (${opts.model})`);
  if (err.length > 0) {
    console.log("\n  errors:");
    for (const e of err) console.log(`    ${e.listing_id} → ${e.error} ${e.detail ?? ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
