/**
 * Telegram-Bot-Webhook für Sophie.
 *
 * Phase 1: synchron-blockierend. Telegram retried bei Webhook-Failure mit
 * Exponential-Backoff; Idempotenz wird über `messages.external_id` unique
 * Constraint sichergestellt.
 *
 * Phase 2 (geplant): Webhook gibt sofort 200, Worker übernimmt Sophie-Run.
 *
 * Setup:
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d url=https://home4u.ai/api/telegram/webhook \
 *     -d secret_token=<TELEGRAM_WEBHOOK_SECRET> \
 *     -d allowed_updates=["message","callback_query"]
 *
 * Env-Vars (siehe lib/telegram/bot.ts):
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET
 *
 * Ohne Env: 503 — wie bei lib/email/send.ts ohne RESEND_API_KEY.
 */
import { NextRequest } from "next/server";
import {
  getTelegramBot,
  getTelegramWebhookSecret,
  telegramConfigured,
} from "@/lib/telegram/bot";
import {
  resolveChannelIdentity,
  markChannelOptedIn,
  markChannelOptedOut,
} from "@/lib/identity/resolve-channel-identity";
import { runSophieBlocking } from "@/lib/sophie/run";
import { TG_TEXT } from "@/lib/telegram/i18n";
import { languagePickerKeyboard, parseCallbackData } from "@/lib/telegram/keyboards";
import { downloadAndStoreTelegramFile } from "@/lib/telegram/media";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { loadLastConversation } from "@/lib/repo/conversations";
import type { Update, Message } from "grammy/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!telegramConfigured()) {
    return jsonResponse({ error: "telegram_not_configured" }, 503);
  }

  // Webhook-Secret-Verify (Telegram setzt diesen Header bei jedem Update,
  // wenn `secret_token` beim setWebhook gesetzt wurde).
  const expectedSecret = getTelegramWebhookSecret();
  if (expectedSecret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== expectedSecret) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  try {
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
    // Andere Update-Typen (edited_message, etc.) ignorieren wir in V1
  } catch (err) {
    console.error("[telegram-webhook] handler threw", err);
    // Trotzdem 200 zurück — Telegram retried sonst aggressiv und wir
    // riskieren dieselbe fehlerhafte Verarbeitung mehrfach.
  }

  return jsonResponse({ ok: true });
}

// ============================================================================
// Message-Handler
// ============================================================================

async function handleMessage(msg: Message): Promise<void> {
  const tgUserId = msg.from?.id;
  if (!tgUserId) return;

  // Identity resolve (oder anlegen). language_code für Sprach-Auto-Detection.
  const identity = await resolveChannelIdentity({
    channel: "telegram",
    externalId: String(tgUserId),
    metadata: {
      tg_username: msg.from?.username,
      language_code: msg.from?.language_code,
      first_name: msg.from?.first_name,
    },
  });
  if (!identity) {
    console.error("[telegram-webhook] resolveChannelIdentity returned null");
    return;
  }

  const text = msg.text ?? msg.caption ?? null;
  const locale = identity.preferredLanguage;

  // === Bot-Commands ==========================================================
  if (text?.startsWith("/")) {
    const [rawCmd, ...args] = text.slice(1).split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    if (cmd === "start") {
      // Reaktivieren falls opted_out
      if (identity.isOptedOut) {
        await markChannelOptedIn(identity.channelIdentityId);
      }
      const payload = args.join(" ").trim();
      const greeting = identity.isNew
        ? TG_TEXT.aiDisclaimer(locale) + "\n\n" + TG_TEXT.reactivated(locale)
        : TG_TEXT.reactivated(locale);
      // Wenn /start <deeplink_token> → Deeplink-Resolution
      if (payload) {
        await handleDeeplinkPayload({
          payload,
          tgChatId: msg.chat.id,
          identity,
          fallbackText: greeting,
        });
        return;
      }
      await sendText(msg.chat.id, greeting);
      return;
    }

    if (cmd === "stop") {
      await markChannelOptedOut(identity.channelIdentityId);
      await sendText(msg.chat.id, TG_TEXT.stopConfirmed(locale));
      return;
    }

    if (cmd === "help") {
      await sendText(msg.chat.id, helpText(locale));
      return;
    }

    if (cmd === "language" || cmd === "sprache") {
      await sendKeyboard(
        msg.chat.id,
        languagePromptText(locale),
        languagePickerKeyboard()
      );
      return;
    }
    // /matches und andere Commands fallen durch und gehen an Sophie
  }

  // Falls User opted-out ist und KEIN /start kam: keine Antwort senden.
  if (identity.isOptedOut) {
    return;
  }

  // === Media (Photo/Document/Voice/Location) ================================
  const mediaUrls: string[] = [];
  let locationLat: number | null = null;
  let locationLng: number | null = null;

  if (msg.photo && msg.photo.length > 0) {
    // Größtes Photo nehmen (letztes im Array hat höchste Auflösung)
    const largest = msg.photo[msg.photo.length - 1];
    const downloaded = await downloadAndStoreTelegramFile({
      fileId: largest.file_id,
      channelIdentityId: identity.channelIdentityId,
      kind: "photo",
    });
    if (downloaded) mediaUrls.push(downloaded.publicUrl);
  }
  if (msg.document) {
    const downloaded = await downloadAndStoreTelegramFile({
      fileId: msg.document.file_id,
      channelIdentityId: identity.channelIdentityId,
      kind: "document",
    });
    if (downloaded) mediaUrls.push(downloaded.publicUrl);
  }
  if (msg.location) {
    locationLat = msg.location.latitude;
    locationLng = msg.location.longitude;
  }

  // === Inbound-Idempotenz ===================================================
  // Telegram retried bei Webhook-Failures. Wir prüfen VOR dem Sophie-Call,
  // ob dieser external_id schon mal verarbeitet wurde — so verbrennen wir
  // bei Retries kein Sonnet-Token und antworten nicht doppelt.
  const supabase = createSupabaseServiceClient();
  const externalId = `${msg.chat.id}:${msg.message_id}`;
  if (supabase) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) {
      console.info("[telegram-webhook] dedup", externalId);
      return;
    }
  }

  // === Sophie blocking ======================================================
  // History aus DB laden, damit Sophie den Konversationsverlauf sieht
  // (sonst hält sie jeden Turn für den ersten und wiederholt den Disclaimer).
  // Plus: alle Photos aus früheren Turns einsammeln, damit Sophie sie auch
  // turn-übergreifend für create_listing / add_photos_to_listing nutzen kann.
  let history: { role: "user" | "assistant"; content: string }[] = [];
  const historyPhotoUrls: string[] = [];
  if (identity.lastConversationId) {
    const loaded = await loadLastConversation({
      anonymousId: identity.anonymousId ?? undefined,
      userId: identity.userId ?? undefined,
    });
    if (loaded) {
      history = loaded.messages
        .filter((m) => m.content && m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));
      for (const m of loaded.messages) {
        if (m.mediaUrls?.length) historyPhotoUrls.push(...m.mediaUrls);
      }
    }
  }

  const userTurn = text
    ? text
    : mediaUrls.length > 0
      ? locale === "de"
        ? `(Der Nutzer hat ${mediaUrls.length} Foto(s) geschickt.)`
        : `(User sent ${mediaUrls.length} photo(s).)`
      : null;

  if (!userTurn) return;

  const sophieMessages: { role: "user" | "assistant"; content: string }[] = [
    ...history,
    { role: "user", content: userTurn },
  ];

  // Alle bisher gesendeten Photos kombiniert (Cross-Turn-Memory) — dedup.
  const allPhotoUrls = Array.from(
    new Set([...historyPhotoUrls, ...mediaUrls])
  );

  const result = await runSophieBlocking({
    channel: "telegram",
    userId: identity.userId ?? undefined,
    anonymousId: identity.anonymousId ?? undefined,
    conversationId: identity.lastConversationId ?? undefined,
    messages: sophieMessages,
    preferredLanguage: locale,
    attachedMedia: allPhotoUrls.map((url, i) => ({
      url,
      kind: "image" as const,
      name: `telegram-${i + 1}`,
    })),
    // run.ts legt die Conversation an + persistiert User+Assistant. Wir
    // ergänzen nur Telegram-spezifische Felder (external_id, media, location)
    // im Update-Schritt unten.
    persistUserTurn: true,
  });

  // === Telegram-spezifische Felder auf den persistierten User-Turn schreiben
  // (run.ts kennt external_id/media/location nicht). Two-Step:
  // 1) jüngsten User-Turn ohne external_id finden
  // 2) den per id updaten (.update().eq("id", …) ist garantiert supported,
  //    .update().order().limit() ist es nicht)
  if (supabase && result.conversationId) {
    const { data: targetRow } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", result.conversationId)
      .eq("role", "user")
      .is("external_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (targetRow?.id) {
      await supabase
        .from("messages")
        .update({
          external_id: externalId,
          media_urls: mediaUrls,
          location_lat: locationLat,
          location_lng: locationLng,
        })
        .eq("id", targetRow.id);
    }
  }

  // === Outbound an Telegram =================================================
  if (result.assistantText) {
    await sendText(msg.chat.id, result.assistantText);
  } else {
    await sendText(msg.chat.id, TG_TEXT.errorGeneric(locale));
  }
}

// ============================================================================
// Callback-Query-Handler (Inline-Button-Clicks)
// ============================================================================

async function handleCallbackQuery(
  cb: NonNullable<Update["callback_query"]>
): Promise<void> {
  const bot = getTelegramBot();
  const data = cb.data ?? "";
  const { action, payload } = parseCallbackData(data);

  // Telegram braucht IMMER ein answerCallbackQuery, sonst zeigt der Client
  // den "Lädt..."-Spinner ewig.
  await bot.api.answerCallbackQuery(cb.id);

  const tgUserId = cb.from.id;
  const identity = await resolveChannelIdentity({
    channel: "telegram",
    externalId: String(tgUserId),
    metadata: { language_code: cb.from.language_code },
  });
  if (!identity || !cb.message) return;
  const locale = identity.preferredLanguage;

  switch (action) {
    case "set_lang": {
      const lang = payload;
      if (!lang || !["de", "en", "ru", "el"].includes(lang)) return;
      const supabase = createSupabaseServiceClient();
      if (supabase && identity.userId) {
        await supabase
          .from("profiles")
          .update({ preferred_language: lang })
          .eq("id", identity.userId);
      }
      await sendText(cb.message.chat.id, TG_TEXT.languageSet(lang));
      return;
    }
    case "match_details":
    case "match_photos":
    case "match_inquire":
    case "bridge_decline": {
      // Phase 1: triggern wir nicht autonom — wir leiten den User in den Web-Chat
      // bzw. Sophie verarbeitet das im nächsten User-Turn.
      // V2: hier direkt Tool-Calls ausführen.
      await sendText(
        cb.message.chat.id,
        actionStubText(action, locale)
      );
      return;
    }
    default:
      console.info("[telegram-webhook] unknown callback action", action);
  }
}

// ============================================================================
// Deeplink-Payload (von /start <token>)
// ============================================================================

async function handleDeeplinkPayload(args: {
  payload: string;
  tgChatId: number;
  identity: NonNullable<Awaited<ReturnType<typeof resolveChannelIdentity>>>;
  fallbackText: string;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    await sendText(args.tgChatId, args.fallbackText);
    return;
  }
  const { data: token } = await supabase
    .from("deeplink_tokens")
    .select("intent, intent_payload, expires_at, used_at")
    .eq("token", args.payload)
    .eq("direction", "to_telegram")
    .maybeSingle();
  if (!token || token.used_at || new Date(token.expires_at) < new Date()) {
    await sendText(args.tgChatId, args.fallbackText);
    return;
  }
  // Mark used
  await supabase
    .from("deeplink_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", args.payload);

  // Intent-spezifische Antwort
  const lang = args.identity.preferredLanguage;
  const ip = (token.intent_payload ?? {}) as Record<string, unknown>;
  if (token.intent === "open_match" && typeof ip.match_id === "string") {
    await sendText(
      args.tgChatId,
      lang === "de"
        ? `Hier ist dein Match: ${ip.match_id}\n(Match-Karten-Rendering kommt in V2)`
        : `Here is your match: ${ip.match_id}\n(Match card rendering coming in V2)`
    );
    return;
  }
  await sendText(args.tgChatId, args.fallbackText);
}

// ============================================================================
// Helpers
// ============================================================================

async function sendText(chatId: number, text: string): Promise<void> {
  const bot = getTelegramBot();
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: undefined });
  } catch (err) {
    console.error("[telegram-webhook] sendMessage failed", err);
  }
}

async function sendKeyboard(
  chatId: number,
  text: string,
  reply_markup: Parameters<
    ReturnType<typeof getTelegramBot>["api"]["sendMessage"]
  >[2] extends infer O
    ? O extends { reply_markup?: infer R }
      ? R
      : never
    : never
): Promise<void> {
  const bot = getTelegramBot();
  try {
    await bot.api.sendMessage(chatId, text, { reply_markup });
  } catch (err) {
    console.error("[telegram-webhook] sendKeyboard failed", err);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function helpText(locale: string | null): string {
  if (locale === "de") {
    return [
      "/start — Konversation starten oder reaktivieren",
      "/matches — aktuelle Treffer anzeigen",
      "/language — Sprache wechseln",
      "/stop — keine Nachrichten mehr",
      "/help — diese Hilfe",
    ].join("\n");
  }
  if (locale === "ru") {
    return [
      "/start — начать или возобновить",
      "/matches — текущие совпадения",
      "/language — сменить язык",
      "/stop — прекратить сообщения",
      "/help — эта справка",
    ].join("\n");
  }
  if (locale === "el") {
    return [
      "/start — ξεκίνημα ή επανενεργοποίηση",
      "/matches — τρέχοντα ταιριάσματα",
      "/language — αλλαγή γλώσσας",
      "/stop — διακοπή μηνυμάτων",
      "/help — αυτή η βοήθεια",
    ].join("\n");
  }
  return [
    "/start — start or resume",
    "/matches — show current matches",
    "/language — change response language",
    "/stop — stop messages",
    "/help — this help",
  ].join("\n");
}

function languagePromptText(locale: string | null): string {
  if (locale === "de") return "In welcher Sprache soll ich antworten?";
  if (locale === "ru") return "На каком языке мне отвечать?";
  if (locale === "el") return "Σε ποια γλώσσα να απαντώ;";
  return "Which language should I reply in?";
}

function actionStubText(action: string, locale: string | null): string {
  if (locale === "de") {
    return `Ich notiere "${action}". Sag mir kurz Bescheid, was du als Nächstes brauchst — oder schreib /matches.`;
  }
  return `Noted "${action}". Tell me what's next — or send /matches.`;
}
