/**
 * Deeplink-Tokens: signed, single-use, kurz-TTL.
 * Für Web↔Telegram-Übergänge mit Intent-Routing.
 */
import { randomBytes } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type DeeplinkDirection = "to_telegram" | "to_web";
export type DeeplinkIntent =
  | "open_match"
  | "review_listing"
  | "view_lead"
  | "login"
  | "open_listing";

export type CreateDeeplinkInput = {
  direction: DeeplinkDirection;
  intent: DeeplinkIntent;
  intentPayload?: Record<string, unknown>;
  userId?: string | null;
  channelIdentityId?: string | null;
  ttlMinutes?: number;
};

export type CreatedDeeplink = {
  token: string;
  expiresAt: string;
};

const DEFAULT_TTL_MINUTES = 15;

/**
 * Erzeugt einen Deeplink-Token (32 hex bytes = 64 chars) und speichert ihn.
 * Caller baut die URL: `/d/<token>` (to_web) oder
 * `t.me/<bot>?start=<token>` (to_telegram).
 */
export async function createDeeplinkToken(
  input: CreateDeeplinkInput
): Promise<CreatedDeeplink | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const token = randomBytes(32).toString("hex");
  const ttl = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();

  const { error } = await supabase.from("deeplink_tokens").insert({
    token,
    direction: input.direction,
    user_id: input.userId ?? null,
    channel_identity_id: input.channelIdentityId ?? null,
    intent: input.intent,
    intent_payload: input.intentPayload ?? {},
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[deeplink] insert failed", error);
    return null;
  }
  return { token, expiresAt };
}

export type ConsumedDeeplink = {
  intent: DeeplinkIntent;
  intentPayload: Record<string, unknown>;
  userId: string | null;
  channelIdentityId: string | null;
};

/**
 * Validiert + verbraucht (markiert used_at) einen Token. Single-use.
 * Liefert null bei expired/missing/already-used.
 */
export async function consumeDeeplinkToken(
  token: string,
  direction: DeeplinkDirection
): Promise<ConsumedDeeplink | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("deeplink_tokens")
    .select("token, intent, intent_payload, user_id, channel_identity_id, expires_at, used_at, direction")
    .eq("token", token)
    .eq("direction", direction)
    .maybeSingle();

  if (error || !data) return null;
  if (data.used_at) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  // Mark used (best-effort race-condition-aware: nur markieren wenn noch null)
  const { error: updErr, count } = await supabase
    .from("deeplink_tokens")
    .update({ used_at: new Date().toISOString() }, { count: "exact" })
    .eq("token", token)
    .is("used_at", null);
  if (updErr || count === 0) return null;

  return {
    intent: data.intent as DeeplinkIntent,
    intentPayload: (data.intent_payload ?? {}) as Record<string, unknown>,
    userId: data.user_id as string | null,
    channelIdentityId: data.channel_identity_id as string | null,
  };
}

/**
 * URL-Builder für Deeplinks.
 */
export function buildWebDeeplinkUrl(token: string, baseUrl?: string): string {
  const base =
    baseUrl ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "https://home4u.ai";
  const url = base.startsWith("http") ? base : `https://${base}`;
  return `${url.replace(/\/$/, "")}/d/${token}`;
}

export function buildTelegramDeeplinkUrl(
  token: string,
  botUsername?: string
): string {
  const u = botUsername ?? process.env.TELEGRAM_BOT_USERNAME;
  if (!u) throw new Error("TELEGRAM_BOT_USERNAME not set");
  return `https://t.me/${u}?start=${token}`;
}
