import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seeker meldet zurück was bei einem Match-Outreach passiert ist.
 * Body: { kind: 'responded'|'rented'|'sold'|'no_answer'|'still_available', listing_id: uuid }
 *
 * Mappt auf apply_listing_report mit reporter_role='seeker'. Vertrauenslogik
 * (1 Seeker → stale, 2+ → rented/sold) liegt im RPC.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  if (!matchId || !/^[0-9a-f-]{36}$/i.test(matchId)) {
    return Response.json({ error: "invalid_match_id" }, { status: 400 });
  }

  let body: { kind?: string; listing_id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const kind = body.kind;
  const listingId = body.listing_id;
  const allowed = ["responded", "rented", "sold", "no_answer", "still_available"];
  if (!kind || !allowed.includes(kind)) {
    return Response.json({ error: "invalid_kind" }, { status: 400 });
  }
  if (!listingId || !/^[0-9a-f-]{36}$/i.test(listingId)) {
    return Response.json({ error: "invalid_listing_id" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ error: "supabase_not_configured" }, { status: 500 });
  }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  // Verifizieren dass der Seeker tatsächlich Teilnehmer dieses Matches ist
  // (Sonst könnte jeder fremde Listings als 'rented' melden.)
  const { data: match, error: matchErr } = await supabase
    .from("matches")
    .select("id, listing_id, search_profile_id")
    .eq("id", matchId)
    .maybeSingle();
  if (matchErr) {
    console.error("[report] match load failed", matchErr);
    return Response.json({ error: "match_load_failed" }, { status: 500 });
  }
  if (!match) {
    return Response.json({ error: "match_not_found" }, { status: 404 });
  }
  if (match.listing_id !== listingId) {
    return Response.json({ error: "listing_mismatch" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("apply_listing_report", {
    p_listing_id: listingId,
    p_kind: kind,
    p_reporter_role: "seeker",
    p_match_id: matchId,
  });
  if (error) {
    console.error("[report] rpc failed", error);
    return Response.json(
      { error: "rpc_failed", detail: error.message },
      { status: 500 }
    );
  }

  return Response.json(data);
}
