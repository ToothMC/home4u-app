/**
 * Standalone-Runner für den Scam-Score-Worker (Indexer-Spec v2.0 §11 A2).
 *
 * Läuft `runScoreBatch()` in einer Schleife bis kein scam_checked_at-NULL-
 * Listing mehr da ist (oder bis MAX_BATCHES erreicht). Gibt nach jedem Batch
 * Progress aus.
 *
 * Voraussetzungen (aus .env.local):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Aufruf (Node ≥20.6 für --env-file):
 *   node --env-file=.env.local --import tsx scripts/run-scam-batch.ts
 *   node --env-file=.env.local --import tsx scripts/run-scam-batch.ts --limit 10 --source bazaraki --dry
 *
 * Oder mit npm-Helper "scam:batch" (siehe package.json scripts).
 *
 * Optionen:
 *   --limit <n>     Listings pro Batch (Default 25, max 50)
 *   --source <s>    Nur bestimmte Source (fb|bazaraki|direct|other)
 *   --dry           DryRun: scort, schreibt aber nicht zurück
 *   --max-batches   Sicherheitslimit (Default 100)
 *   --sleep <ms>    Pause zwischen Batches (Default 1000)
 */
import { createClient } from "@supabase/supabase-js";

import { runScoreBatch } from "../lib/scam/worker";

type Opts = {
  limit: number;
  source?: "fb" | "bazaraki" | "direct" | "other";
  dryRun: boolean;
  maxBatches: number;
  sleepMs: number;
};

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    limit: 25,
    dryRun: false,
    maxBatches: 100,
    sleepMs: 1_000,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit") opts.limit = Math.min(50, Math.max(1, Number(argv[++i])));
    else if (arg === "--source") {
      const s = argv[++i];
      if (s === "fb" || s === "bazaraki" || s === "direct" || s === "other") {
        opts.source = s;
      } else {
        console.error(`unknown source '${s}' — ignoriert`);
      }
    } else if (arg === "--dry") opts.dryRun = true;
    else if (arg === "--max-batches") opts.maxBatches = Math.max(1, Number(argv[++i]));
    else if (arg === "--sleep") opts.sleepMs = Math.max(0, Number(argv[++i]));
    else if (arg === "--help" || arg === "-h") {
      console.log(`scripts/run-scam-batch.ts — siehe Datei-Header`);
      process.exit(0);
    } else console.error(`unknown arg: ${arg}`);
  }
  return opts;
}

async function backlogCount(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(url, key);
  const { count, error } = await sb
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .is("scam_checked_at", null);
  if (error) throw new Error(`backlog query failed: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("✗ Fehlende Env: NEXT_PUBLIC_SUPABASE_URL und/oder SUPABASE_SERVICE_ROLE_KEY");
    console.error("  Lege .env.local aus .env.example an.");
    process.exit(1);
  }

  const initial = await backlogCount();
  console.log(`Backlog: ${initial} unscorte aktive Listings${opts.source ? ` (source=${opts.source})` : ""}`);
  console.log(`Optionen: limit=${opts.limit} maxBatches=${opts.maxBatches} sleep=${opts.sleepMs}ms dry=${opts.dryRun}`);
  if (initial === 0) {
    console.log("nichts zu tun.");
    return;
  }

  let totalScored = 0;
  let totalFailed = 0;
  let batches = 0;
  const t0 = Date.now();

  while (batches < opts.maxBatches) {
    batches++;
    const batchStart = Date.now();
    const result = await runScoreBatch({
      limit: opts.limit,
      source: opts.source,
      dryRun: opts.dryRun,
    });
    const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);

    totalScored += result.scored;
    totalFailed += result.failed;

    console.log(
      `  batch ${batches}: scanned=${result.scanned} scored=${result.scored} ` +
        `failed=${result.failed} (${elapsed}s)${result.errors.length ? " errors=" + JSON.stringify(result.errors) : ""}`,
    );

    if (result.scanned === 0) {
      console.log("Backlog leer — fertig.");
      break;
    }
    if (opts.sleepMs > 0 && batches < opts.maxBatches) {
      await new Promise((r) => setTimeout(r, opts.sleepMs));
    }
  }

  const total = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Done: ${batches} batches, ${totalScored} gescort, ${totalFailed} failed in ${total}s`);

  const remaining = await backlogCount();
  console.log(`Remaining backlog: ${remaining}`);
}

main().catch((err) => {
  console.error("crashed:", err);
  process.exit(1);
});
