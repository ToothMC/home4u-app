/**
 * Outreach-Orchestrator: nach erfolgreichem seeker_request_match wird hier
 * der Channel gewählt + Provider-Send angestoßen.
 *
 * Reihenfolge der Channels (heute):
 *   1. Email — wenn contact_email_enc entschlüsselbar
 *   2. Direct-Listing-Owner — wenn source='direct' und owner_user_id gesetzt
 *      (Email an profiles.notification_email oder auth.users.email)
 *   3. WhatsApp via 360dialog — Slice 3b, separater Branch
 *   4. Skip mit Audit (status='skipped', reason='no_contact_data')
 *
 * Idempotency via record_outreach_attempt RPC: pro (match, channel, recipient)
 * max ein Send pro 24h.
 *
 * Best-effort: Outreach-Failure blockiert NICHT die Inquire-Response. User
 * bekommt sein "ok, Anfrage gesendet", auch wenn Mail-Provider grad bockt.
 * Failed-Status im outreach_log triggert späteren Retry-Worker (TODO).
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { buildInquiryBrokerEmail } from "@/lib/email/templates/inquiry-broker";
import {
  hashEmail,
  signActionToken,
  type ActionTokenPayload,
} from "@/lib/listings/action-token";

export type OutreachResult = {
  channel: "email" | "whatsapp" | "skipped";
  status: "sent" | "skipped" | "failed";
  reason?: string;
};

export async function triggerOutreachForMatch(matchId: string): Promise<OutreachResult> {
  const service = createSupabaseServiceClient();
  if (!service) {
    return { channel: "skipped", status: "skipped", reason: "supabase_not_configured" };
  }

  // 1) Match + Listing laden, Decrypt-RPC für Kontakte aufrufen
  const { data: match, error: matchErr } = await service
    .from("matches")
    .select("id, listing_id, search_profile_id")
    .eq("id", matchId)
    .maybeSingle();
  if (matchErr || !match) {
    console.error("[outreach] match load failed", matchErr);
    return { channel: "skipped", status: "skipped", reason: "match_not_found" };
  }

  const { data: listing, error: listingErr } = await service
    .from("listings")
    .select(
      "id, source, status, type, title, price, currency, location_city, location_district, rooms, size_sqm, language, owner_user_id, extracted_data"
    )
    .eq("id", match.listing_id)
    .maybeSingle();
  if (listingErr || !listing) {
    console.error("[outreach] listing load failed", listingErr);
    return { channel: "skipped", status: "skipped", reason: "listing_not_found" };
  }
  if (["rented", "sold", "opted_out", "archived"].includes(listing.status)) {
    return { channel: "skipped", status: "skipped", reason: `listing_${listing.status}` };
  }

  // 2) Email-Kandidat ermitteln
  let email: string | null = null;
  if (listing.source === "direct" && listing.owner_user_id) {
    // Owner-Email aus profiles oder auth.users
    const { data: profile } = await service
      .from("profiles")
      .select("notification_email")
      .eq("id", listing.owner_user_id)
      .maybeSingle();
    email = profile?.notification_email ?? null;
    if (!email) {
      const { data: authUser } = await service.auth.admin.getUserById(listing.owner_user_id);
      email = authUser?.user?.email ?? null;
    }
  } else {
    // Bridge-Listing: decrypt contact_email_enc via service-only RPC
    const { data: contactData } = await service.rpc(
      "get_listing_contact_decrypted",
      { p_listing_id: listing.id }
    );
    const c = contactData as { ok: boolean; email?: string | null } | null;
    if (c?.ok && c.email) {
      email = c.email;
    }
  }

  if (!email) {
    return { channel: "skipped", status: "skipped", reason: "no_email" };
  }

  const recipientHash = await hashEmail(email);

  // 3) Idempotency-Check + log row anlegen
  const { data: attemptData, error: attemptErr } = await service.rpc(
    "record_outreach_attempt",
    {
      p_match_id: matchId,
      p_listing_id: listing.id,
      p_channel: "email",
      p_recipient_hash: recipientHash,
      p_template_key: "inquiry_v1",
      p_language: listing.language ?? "en",
    }
  );
  if (attemptErr) {
    console.error("[outreach] record_outreach_attempt failed", attemptErr);
    return { channel: "email", status: "failed", reason: attemptErr.message };
  }
  const attempt = attemptData as { ok: boolean; already_sent?: boolean; log_id: string };
  if (!attempt?.log_id) {
    return { channel: "email", status: "failed", reason: "no_log_id" };
  }
  if (attempt.already_sent) {
    return { channel: "email", status: "skipped", reason: "already_sent_24h" };
  }

  // 4) Tokens signieren + Mail-Inhalt rendern
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "https://home4u.ai";

  const tokenBase: Omit<ActionTokenPayload, "action"> = {
    match_id: matchId,
    listing_id: listing.id,
    recipient_email_hash: recipientHash,
    log_id: attempt.log_id,
  };

  const [replyToken, markRentedToken, wrongListingToken] = await Promise.all([
    signActionToken({ ...tokenBase, action: "reply" }),
    signActionToken({ ...tokenBase, action: "mark_rented" }),
    signActionToken({ ...tokenBase, action: "wrong_listing" }),
  ]);

  const sourceUrl =
    typeof listing.extracted_data === "object" &&
    listing.extracted_data !== null &&
    "source_url" in listing.extracted_data
      ? (listing.extracted_data as { source_url?: string }).source_url ?? null
      : null;

  const { subject, html, text } = buildInquiryBrokerEmail({
    baseUrl: baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`,
    listingTitle: listing.title,
    listingType: listing.type as "rent" | "sale",
    listingPrice: Number(listing.price),
    listingCurrency: listing.currency ?? "EUR",
    listingCity: listing.location_city,
    listingDistrict: listing.location_district,
    listingRooms: listing.rooms,
    listingSizeSqm: listing.size_sqm,
    listingSourceUrl: sourceUrl,
    seekerNote: null,
    replyToken,
    markRentedToken,
    wrongListingToken,
    language: (listing.language as "en" | "de" | "ru" | "el") ?? "en",
  });

  // 5) Send + log status update
  const sendResult = await sendEmail({
    to: email,
    subject,
    html,
    text,
    tags: [
      { name: "kind", value: "outreach_inquiry" },
      { name: "listing_source", value: listing.source },
    ],
  });

  if (!sendResult.ok) {
    await service.rpc("update_outreach_status", {
      p_log_id: attempt.log_id,
      p_status: sendResult.reason === "not_configured" ? "skipped" : "failed",
      p_error_reason: sendResult.reason === "not_configured"
        ? "resend_not_configured"
        : sendResult.error ?? "send_failed",
    });
    return {
      channel: "email",
      status: sendResult.reason === "not_configured" ? "skipped" : "failed",
      reason: sendResult.reason === "not_configured"
        ? "resend_not_configured"
        : sendResult.error,
    };
  }

  await service.rpc("update_outreach_status", {
    p_log_id: attempt.log_id,
    p_status: "sent",
    p_provider_message_id: sendResult.messageId,
  });

  return { channel: "email", status: "sent" };
}
