/**
 * Markiert Listings als stale wenn der Crawler sie seit N Tagen nicht
 * mehr gesehen hat (last_seen < NOW() - N days). Status wechselt von
 * 'active' zu 'archived' (oder was die RPC vorsieht).
 *
 * Bisher lief mark_stale am Ende eines Crawl-Runs, ABER nur wenn ALLE
 * (city, type, subtype)-Tupel durch sind. Mit Watchdog-Cap passiert das
 * fast nie → gelöschte Listings bleiben in der DB als 'active' und der
 * User kriegt 404 beim Klick auf Source-Link.
 *
 * Lösung: separater täglicher Workflow, unabhängig vom Crawl-Status.
 *
 * Aufruf:
 *   npx tsx scripts/run-mark-stale.ts                       # default 7d
 *   STALE_DAYS=5 npx tsx scripts/run-mark-stale.ts          # 5d Cutoff
 *
 * Idempotent: re-run setzt nur neu archivierte Rows.
 */
import { createClient } from "@supabase/supabase-js";

const STALE_DAYS = parseInt(process.env.STALE_DAYS ?? "7", 10);
const SOURCES = ["bazaraki", "index_cy", "cyprus_real_estate"] as const;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log(`mark_stale_listings: stale_days=${STALE_DAYS}, sources=${SOURCES.join(",")}`);
  let total = 0;
  for (const source of SOURCES) {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc("mark_stale_listings", {
      p_stale_days: STALE_DAYS,
      p_source: source,
    });
    const ms = Date.now() - t0;
    if (error) {
      console.error(`  ${source}: RPC-Fehler nach ${ms}ms — ${error.message}`);
      // weitermachen für andere Sources
      continue;
    }
    const n = typeof data === "number" ? data : 0;
    total += n;
    console.log(`  ${source}: ${n} Listings stale-markiert (${ms}ms)`);
  }
  console.log(`Total: ${total} stale-markiert.`);
}

main().catch((e) => {
  console.error("Unerwarteter Fehler:", e);
  process.exit(1);
});
