/**
 * Prüft, ob das Cover-Bild (media[1]) eines aktiven Listings noch erreichbar
 * ist, und schreibt das Ergebnis nach listings.media_ok.
 *
 * Warum das nötig ist (Befund 2026-10-21):
 * Bazaraki löscht die Bilddatei aus dem GCS-Bucket, sobald das Inserat
 * offline geht. GCS antwortet dann mit 403 AccessDenied (nicht 404, weil
 * anonyme Caller nicht listen dürfen). Der Cloudflare-Cache liefert das Bild
 * danach noch tagelang weiter — erst wenn der Edge-Eintrag altert, wird die
 * Karte im /stoebern leer. Stichprobe: 11/20 bazaraki-Cover tot, 4/10
 * index.cy (dort nginx-500 am Origin, CDN-Spiegel haben die Datei nicht).
 *
 * Das tote Bild ist dabei nur das Symptom — bei bazaraki korreliert es mit
 * "Inserat existiert nicht mehr". mark_stale_listings greift nicht, weil der
 * Crawler last_seen hochzählt, ohne die Existenz zu prüfen.
 *
 * Aufruf:
 *   npx tsx scripts/run-media-check.ts                  # 5000 Listings
 *   LIMIT=50000 CONCURRENCY=8 npx tsx scripts/run-media-check.ts
 *   SOURCE=bazaraki npx tsx scripts/run-media-check.ts  # nur eine Quelle
 *   RECHECK_DAYS=30 npx tsx scripts/run-media-check.ts  # Geprüfte auffrischen
 *
 * Idempotent: nimmt sich immer die am längsten nicht geprüften zuerst
 * (media_checked_at NULLS FIRST), ein Abbruch kostet also nur den
 * angefangenen Batch.
 */
import { createClient } from "@supabase/supabase-js";

const LIMIT = parseInt(process.env.LIMIT ?? "5000", 10);
const BATCH = parseInt(process.env.BATCH ?? "250", 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "6", 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS ?? "15000", 10);
const RECHECK_DAYS = parseInt(process.env.RECHECK_DAYS ?? "0", 10);
const SOURCE = process.env.SOURCE ?? null;
const DRY_RUN = process.env.DRY_RUN === "1";

/**
 * Reissleine. Dieses Skript kann den halben Katalog unsichtbar machen, und
 * der haeufigste Grund fuer "alles tot" ist nicht, dass alles tot ist,
 * sondern dass uns jemand blockt: cdn1.bazaraki.com liegt hinter Cloudflare,
 * und CF sperrt Datacenter-IPs gern pauschal aus (deshalb laeuft der Job auf
 * dem mac-mini-Runner mit Cyta-Residential-IP und nicht auf ubuntu-latest).
 * Wenn ein Host fast nur noch Fehler liefert, ist die Annahme "wir sind
 * geblockt" wahrscheinlicher als "alle Bilder geloescht" — dann lieber hart
 * abbrechen und einen Menschen draufschauen lassen.
 */
const ABORT_DEAD_PCT = parseInt(process.env.ABORT_DEAD_PCT ?? "95", 10);
const ABORT_MIN_SAMPLE = parseInt(process.env.ABORT_MIN_SAMPLE ?? "50", 10);
/**
 * Entscheidendes Unterscheidungsmerkmal zwischen "geblockt" und "wirklich
 * kaputt": eine Blockade laesst praktisch NICHTS durch. Solange ein
 * nennenswerter Anteil 200 liefert, reden wir mit dem echten Origin und die
 * Ausfaelle sind echt.
 *
 * Erster Trockenlauf 2026-10-21 lief mit 85% ohne diese Bedingung in einen
 * Fehlalarm: index.cy kam auf 87,9% tot bei 58 Proben — aber mit 7 sauberen
 * 200ern, und eine Messung von einer zweiten Leitung hatte 63% bestaetigt.
 */
const ABORT_MAX_OK_PCT = parseInt(process.env.ABORT_MAX_OK_PCT ?? "3", 10);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// Echter Browser-UA: manche Origins (index.cy) antworten Bots anders als
// Browsern, und wir wollen messen was der User sieht, nicht was ein
// Scraper sieht.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

type Row = { id: string; media: string[] | null };
type Verdict = "ok" | "dead" | "unknown";

/**
 * HEAD liefert bei allen drei Quellen denselben Status wie GET (geprüft),
 * spart aber den Body — bei 200k Bildern der Unterschied zwischen ein paar
 * MB und ein paar GB Traffic.
 *
 * "unknown" ist bewusst eine eigene Kategorie: Timeouts, DNS-Fehler und 5xx
 * bei sonst gesunden Hosts dürfen kein Listing ausblenden. Die bleiben
 * media_ok=NULL und werden beim nächsten Lauf erneut versucht.
 */
async function checkOne(u: string): Promise<Verdict> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "image/avif,image/webp,*/*" },
    });
    if (res.ok) return "ok";
    // 403 = GCS-Objekt gelöscht (Bazaraki), 404/410 = weg, 500 = Origin
    // liefert die Datei nicht mehr aus (index.cy). Alle drei bedeuten für
    // den User: graue Fläche.
    if ([403, 404, 410, 451, 500].includes(res.status)) return "dead";
    // 429/503 = Rate-Limit oder kurzzeitig überlastet → nicht bewerten.
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

type HostStat = { ok: number; dead: number; unknown: number };
const hostStats = new Map<string, HostStat>();

function note(host: string, verdict: Verdict) {
  const s = hostStats.get(host) ?? { ok: 0, dead: 0, unknown: 0 };
  s[verdict]++;
  hostStats.set(host, s);
}

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return "invalid";
  }
}

async function runPool(rows: Row[]): Promise<{ ok: string[]; dead: string[]; unknown: number }> {
  const ok: string[] = [];
  const dead: string[] = [];
  let unknown = 0;
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      const row = rows[i];
      const cover = row.media?.[0];
      if (!cover) {
        // Kein Cover trotz media IS NOT NULL — leeres Array. Zeigt im
        // Grid ohnehin nichts, also raus.
        dead.push(row.id);
        note("(kein cover)", "dead");
        continue;
      }
      const verdict = await checkOne(cover);
      note(hostOf(cover), verdict);
      if (verdict === "ok") ok.push(row.id);
      else if (verdict === "dead") dead.push(row.id);
      else unknown++;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker),
  );
  return { ok, dead, unknown };
}

/** Wirft, wenn ein Host so flaechendeckend ausfaellt, dass Blockade wahrscheinlicher ist als Loeschung. */
function assertPlausible() {
  for (const [host, s] of hostStats) {
    const judged = s.ok + s.dead;
    if (judged < ABORT_MIN_SAMPLE) continue;
    const deadPct = (s.dead / judged) * 100;
    const okPct = (s.ok / judged) * 100;
    if (deadPct >= ABORT_DEAD_PCT && okPct <= ABORT_MAX_OK_PCT) {
      throw new Error(
        `${host}: ${deadPct.toFixed(1)}% tot bei ${judged} Proben, nur ${s.ok} erfolgreich ` +
          `(Schwelle ${ABORT_DEAD_PCT}% tot UND <=${ABORT_MAX_OK_PCT}% ok). ` +
          `So sieht eine Blockade aus, nicht geloeschte Bilder — Abbruch, nichts geschrieben. ` +
          `Von Hand pruefen: curl -I <cover-url> vom selben Runner.`,
      );
    }
  }
}

function printHostStats() {
  console.log("  pro Host:");
  for (const [host, s] of [...hostStats].sort((a, b) => b[1].ok + b[1].dead - a[1].ok - a[1].dead)) {
    const judged = s.ok + s.dead;
    const pct = judged > 0 ? ((s.dead / judged) * 100).toFixed(1) : "0.0";
    console.log(`    ${host.padEnd(28)} ok=${s.ok} tot=${s.dead} (${pct}%) unklar=${s.unknown}`);
  }
}

async function fetchBatch(size: number, offset: number): Promise<Row[]> {
  let q = supabase
    .from("listings")
    .select("id, media")
    .eq("status", "active")
    .not("media", "is", null);

  if (SOURCE) q = q.eq("source", SOURCE);

  if (RECHECK_DAYS > 0) {
    const cutoff = new Date(Date.now() - RECHECK_DAYS * 86400_000).toISOString();
    q = q.or(`media_checked_at.is.null,media_checked_at.lt.${cutoff}`);
  } else {
    q = q.is("media_checked_at", null);
  }

  q = q.order("media_checked_at", { ascending: true, nullsFirst: true });

  // Im Normalbetrieb raeumt jeder Batch sich selbst ab (media_checked_at
  // wird gesetzt), die naechste Abfrage liefert also automatisch die
  // naechsten. Im Trockenlauf schreiben wir nichts — da muessen wir per
  // Offset blaettern, sonst pruefen wir ewig dieselben Zeilen.
  const { data, error } = DRY_RUN
    ? await q.range(offset, offset + size - 1)
    : await q.limit(size);

  if (error) throw new Error(`Batch-Query fehlgeschlagen: ${error.message}`);
  return (data ?? []) as Row[];
}

async function main() {
  console.log(
    `media-check: limit=${LIMIT} batch=${BATCH} concurrency=${CONCURRENCY}` +
      `${SOURCE ? ` source=${SOURCE}` : ""}${RECHECK_DAYS ? ` recheck=${RECHECK_DAYS}d` : ""}`,
  );

  const t0 = Date.now();
  let seen = 0;
  let totalOk = 0;
  let totalDead = 0;
  let totalUnknown = 0;

  while (seen < LIMIT) {
    const rows = await fetchBatch(Math.min(BATCH, LIMIT - seen), seen);
    if (rows.length === 0) {
      console.log("Keine ungeprüften Listings mehr — fertig.");
      break;
    }

    const { ok, dead, unknown } = await runPool(rows);

    // Erst Plausibilitaet, dann schreiben — ein geblockter Runner darf
    // keine Zeile anfassen.
    assertPlausible();

    if (DRY_RUN) {
      console.log(`  [dry-run] wuerde ok=${ok.length} tot=${dead.length} schreiben`);
    } else {
      const { error } = await supabase.rpc("set_media_check_results", {
        p_ok: ok,
        p_dead: dead,
      });
      if (error) throw new Error(`Schreiben fehlgeschlagen: ${error.message}`);
    }

    seen += rows.length;
    totalOk += ok.length;
    totalDead += dead.length;
    totalUnknown += unknown;

    const pct = totalOk + totalDead > 0
      ? ((totalDead / (totalOk + totalDead)) * 100).toFixed(1)
      : "0.0";
    console.log(
      `  ${seen}/${LIMIT} geprüft — ok=${totalOk} tot=${totalDead} (${pct}%) ` +
        `unklar=${totalUnknown} — ${Math.round((Date.now() - t0) / 1000)}s`,
    );
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(
    `Fertig${DRY_RUN ? " (dry-run, nichts geschrieben)" : ""}: ${seen} geprüft in ${mins} min — ` +
      `ok=${totalOk} tot=${totalDead} unklar=${totalUnknown}`,
  );
  printHostStats();
}

main().catch((e) => {
  console.error("Unerwarteter Fehler:", e);
  process.exit(1);
});
