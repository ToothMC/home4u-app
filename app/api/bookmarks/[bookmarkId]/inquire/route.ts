import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { triggerOutreachForMatch } from "@/lib/listings/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wandelt einen Favoriten in eine Anfrage (CRM-Pipeline-Stufe 2 → 3).
 * Ruft inquire_from_bookmark RPC auf — nutzt die beim Bookmarken gespeicherte
 * search_profile_id und delegiert intern an seeker_request_match.
 *
 * Auth-only. Idempotent: zweiter Klick gibt dasselbe match_id zurück.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ bookmarkId: string }> }
) {
  const { bookmarkId } = await params;
  if (!bookmarkId || !/^[0-9a-f-]{36}$/i.test(bookmarkId)) {
    return Response.json({ error: "invalid_bookmark_id" }, { status: 400 });
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

  const { data, error } = await supabase.rpc("inquire_from_bookmark", {
    p_bookmark_id: bookmarkId,
  });
  if (error) {
    console.error("[bookmarks/inquire] rpc failed", error);
    return Response.json(
      { error: "rpc_failed", detail: error.message },
      { status: 500 }
    );
  }
  const payload = data as {
    ok: boolean;
    match_id?: string;
    error?: string;
  };
  if (!payload.ok) {
    return Response.json({ error: payload.error ?? "unknown" }, { status: 400 });
  }

  // Outreach an den Inserenten — best-effort, blockiert die Response nicht
  // bei Provider-Fehler. Fehler landen in outreach_log mit status='failed'.
  if (payload.match_id) {
    try {
      const outreach = await triggerOutreachForMatch(payload.match_id);
      console.info("[bookmarks/inquire] outreach", outreach);
    } catch (e) {
      console.error("[bookmarks/inquire] outreach threw", e);
    }
  }

  return Response.json({ ok: true, matchId: payload.match_id });
}
