/**
 * Outreach-Orchestrator: nach erfolgreichem seeker_request_match wird hier
 * der Channel gewählt + Provider-Send angestoßen.
 *
 * Reihenfolge der Channels (Phase 1 — Telegram-first):
 *   1. Telegram — wenn Owner ein verified+opted-in channel_identities-Eintrag
 *      hat (preferred_channel='telegram' ODER explizit verifiziert).
 *      Sophie generiert Bridge-Outreach in Owner-Sprache, Send via grammY.
 *   2. Email — Fallback: contact_email_enc entschlüsselt (bridge listings)
 *      ODER profiles.notification_email/auth.users.email (direct).
 *   3. Skip mit Audit (status='skipped', reason='no_contact_data').
 *
 * Idempotency via record_outreach_attempt RPC: pro (match, channel, recipient)
 * max ein Send pro 24h.
 *
 * Best-effort: Outreach-Failure blockiert NICHT die Inquire-Response. User
 * bekommt sein "ok, Anfrage gesendet", auch wenn Provider grad bockt.
 */
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { buildInquiryBrokerEmail } from "@/lib/email/templates/inquiry-broker";
import {
  hashEmail,
  signActionToken,
  type ActionTokenPayload,
} from "@/lib/listings/action-token";
import { getTelegramBot, telegramConfigured } from "@/lib/telegram/bot";
import { bridgeOutreachKeyboard } from "@/lib/telegram/keyboards";
import {
  createDeeplinkToken,
  buildWebDeeplinkUrl,
} from "@/lib/identity/deeplink";
import { translate } from "@/lib/translation/translate";
import type { Lang } from "@/lib/translation/glossary";

export type OutreachResult = {
  channel: "telegram" | "email" | "whatsapp" | "skipped";
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

  // 1.5) Telegram-Pfad zuerst probieren — wenn Owner verifizierte
  // Telegram-Identity hat und nicht opted-out, geht der Outreach dorthin
  // statt per Email. Owner-Sprache aus profiles.preferred_language.
  if (listing.owner_user_id && telegramConfigured()) {
    const tg = await tryTelegramOutreach({
      service,
      matchId,
      listing,
    });
    if (tg) return tg;
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

  const [replyToken, markReservedToken, markRentedToken, wrongListingToken] =
    await Promise.all([
      signActionToken({ ...tokenBase, action: "reply" }),
      signActionToken({ ...tokenBase, action: "mark_reserved" }),
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
    markReservedToken,
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

// ============================================================================
// Telegram-Outreach (Phase 1)
// ============================================================================

const ALLOWED_LANGS: readonly Lang[] = ["de", "en", "ru", "el"] as const;

type ServiceClient = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;
type ListingRow = {
  id: string;
  source: string;
  status: string;
  type: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  location_city: string;
  location_district: string | null;
  rooms: number | null;
  size_sqm: number | null;
  language: string | null;
  owner_user_id: string | null;
  extracted_data: unknown;
};

async function tryTelegramOutreach(args: {
  service: ServiceClient;
  matchId: string;
  listing: ListingRow;
}): Promise<OutreachResult | null> {
  const { service, matchId, listing } = args;
  if (!listing.owner_user_id) return null;

  // Owner-Telegram-Identity laden
  const { data: identity } = await service
    .from("channel_identities")
    .select("id, external_id, opt_out_at, verified_at")
    .eq("user_id", listing.owner_user_id)
    .eq("channel", "telegram")
    .maybeSingle();

  if (!identity || identity.opt_out_at) {
    return null; // Kein Telegram für diesen Owner — fall back to email
  }

  // Owner-Profil für preferred_language + contact_channel
  const { data: profile } = await service
    .from("profiles")
    .select("preferred_language, contact_channel, display_name")
    .eq("id", listing.owner_user_id)
    .maybeSingle();

  // Wenn der Owner explizit NICHT Telegram als Kanal will, abbrechen.
  // contact_channel kann 'email','whatsapp','telegram','phone','chat' sein.
  // Wir nehmen Telegram nur, wenn explizit 'telegram' ODER nicht gesetzt
  // (in dem Fall ist die verifizierte Telegram-Identity das stärkere Signal).
  if (profile?.contact_channel && profile.contact_channel !== "telegram") {
    return null;
  }

  const ownerLang = normalizeLang(profile?.preferred_language) ?? "en";
  const ownerName = profile?.display_name ?? null;

  // Idempotency-Check
  const recipientHash = hashTelegramId(identity.external_id);
  const { data: attemptData, error: attemptErr } = await service.rpc(
    "record_outreach_attempt",
    {
      p_match_id: matchId,
      p_listing_id: listing.id,
      p_channel: "telegram",
      p_recipient_hash: recipientHash,
      p_template_key: "bridge_outreach_v1",
      p_language: ownerLang,
    }
  );
  if (attemptErr) {
    console.error("[outreach-tg] record_outreach_attempt failed", attemptErr);
    return { channel: "telegram", status: "failed", reason: attemptErr.message };
  }
  const attempt = attemptData as {
    ok: boolean;
    already_sent?: boolean;
    log_id: string;
  };
  if (!attempt?.log_id) {
    return { channel: "telegram", status: "failed", reason: "no_log_id" };
  }
  if (attempt.already_sent) {
    return { channel: "telegram", status: "skipped", reason: "already_sent_24h" };
  }

  // Deeplink für "Lead ansehen"-Button generieren
  const deeplink = await createDeeplinkToken({
    direction: "to_web",
    intent: "view_lead",
    intentPayload: { match_id: matchId, listing_id: listing.id },
    userId: listing.owner_user_id,
    channelIdentityId: identity.id,
    ttlMinutes: 60 * 24, // 24h für Lead-Button — länger als Login-Tokens
  });
  const webUrl = deeplink ? buildWebDeeplinkUrl(deeplink.token) : "https://home4u.ai/dashboard/requests";

  // Bridge-Outreach-Text in Owner-Sprache
  const text = await renderBridgeOutreachText({
    listing,
    ownerLang,
    ownerName,
  });

  // Inline-Keyboard
  const keyboard = bridgeOutreachKeyboard({
    matchId,
    webUrl,
    locale: ownerLang,
  });

  // Send via grammY
  try {
    const bot = getTelegramBot();
    const sent = await bot.api.sendMessage(Number(identity.external_id), text, {
      reply_markup: keyboard,
      parse_mode: undefined,
    });
    await service.rpc("update_outreach_status", {
      p_log_id: attempt.log_id,
      p_status: "sent",
      p_provider_message_id: String(sent.message_id),
    });
    return { channel: "telegram", status: "sent" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[outreach-tg] send failed", reason);
    await service.rpc("update_outreach_status", {
      p_log_id: attempt.log_id,
      p_status: "failed",
      p_error_reason: reason,
    });
    // Bei Telegram-Send-Fehler NICHT zu Email fallen — sonst doppelter Outreach
    // bei kurzfristiger Telegram-API-Macke. Operator kann manuell retriggern.
    return { channel: "telegram", status: "failed", reason };
  }
}

async function renderBridgeOutreachText(args: {
  listing: ListingRow;
  ownerLang: Lang;
  ownerName: string | null;
}): Promise<string> {
  const { listing, ownerLang, ownerName } = args;
  const greeting = ownerName ?? (ownerLang === "de" ? "Hi" : "Hi");

  // Plain-Text-Template auf Englisch — wird unten in Owner-Sprache übersetzt
  const titlePart = listing.title ?? `${listing.rooms ?? "?"}-bedroom`;
  const cityPart = listing.location_district
    ? `${listing.location_city}, ${listing.location_district}`
    : listing.location_city;
  const pricePart =
    listing.price !== null
      ? ` · ${listing.price} ${listing.currency ?? "EUR"}`
      : "";

  const enText = [
    `${greeting}, this is Sophie from Home4U.`,
    `A pre-qualified seeker is interested in your listing: ${titlePart} in ${cityPart}${pricePart}.`,
    `Would you like to see the seeker's profile and decide whether to connect?`,
  ].join("\n\n");

  // Falls Owner-Sprache != en, übersetzen.
  if (ownerLang === "en") return enText;

  try {
    const out = await translate({
      text: enText,
      source_lang: "en",
      target_langs: [ownerLang],
      context: "chat",
    });
    return out.translations[ownerLang] ?? enText;
  } catch (err) {
    console.warn("[outreach-tg] translation failed, using EN", err);
    return enText;
  }
}

function hashTelegramId(externalId: string): string {
  return createHash("sha256").update(`telegram:${externalId}`).digest("hex");
}

function normalizeLang(s?: string | null): Lang | null {
  if (!s) return null;
  const short = s.slice(0, 2).toLowerCase();
  return ALLOWED_LANGS.includes(short as Lang) ? (short as Lang) : null;
}
