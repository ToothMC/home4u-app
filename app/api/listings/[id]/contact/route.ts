// POST /api/listings/[id]/contact
// Decrypted Phone+Email für eingeloggte User. Wird vom RevealPhoneButton
// auf der Listing-Detail-Page aufgerufen wenn der User auf "Telefonnummer
// anzeigen" klickt. Anon-Calls geben 401 — UI gated den Button schon
// vorher, das hier ist die Server-side-Sicherung.
//
// Datenschutz: get_listing_contact_decrypted ist auf service_role beschränkt,
// d.h. der Key verlässt nie den Server. Der Endpunkt loggt den Zugriff in
// outreach_log (channel=phone_reveal) als Audit-Spur und für künftige
// Rate-Limits.

import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return Response.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const { data: rpcResult, error: rpcErr } = await supabase.rpc(
    "get_listing_contact_decrypted",
    { p_listing_id: id }
  );
  if (rpcErr) {
    console.error("[listings/contact] decrypt failed", rpcErr);
    return Response.json({ error: "decrypt_failed" }, { status: 500 });
  }
  const c = rpcResult as {
    ok: boolean;
    error?: string;
    phone?: string | null;
    email?: string | null;
    phone_country?: string | null;
  } | null;
  if (!c?.ok) {
    return Response.json(
      { error: c?.error ?? "unknown" },
      { status: c?.error === "listing_not_found" ? 404 : 500 }
    );
  }

  return Response.json({
    phone: c.phone ?? null,
    email: c.email ?? null,
    phone_country: c.phone_country ?? null,
  });
}
