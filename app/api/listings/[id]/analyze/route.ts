// POST /api/listings/[id]/analyze
// Sophie-Vision-Pipeline für eigene Inserate. Auth: nur Listing-Owner.
// Logik in lib/listing-analyze/analyze.ts (wird auch vom Admin-Batch-Script
// für Crawler-Backfill genutzt).

import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { analyzeListing } from "@/lib/listing-analyze/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return Response.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  // Owner-Check vor der Analyse — sonst könnte jeder fremde Listings auf
  // unsere Kosten neu analysieren lassen.
  const { data: ownerCheck } = await supabase
    .from("listings")
    .select("owner_user_id")
    .eq("id", id)
    .maybeSingle();
  if (!ownerCheck) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (ownerCheck.owner_user_id !== user.id) {
    return Response.json({ error: "not_owner" }, { status: 403 });
  }

  // Owner-Trigger nutzt Sonnet (Top-Qualität). Backfill-Script nutzt Haiku.
  const result = await analyzeListing(supabase, id, { model: "sonnet" });
  if (!result.ok) {
    const status =
      result.error === "not_found" ? 404 :
      result.error === "not_enough_photos" ? 400 :
      result.error === "anthropic_failed" ? 502 :
      500;
    return Response.json(
      { error: result.error, detail: result.detail },
      { status }
    );
  }

  return Response.json({
    ok: true,
    title: result.title,
    photos_tagged: result.photos_tagged,
    pros: result.pros_count,
    cons: result.cons_count,
    features: result.features.length,
    usage: result.usage,
  });
}
