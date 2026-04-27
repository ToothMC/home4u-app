// Scam-Score-Worker (Indexer-Spec v2.0 §11 Phase A2).
// Batched über `listings` mit `scam_checked_at IS NULL`, berechnet pHashes,
// schreibt scam_score / scam_flags zurück. Sticky-Pattern: nächster
// bulk_upsert überschreibt nicht, weil scam_checked_at gesetzt ist (0028).
//
// Aufruf:
//   curl -b cookies.txt -X POST 'http://localhost:3000/api/admin/scam-score-batch?limit=25'
//   curl -b cookies.txt -X POST 'http://localhost:3000/api/admin/scam-score-batch?limit=10&source=fb&dry=1'
//
// Cron: GitHub Actions tägl. — solange ungeprüfte Listings da sind, läuft
// der Worker stündlich, bis backlog leer ist.

import { getAuthUser } from "@/lib/supabase/auth";
import { runScoreBatch } from "@/lib/scam/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// pHash + Score läuft pro Listing ~2-5s (sharp + 6 Bilder × Fetch). Bei
// limit=25 brauchen wir mehr als die default-15s. 5min Headroom.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return Response.json({ error: "forbidden", reason: "admin_only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
  const sourceParam = url.searchParams.get("source");
  const source =
    sourceParam === "fb" || sourceParam === "bazaraki" || sourceParam === "direct" || sourceParam === "other"
      ? sourceParam
      : undefined;
  const dryRun = url.searchParams.get("dry") === "1";

  const start = Date.now();
  const result = await runScoreBatch({ limit, source, dryRun });
  const elapsedMs = Date.now() - start;

  return Response.json(
    {
      ...result,
      elapsedMs,
      params: { limit, source, dryRun },
    },
    { status: result.ok ? 200 : 500 }
  );
}
