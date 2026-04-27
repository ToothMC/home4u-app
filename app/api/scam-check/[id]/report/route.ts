// Report-Flow für Scam-Shield (Spec B §9.3 + §15 B4).
//
// Nutzer klickt "Inserat als Scam melden" auf einer Result-Karte. Wir:
//   1) markieren den scam_check als reported (reported_at + reasons[])
//   2) wenn ein Phone im extracted_data hängt → upsert in scam_phones via
//      report_scam_phone-RPC (Migration 0035), source='reported'
//
// Ownership-Check: nur der Submitter (matching user_id ODER anonymous_id)
// darf seinen eigenen Check melden — verhindert Ghost-Reports.

import { getAuthUser } from "@/lib/supabase/auth";
import { getOrCreateAnonymousSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_REASONS = new Set([
  "fake_address",
  "unreliable_provider",
  "stolen_images",
  "money_before_viewing",
  "fake_id_papers",
  "other",
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }

  // Identity wie im Haupt-Endpoint
  const authUser = await getAuthUser();
  const anon = authUser ? null : (await getOrCreateAnonymousSession()).anonymousId;

  let body: { reasons?: unknown };
  try {
    body = (await req.json()) as { reasons?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.map(String).filter((r) => ALLOWED_REASONS.has(r))
    : [];
  if (reasons.length === 0) {
    return Response.json(
      { error: "no_reasons", reason: "Mindestens einen Grund auswählen." },
      { status: 422 },
    );
  }

  const sb = createSupabaseServiceClient();
  if (!sb) return Response.json({ error: "service_unavailable" }, { status: 503 });

  // Lookup + Ownership
  const { data: check, error } = await sb
    .from("scam_checks")
    .select("id, user_id, anonymous_id, similar_listing_ids, reported_at, contact_phone_hash")
    .eq("id", id)
    .maybeSingle();
  if (error || !check) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const ownsCheck =
    (authUser && check.user_id === authUser.id) ||
    (!authUser && anon && check.anonymous_id === anon);
  if (!ownsCheck) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (check.reported_at) {
    return Response.json({ error: "already_reported", reported_at: check.reported_at }, { status: 409 });
  }

  // 1) scam_checks markieren
  const { error: updErr } = await sb
    .from("scam_checks")
    .update({ reported_at: new Date().toISOString(), reported_reasons: reasons })
    .eq("id", id);
  if (updErr) {
    console.error("[scam-report] update failed", updErr);
    return Response.json({ error: "update_failed" }, { status: 500 });
  }

  // 2) Falls Phone bekannt: scam_phones upsert via RPC (Migration 0035 + 0036).
  //    Künftige Submissions mit derselben Phone bekommen +0.40 known_scam_phone.
  const phoneHash = (check as { contact_phone_hash?: string | null }).contact_phone_hash ?? null;
  if (phoneHash) {
    const evidenceListingId =
      Array.isArray(check.similar_listing_ids) && check.similar_listing_ids[0]
        ? (check.similar_listing_ids[0] as string)
        : null;
    const reasonSummary = reasons.join(", ");
    const { error: rpcErr } = await sb.rpc("report_scam_phone", {
      p_phone_hash: phoneHash,
      p_reason: reasonSummary,
      p_reporter_user_id: authUser?.id ?? null,
      p_evidence_listing_id: evidenceListingId,
    });
    if (rpcErr) {
      // Nicht hart failen — der Report selbst ist persistiert. RPC-Fehler
      // bremst nur die Phone-Propagation. Loggen + weiter.
      console.warn("[scam-report] phone propagation failed", rpcErr.message);
    }
  }

  return Response.json({
    ok: true,
    reported_at: new Date().toISOString(),
    phone_propagated: phoneHash !== null,
  });
}
