/**
 * pHash-basierter Cluster-Backfill — verbindet Listings die dieselben
 * Cover-Bilder zeigen aber bisher mit unterschiedlichen Preisen als
 * separate canonical-Master existieren.
 *
 * Hintergrund: Variante A entfernte den Preis-Filter aus Signal 1
 * (find_canonical_for_signals) — neue Crawler-Inserate clustern
 * korrekt. Bestehende Listings müssen aber rückwirkend re-evaluiert
 * werden.
 *
 * Strategie: pro Batch alle aktiven canonical-Master ohne canonical_id
 * holen, je listing nach pHash-≤8-Match in image_hashes suchen, beim
 * Treffer canonical_id setzen. Idempotent — nochmal laufen ist no-op.
 *
 * Voraussetzungen (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Aufruf:
 *   npm run backfill:cluster -- --limit 1000
 */
import { createClient } from "@supabase/supabase-js";

type Opts = {
  limit: number;
  source?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Opts {
  const opts: Opts = { limit: 1000, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") opts.limit = Math.max(1, Math.min(10_000, parseInt(argv[++i], 10)));
    else if (a === "--source") opts.source = argv[++i];
    else if (a === "--dry") opts.dryRun = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[backfill-cluster] env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Alle aktiven Listings ohne canonical_id mit cover_phash holen, batchweise
  let q = supabase
    .from("listings")
    .select("id, source, first_seen")
    .eq("status", "active")
    .is("canonical_id", null);
  if (opts.source) q = q.eq("source", opts.source);
  q = q.order("first_seen", { ascending: true }).limit(opts.limit);

  const { data: candidates, error } = await q;
  if (error) {
    console.error("[backfill-cluster] candidate query failed", error);
    process.exit(1);
  }
  if (!candidates || candidates.length === 0) {
    console.log("[backfill-cluster] keine Kandidaten — done");
    return;
  }
  console.log(`[backfill-cluster] ${candidates.length} Kandidaten, model: ${opts.dryRun ? "DRY" : "WRITE"}`);

  let merged = 0;
  let unchanged = 0;
  let errored = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i] as { id: string; source: string };
    // Pro Listing: pHash-Match in image_hashes mit Hamming ≤ 8 suchen,
    // außer Self.
    const { data: matches, error: matchErr } = await supabase.rpc(
      "find_phash_cluster_match",
      { p_listing_id: c.id }
    );
    if (matchErr) {
      console.error(`  [${i + 1}/${candidates.length}] ${c.id.slice(0, 8)} match err: ${matchErr.message}`);
      errored++;
      continue;
    }
    const canonical = matches as string | null;
    if (!canonical || canonical === c.id) {
      unchanged++;
      if ((i + 1) % 100 === 0) {
        console.log(`  progress ${i + 1}/${candidates.length} — merged=${merged} unchanged=${unchanged}`);
      }
      continue;
    }
    if (opts.dryRun) {
      console.log(`  [${i + 1}/${candidates.length}] ${c.id.slice(0, 8)} → ${canonical.slice(0, 8)} (DRY)`);
      merged++;
      continue;
    }
    const { error: updErr } = await supabase
      .from("listings")
      .update({ canonical_id: canonical, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (updErr) {
      console.error(`  [${i + 1}/${candidates.length}] ${c.id.slice(0, 8)} update err: ${updErr.message}`);
      errored++;
      continue;
    }
    merged++;
    if (merged % 50 === 0) {
      console.log(`  progress ${i + 1}/${candidates.length} — merged=${merged} unchanged=${unchanged}`);
    }
  }

  console.log(`\n[backfill-cluster] done.`);
  console.log(`  merged: ${merged}`);
  console.log(`  unchanged: ${unchanged}`);
  console.log(`  errored: ${errored}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
