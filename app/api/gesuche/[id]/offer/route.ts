// POST /api/gesuche/[id]/offer
//
// Owner bietet eines seiner Listings auf ein veröffentlichtes Such-Inserat
// an. Dünner Wrapper über die owner_offer_to_seeker RPC (Migration
// 20260501160000) — alle Validierung + Rate-Limit + Match-Insert passiert
// dort. Hier nur:
//   1. Auth-Check (anonyme Besucher dürfen nicht offer-en)
//   2. Body-Schema validieren
//   3. RPC-Call durchreichen
//   4. Bei Erfolg: Trigger-Mail an Sucher (Resend, best-effort)
import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendOwnerOfferEmail } from "@/lib/email/owner-offer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ listing_id: z.string().uuid() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: profileId } = await params;

  const user = await getAuthUser();
  if (!user) {
    return Response.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "invalid_body", detail: parsed.error.message },
      { status: 400 }
    );
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return Response.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  }

  const { data, error } = await supabase.rpc("owner_offer_to_seeker", {
    p_listing_id: parsed.data.listing_id,
    p_search_profile_id: profileId,
  });
  if (error) {
    console.error("[gesuche/offer] rpc failed", error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  const payload = data as {
    ok: boolean;
    match_id?: string;
    connected?: boolean;
    error?: string;
    detail?: string;
  };
  if (!payload.ok) {
    const status =
      payload.error === "rate_limited" ? 429 :
      payload.error === "listing_not_owned" ? 403 :
      payload.error === "profile_not_public" ? 410 :
      payload.error === "profile_not_active" ? 410 :
      400;
    return Response.json(payload, { status });
  }

  // Trigger-Mail an den Sucher — best-effort, blockiert die Response nicht.
  // sendOwnerOfferEmail enthält die Logik um die echte Email aus
  // auth.users zu ziehen + Template zu rendern. Bei Fehler nur loggen.
  if (payload.match_id) {
    try {
      await sendOwnerOfferEmail({
        matchId: payload.match_id,
        searchProfileId: profileId,
        ownerListingId: parsed.data.listing_id,
        ownerUserId: user.id,
      });
    } catch (e) {
      console.error("[gesuche/offer] email-trigger failed (non-blocking)", e);
    }
  }

  return Response.json({
    ok: true,
    match_id: payload.match_id,
    connected: Boolean(payload.connected),
  });
}
