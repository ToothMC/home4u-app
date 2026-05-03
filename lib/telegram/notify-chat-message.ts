/**
 * Telegram-Notification für neue Chat-Nachrichten in einem Match.
 *
 * Eigenständig vom Outreach-Modul: dort geht's um Initial-Anfrage mit
 * 24h-Idempotenz; hier wollen wir pro Nachricht einen Push, ohne 24h-
 * Sperre. Daher OHNE record_outreach_attempt — wir loggen optional, aber
 * skippen den dortigen Idempotency-Check.
 *
 * Best-effort: failt das Telegram-Send, blockiert das die HTTP-Response
 * der POST /messages Route NICHT. Logging only.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getTelegramBot, telegramConfigured } from "@/lib/telegram/bot";
import {
  createDeeplinkToken,
  buildWebDeeplinkUrl,
} from "@/lib/identity/deeplink";

type NotifyArgs = {
  matchId: string;
  recipientUserId: string;
  senderName: string | null;
  preview: string;
};

export async function notifyTelegramOnNewMessage(
  args: NotifyArgs
): Promise<{ ok: boolean; reason?: string }> {
  if (!telegramConfigured()) return { ok: false, reason: "tg_not_configured" };

  const service = createSupabaseServiceClient();
  if (!service) return { ok: false, reason: "supabase_not_configured" };

  // Empfänger-Telegram-Identity laden
  const { data: identity } = await service
    .from("channel_identities")
    .select("id, external_id, opt_out_at")
    .eq("user_id", args.recipientUserId)
    .eq("channel", "telegram")
    .maybeSingle();

  if (!identity || identity.opt_out_at) {
    return { ok: false, reason: "no_telegram_identity" };
  }

  // Empfänger-Profil für Sprache + ob Telegram als Kanal gewünscht
  const { data: profile } = await service
    .from("profiles")
    .select("preferred_language, contact_channel")
    .eq("id", args.recipientUserId)
    .maybeSingle();

  if (profile?.contact_channel && profile.contact_channel !== "telegram") {
    return { ok: false, reason: "channel_not_telegram" };
  }

  const lang = (profile?.preferred_language?.slice(0, 2) ?? "en") as
    | "de"
    | "en"
    | "ru"
    | "el";

  // Deeplink zum Chat
  const deeplink = await createDeeplinkToken({
    direction: "to_web",
    intent: "view_lead",
    intentPayload: { match_id: args.matchId },
    userId: args.recipientUserId,
    channelIdentityId: identity.id,
    ttlMinutes: 60 * 24,
  });
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://home4u.ai";
  const baseUrlNorm = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  const webUrl = deeplink
    ? buildWebDeeplinkUrl(deeplink.token)
    : `${baseUrlNorm}/matches/${args.matchId}`;

  const senderLabel = args.senderName?.trim() || L[lang].someone;
  const previewClipped =
    args.preview.length > 140 ? args.preview.slice(0, 140) + "…" : args.preview;
  const text = [
    `💬 ${L[lang].new_message_from} ${senderLabel}`,
    "",
    previewClipped,
  ].join("\n");

  try {
    const bot = getTelegramBot();
    await bot.api.sendMessage(Number(identity.external_id), text, {
      reply_markup: {
        inline_keyboard: [[{ text: L[lang].open_chat, url: webUrl }]],
      },
    });
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[notify-tg-msg] send failed", reason);
    return { ok: false, reason };
  }
}

const L: Record<
  "en" | "de" | "ru" | "el",
  { new_message_from: string; open_chat: string; someone: string }
> = {
  en: { new_message_from: "New message from", open_chat: "Open chat", someone: "someone" },
  de: { new_message_from: "Neue Nachricht von", open_chat: "Chat öffnen", someone: "jemandem" },
  ru: { new_message_from: "Новое сообщение от", open_chat: "Открыть чат", someone: "кого-то" },
  el: { new_message_from: "Νέο μήνυμα από", open_chat: "Άνοιγμα συνομιλίας", someone: "κάποιον" },
};
