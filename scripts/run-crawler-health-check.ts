/**
 * Crawler-Health-Check
 * ====================
 * Liest crawler_health_snapshot() (Migration 20260506110000) und prüft pro
 * Source zwei harte Schwellen:
 *
 *   - last_seen_max älter als MAX_HOURS_SINCE_SEEN  → fail (Crawler tot)
 *   - seen_24h unter MIN_SEEN_24H                   → fail (Crawler nur partiell)
 *
 * Bei Fail → exit 1 → GitHub-Action rot → Mail. Konkret hätte der Check
 * spätestens am 30.04. ausgelöst, als Bazaraki von 19k/Tag auf <300/Tag
 * eingebrochen ist.
 *
 * Schwellen sind pro Source konfigurierbar (env). Defaults bewusst niedrig,
 * damit ein einzelner partieller Lauf nicht alarmiert — aber zwei in Folge
 * schon.
 */
import { createClient } from "@supabase/supabase-js";

type SourceConfig = {
  source: string;
  minSeen24h: number;
  maxHoursSinceSeen: number;
};

// Defaults: Source-spezifisch. Bazaraki ist mit ~19k das Volumen-Maß.
// INDEX.cy ~20k, CRE ~1k, cy_developer ~100. Schwellen liegen bei ~25-50%
// vom typischen Tagesdurchsatz, damit ein einzelner partieller Lauf reicht
// um den Alarm fern zu halten, zwei in Folge aber zuschlagen.
const SOURCES: SourceConfig[] = [
  { source: "bazaraki", minSeen24h: 5000, maxHoursSinceSeen: 30 },
  { source: "index_cy", minSeen24h: 5000, maxHoursSinceSeen: 30 },
  { source: "cyprus_real_estate", minSeen24h: 200, maxHoursSinceSeen: 30 },
  // cy_developer hat keinen automatischen Crawler — kein Health-Check.
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

type Row = {
  source: string;
  active_count: number;
  stale_count: number;
  seen_24h: number;
  seen_7d: number;
  last_seen_max: string | null;
  hours_since_last_seen: number | null;
};

async function main() {
  const { data, error } = await supabase.rpc("crawler_health_snapshot");
  if (error) {
    console.error("crawler_health_snapshot RPC-Fehler:", error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];
  const byName = new Map(rows.map((r) => [r.source, r]));

  console.log("Crawler-Health-Snapshot:");
  for (const r of rows) {
    console.log(
      `  ${r.source.padEnd(20)} active=${String(r.active_count).padStart(6)} stale=${String(r.stale_count).padStart(6)} seen_24h=${String(r.seen_24h).padStart(6)} seen_7d=${String(r.seen_7d).padStart(6)} last_seen=${r.last_seen_max ?? "—"} (${r.hours_since_last_seen?.toFixed(1) ?? "—"}h)`,
    );
  }

  const failures: string[] = [];
  for (const cfg of SOURCES) {
    const r = byName.get(cfg.source);
    if (!r) {
      failures.push(`${cfg.source}: keine Listings in der DB — Crawler nie gelaufen?`);
      continue;
    }
    if (r.hours_since_last_seen == null || r.hours_since_last_seen > cfg.maxHoursSinceSeen) {
      failures.push(
        `${cfg.source}: letzter last_seen vor ${r.hours_since_last_seen?.toFixed(1) ?? "?"}h (max ${cfg.maxHoursSinceSeen}h) — Crawler steht.`,
      );
    }
    if (r.seen_24h < cfg.minSeen24h) {
      failures.push(
        `${cfg.source}: nur ${r.seen_24h} Listings in 24h gesehen (min ${cfg.minSeen24h}) — Crawler partiell.`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // City-aware Check (Bazaraki)
  // ──────────────────────────────────────────────────────────────────────
  // Source-Aggregat allein hat den 22-Tage-Ausfall von Nicosia/Famagusta
  // nicht erwischt — bazaraki insgesamt war grün, weil Limassol/Paphos
  // weiter crawlten. Hier prüfen wir pro (bazaraki, City) ob in den letzten
  // CITY_MAX_HOURS Stunden ein last_seen registriert wurde.
  //
  // 48h als Schwelle: Workflow läuft 4×/Tag, also alle 6h sollte refresh
  // kommen. 48h ≈ 8 fehlgeschlagene Iterationen — definitiv kein normaler
  // Aussetzer. Bei Fail bekommt man eine Mail VIEL früher als bei 22 Tagen.
  const CITIES = ["Paphos", "Limassol", "Nicosia", "Larnaca", "Famagusta"];
  const CITY_MAX_HOURS = 48;
  console.log(
    `\nCity-aware Check (bazaraki, max ${CITY_MAX_HOURS}h pro City):`,
  );
  // Zwei Stufen, damit der teure top-N Sort über 26k Limassol-Zeilen nicht
  // ins Statement-Timeout läuft (Inzident 2026-05-27, 8s service_role-Limit):
  //   1) schneller Probe-Query mit last_seen-Zeitfenster → Index-Lookup, <1ms
  //   2) nur bei Miss der teure Sort, um das tatsächliche max(last_seen) für
  //      die Fehlermeldung zu finden.
  const cutoffIso = new Date(Date.now() - CITY_MAX_HOURS * 3600_000).toISOString();
  for (const city of CITIES) {
    const { data: fresh, error: probeErr } = await supabase
      .from("listings")
      .select("last_seen")
      .eq("source", "bazaraki")
      .eq("location_city", city)
      .gt("last_seen", cutoffIso)
      .limit(1);
    if (probeErr) {
      failures.push(`bazaraki/${city}: Query-Fehler — ${probeErr.message}`);
      continue;
    }
    if (fresh && fresh.length > 0) {
      const lastSeen = fresh[0].last_seen as string;
      const hoursSince = (Date.now() - new Date(lastSeen).getTime()) / 3600_000;
      console.log(`  ✓ bazaraki/${city.padEnd(10)} last_seen=${lastSeen} (${hoursSince.toFixed(1)}h)`);
      continue;
    }
    // Kein frisches Listing — jetzt teurer Sort für den genauen Wert.
    const { data: stale, error: staleErr } = await supabase
      .from("listings")
      .select("last_seen")
      .eq("source", "bazaraki")
      .eq("location_city", city)
      .order("last_seen", { ascending: false })
      .limit(1);
    if (staleErr) {
      failures.push(`bazaraki/${city}: Query-Fehler — ${staleErr.message}`);
      continue;
    }
    const lastSeen = stale?.[0]?.last_seen ?? null;
    if (!lastSeen) {
      console.log(`  ✗ bazaraki/${city.padEnd(10)} kein Listing in der DB`);
      failures.push(
        `bazaraki/${city}: kein einziges Listing in der DB — Crawler-Pfad kaputt?`,
      );
      continue;
    }
    const hoursSince = (Date.now() - new Date(lastSeen).getTime()) / 3600_000;
    console.log(`  ✗ bazaraki/${city.padEnd(10)} last_seen=${lastSeen} (${hoursSince.toFixed(1)}h)`);
    failures.push(
      `bazaraki/${city}: last_seen vor ${hoursSince.toFixed(1)}h (max ${CITY_MAX_HOURS}h) — diese City wird nicht mehr gecrawlt, obwohl andere Cities frisch sind.`,
    );
  }

  if (failures.length > 0) {
    console.error("\nCrawler-Health-Check FAIL:");
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log("\nCrawler-Health-Check OK.");
}

main().catch((e) => {
  console.error("Unerwarteter Fehler:", e);
  process.exit(1);
});
