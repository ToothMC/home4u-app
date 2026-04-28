import { NextRequest } from "next/server";
import { createSupabaseServiceClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateAnonymousSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Toggle-Endpoint für Listing-Bookmarks. Ruft die Postgres-RPC
 * toggle_listing_bookmark auf — idempotent, liefert {saved: bool}.
 *
 * - Authenticated: nutzt auth.uid() im RPC, anonymous_id wird ignoriert
 * - Anonymous: anonymous_id Cookie wird durchgereicht
 *
 * Auf Migration via verify-otp ziehen Anon-Bookmarks zum eingeloggten
 * Account (siehe migrate_anonymous_to_user RPC, Migration 0041).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params;
  if (!listingId || !/^[0-9a-f-]{36}$/i.test(listingId)) {
    return Response.json({ error: "invalid_listing_id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const source = typeof body?.source === "string" ? body.source.slice(0, 50) : null;

  // Wenn eingeloggt: server-client mit user-session, RPC sieht auth.uid()
  // Wenn anonym: service-role + anonymous_id, weil RLS nur für authed greift
  let supabase;
  let anonymousId: string | null = null;
  try {
    supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      // Anon-Pfad → service-role-Client
      const sess = await getOrCreateAnonymousSession();
      anonymousId = sess.anonymousId;
      supabase = createSupabaseServiceClient();
      if (!supabase) {
        return Response.json({ error: "supabase_not_configured" }, { status: 500 });
      }
    }
  } catch {
    return Response.json({ error: "supabase_not_configured" }, { status: 500 });
  }

  const { data, error } = await supabase.rpc("toggle_listing_bookmark", {
    p_listing_id: listingId,
    p_anonymous_id: anonymousId,
    p_source: source,
  });
  if (error) {
    console.error("[bookmarks] rpc failed", error);
    return Response.json({ error: "rpc_failed", detail: error.message }, { status: 500 });
  }
  const payload = data as { ok: boolean; saved?: boolean; error?: string };
  if (!payload.ok) {
    return Response.json({ error: payload.error ?? "unknown" }, { status: 400 });
  }
  return Response.json({ ok: true, saved: payload.saved });
}
