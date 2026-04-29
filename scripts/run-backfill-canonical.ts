/**
 * Standalone-Runner für den canonical-Backfill — umgeht den Supabase-
 * Dashboard-Gateway-Timeout (≈60s), indem er die Funktion
 * `backfill_canonical_chunk(p_after_id, p_chunk_size)` aus scripts/
 * backfill-canonical.sql in einer Schleife aufruft.
 *
 * Voraussetzung:
 *   1. scripts/backfill-canonical.sql einmalig im SQL-Editor ausgeführt.
 *   2. .env.local mit NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Aufruf:
 *   node --env-file=.env.local --import tsx scripts/run-backfill-canonical.ts
 *   node --env-file=.env.local --import tsx scripts/run-backfill-canonical.ts --chunk 1000
 *
 * Idempotent: kann jederzeit abgebrochen + neu gestartet werden.
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const chunkSize = (() => {
  const i = args.indexOf("--chunk");
  if (i >= 0 && args[i + 1]) return parseInt(args[i + 1], 10);
  return 500;
})();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

type ChunkResult = {
  processed: number;
  canonicalised: number;
  next_after_id: string | null;
  done: boolean;
};

async function main() {
  console.log(`Starte Backfill mit chunk_size=${chunkSize} …`);
  let afterId: string | null = null;
  let totalProcessed = 0;
  let totalCanonicalised = 0;
  let chunks = 0;
  const started = Date.now();

  while (true) {
    const { data, error } = await supabase.rpc("backfill_canonical_chunk", {
      p_after_id: afterId,
      p_chunk_size: chunkSize,
    });
    if (error) {
      console.error("RPC-Fehler:", error.message);
      process.exit(1);
    }
    const r = data as ChunkResult;
    chunks += 1;
    totalProcessed += r.processed ?? 0;
    totalCanonicalised += r.canonicalised ?? 0;

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `chunk ${chunks}: processed=${r.processed} canonicalised=${r.canonicalised} ` +
        `next=${r.next_after_id?.slice(0, 8) ?? "∅"} | total processed=${totalProcessed}, ` +
        `canonicalised=${totalCanonicalised}, t=${elapsed}s`
    );

    if (r.processed === 0 || r.next_after_id === null) {
      console.log(`\nFERTIG: ${totalProcessed} Listings geprüft, ${totalCanonicalised} canonicalised in ${elapsed}s.`);
      break;
    }
    afterId = r.next_after_id;
  }
}

main().catch((e) => {
  console.error("Unerwarteter Fehler:", e);
  process.exit(1);
});
