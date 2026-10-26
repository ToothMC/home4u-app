/**
 * Bazaraki-Seitenprüfung: legt gelöschte Inserate verifiziert still.
 *
 * Warum (Befund 2026-10-26): ~34.000 aktive Bazaraki-Inserate haben ein beim
 * Anbieter gelöschtes Titelbild (media_ok=false). Stichprobe: 23 von 25
 * liefern auf Bazaraki 404. Sie wurden nie stale, weil der FAST_MODE-
 * Pre-Touch im Crawler last_seen für ALLE bekannten Inserate auffrischte.
 * Der Pre-Touch lässt sie jetzt aus (bazaraki-crawler/src/supabase_writer.py,
 * is_touchable) — dieses Skript entscheidet stattdessen pro Inserat:
 *
 *   Seite 200            → last_seen auffrischen (lebt nachweislich)
 *   Seite 404/410 + Bild → status='stale' (umkehrbar, ein späterer Upsert
 *                          reaktiviert)
 *   sonst                → nichts (kein Beleg)
 *
 * Regeln und Begründung: scripts/lib/page-check.ts.
 *
 * Schutz:
 *   - Kontrollprobe vorweg: frische Inserate mit intaktem Bild müssen zu
 *     ≥ 80 % 200 liefern, sonst Abbruch ohne Schreiben.
 *   - Blockade-Erkennung: > 50 % unklare Antworten (ab 50) → Abbruch.
 *   - Nur gespeicherte source_url (exakter Slug), kein Raten.
 *
 * Aufruf:
 *   npx tsx scripts/run-bazaraki-page-check.ts
 *   DRY_RUN=1 LIMIT=200 npx tsx scripts/run-bazaraki-page-check.ts
 *
 * Läuft auf dem mac-mini (Residential-IP), als Schritt in media-check-daily.
 */
import { createClient } from "@supabase/supabase-js";
import {
  classifyStatus,
  controlsHealthy,
  decide,
  looksBlocked,
  type PageVerdict,
  type Tally,
} from "./lib/page-check";

const SOURCE = "bazaraki";
const LIMIT = parseInt(process.env.LIMIT ?? "15000", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "2", 10);
// Pause je Worker nach jeder Anfrage. HEAD dauert ~0,25 s, mit 2 Workern
// und 250 ms Pause also ~4 Anfragen/s — höflich, und der Rückstau (~34k)
// ist in ~3 Läufen abgearbeitet.
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS ?? "250", 10);
const MAX_MINUTES = parseFloat(process.env.MAX_MINUTES ?? "50");
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS ?? "15000", 10);
const FLUSH_EVERY = 200;
const DRY_RUN = process.env.DRY_RUN === "1";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

type Candidate = {
  id: string;
  external_id: string;
  source_url: string | null;
  has_media: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** HEAD ohne Redirects zu folgen (liefert bei Bazaraki denselben Status wie GET). */
async function pageStatus(u: string): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u, {
      method: "HEAD",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

function isAdvUrl(u: string | null): u is string {
  return !!u && /^https:\/\/www\.bazaraki\.com\/adv\/\d+_[^/]+\/$/.test(u);
}

function tally(verdicts: PageVerdict[]): Tally {
  const t: Tally = { alive: 0, gone: 0, unknown: 0 };
  for (const v of verdicts) t[v]++;
  return t;
}

async function checkControls(): Promise<void> {
  const { data, error } = await supabase
    .from("listings")
    .select("external_id, source_url:extracted_data->>source_url")
    .eq("source", SOURCE)
    .eq("status", "active")
    // is_share + media: trifft den Teil-Index listings_browse_created_idx,
    // sonst sortiert die Abfrage alle Zeilen und läuft ins 8-s-Limit.
    .eq("is_share", false)
    .not("media", "is", null)
    .eq("media_ok", true)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`Kontrollprobe nicht ladbar: ${error.message}`);
  const urls = ((data ?? []) as { source_url: string | null }[])
    .map((r) => r.source_url)
    .filter(isAdvUrl);
  const verdicts: PageVerdict[] = [];
  for (const u of urls) {
    verdicts.push(classifyStatus(await pageStatus(u)));
    await sleep(INTERVAL_MS);
  }
  const t = tally(verdicts);
  console.log(`Kontrollprobe (frisch, Bild ok): ${urls.length} — 200=${t.alive} 404=${t.gone} unklar=${t.unknown}`);
  if (!controlsHealthy(t)) {
    throw new Error(
      "Kontrollprobe ungesund: frische, lebende Inserate liefern nicht 200. " +
        "URL-Format geändert oder geblockt? Abbruch, nichts geschrieben.",
    );
  }
}

async function flush(stale: string[], touch: string[]) {
  if (DRY_RUN) {
    console.log(`  [dry-run] würde stale=${stale.length} touch=${touch.length} schreiben`);
    return { staled: 0, touched: 0 };
  }
  let staled = 0;
  let touched = 0;
  if (stale.length) {
    const { data, error } = await supabase.rpc("mark_listings_stale_by_ids", {
      p_source: SOURCE,
      p_external_ids: stale,
    });
    if (error) throw new Error(`mark_listings_stale_by_ids: ${error.message}`);
    staled = Number(data ?? 0);
  }
  if (touch.length) {
    const { data, error } = await supabase.rpc("touch_listings_last_seen", {
      p_source: SOURCE,
      p_external_ids: touch,
    });
    if (error) throw new Error(`touch_listings_last_seen: ${error.message}`);
    touched = Number(data ?? 0);
  }
  return { staled, touched };
}

async function main() {
  const t0 = Date.now();
  const deadline = t0 + MAX_MINUTES * 60_000;
  console.log(
    `bazaraki-page-check: limit=${LIMIT} concurrency=${CONCURRENCY} interval=${INTERVAL_MS}ms ` +
      `max=${MAX_MINUTES}min${DRY_RUN ? " DRY_RUN" : ""}`,
  );

  await checkControls();

  const { data, error } = await supabase.rpc("listings_dead_cover_candidates", {
    p_source: SOURCE,
    p_limit: LIMIT,
  });
  if (error) throw new Error(`Kandidaten nicht ladbar: ${error.message}`);
  const candidates = (data ?? []) as Candidate[];
  console.log(`Kandidaten (aktiv, Titelbild gelöscht): ${candidates.length}`);

  const t: Tally = { alive: 0, gone: 0, unknown: 0 };
  let noUrl = 0;
  let goneNoMedia = 0;
  let pendingStale: string[] = [];
  let pendingTouch: string[] = [];
  let totalStaled = 0;
  let totalTouched = 0;
  let checked = 0;
  let next = 0;
  // Objekt statt let: wird in den Worker-Closures gesetzt.
  const stop: { reason: string | null } = { reason: null };
  // Flushes laufen seriell, auch wenn mehrere Worker gleichzeitig auslösen.
  let flushChain: Promise<void> = Promise.resolve();

  const doFlush = () => {
    const s = pendingStale;
    const tc = pendingTouch;
    pendingStale = [];
    pendingTouch = [];
    flushChain = flushChain.then(async () => {
      const r = await flush(s, tc);
      totalStaled += r.staled;
      totalTouched += r.touched;
    });
    return flushChain;
  };

  async function worker() {
    for (;;) {
      if (stop.reason) return;
      if (Date.now() > deadline) {
        stop.reason ??= `Zeitbudget ${MAX_MINUTES} min erreicht`;
        return;
      }
      const i = next++;
      if (i >= candidates.length) return;
      const c = candidates[i];
      if (!isAdvUrl(c.source_url)) {
        noUrl++;
        continue;
      }
      const verdict = classifyStatus(await pageStatus(c.source_url));
      t[verdict]++;
      checked++;
      const action = decide(verdict, c.has_media);
      if (action === "stale") pendingStale.push(c.external_id);
      else if (action === "touch") pendingTouch.push(c.external_id);
      else if (verdict === "gone") goneNoMedia++;

      if (looksBlocked(t)) {
        stop.reason ??= `Blockade-Verdacht: ${t.unknown} von ${checked} Antworten unklar`;
        // Bereits gesammelte Belege verwerfen — bei Blockade traut man
        // auch den letzten Antworten nicht.
        pendingStale = [];
        pendingTouch = [];
        return;
      }
      if (pendingStale.length + pendingTouch.length >= FLUSH_EVERY) await doFlush();
      if (checked % 500 === 0) {
        console.log(
          `  ${checked}/${candidates.length} — 200=${t.alive} 404=${t.gone} unklar=${t.unknown} ` +
            `(${Math.round((Date.now() - t0) / 1000)}s)`,
        );
      }
      await sleep(INTERVAL_MS);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  const blocked = stop.reason?.startsWith("Blockade") ?? false;
  if (!blocked) await doFlush();
  await flushChain;

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(
    `Fertig${DRY_RUN ? " (dry-run)" : ""} in ${mins} min: ${checked} geprüft — ` +
      `lebt (200)=${t.alive}, weg (404)=${t.gone}, unklar=${t.unknown}; ` +
      `stale gesetzt=${totalStaled}, angetippt=${totalTouched}, ` +
      `404 ohne Bild (nicht angefasst)=${goneNoMedia}, ohne URL=${noUrl}` +
      (stop.reason ? ` — Stopp: ${stop.reason}` : ""),
  );
  if (blocked) process.exit(1);
}

main().catch((e) => {
  console.error("Abbruch:", e instanceof Error ? e.message : e);
  process.exit(1);
});
