/**
 * grammY-Setup für den Home4U-Sophie-Bot.
 *
 * Wir nutzen grammY explizit OHNE built-in Polling — Webhook-only Mode.
 * Inbound geht durch /api/telegram/webhook; Outbound nutzt diesen Client.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN              vom @BotFather
 *   TELEGRAM_BOT_USERNAME           ohne @, z.B. "home4u_sophie_bot"
 *   TELEGRAM_WEBHOOK_SECRET         random secret, beim setWebhook gesetzt
 *
 * Ohne Env: getTelegramClient() wirft Telegram_Not_Configured — Caller
 * (Webhook, Outreach) muss das per try/catch graceful behandeln, wie bei
 * lib/email/send.ts mit RESEND_API_KEY.
 */
import { Bot, type RawApi } from "grammy";

let cachedBot: Bot | null = null;

export function telegramConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME
  );
}

export function getTelegramBot(): Bot {
  if (cachedBot) return cachedBot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("telegram_not_configured: TELEGRAM_BOT_TOKEN missing");
  }
  cachedBot = new Bot(token);
  return cachedBot;
}

export function getTelegramApi(): RawApi {
  return getTelegramBot().api.raw;
}

export function getTelegramBotUsername(): string {
  const u = process.env.TELEGRAM_BOT_USERNAME;
  if (!u) {
    throw new Error("telegram_not_configured: TELEGRAM_BOT_USERNAME missing");
  }
  return u;
}

export function getTelegramWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET ?? null;
}
