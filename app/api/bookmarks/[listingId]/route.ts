import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Toggle-Endpoint für Listing-Bookmarks. Ruft die Postgres-RPC
 * toggle_listing_bookmark auf — idempotent, liefert {saved: bool}.
 *
 * Favoriten sind auth-only: Ohne eingeloggten User → 401. Anonyme
 * Bookmarks werden nicht (mehr) unterstützt; der RPC akzeptiert
 * weiterhin anonymous_id-Pfad, aber wir geben hier nichts ohne
 * auth.uid() weiter.
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

  const { data, error } = await supabase.rpc("toggle_listing_bookmark", {
    p_listing_id: listingId,
    p_anonymous_id: null,
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
