/**
 * Channel-Identity-Resolver: findet oder erstellt einen `channel_identities`-
 * Eintrag für eine externe ID (Telegram tg_user_id, Web Session-Cookie).
 *
 * Verbindet wo möglich mit auth.users (per profiles.telegram_user_id Lookup
 * oder bei manueller Verknüpfung). Sonst wird `anonymous_id` gesetzt — wie
 * heute bei Web-Sessions.
 *
 * Rückgabe enthält außerdem die zugehörige `conversation_id` (last open),
 * damit der Telegram-Adapter Sophie nahtlos weiterführt.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ResolveInput = {
  channel: "telegram" | "web" | "email";
  externalId: string; // Telegram: tg_user_id (bigint as string)
  metadata?: Record<string, unknown>;
};

export type ResolvedIdentity = {
  channelIdentityId: string;
  userId: string | null;
  anonymousId: string | null;
  isNew: boolean;
  isOptedOut: boolean;
  /** Letzte conversation_id für diesen Channel — für Sophie-Continuity. */
  lastConversationId: string | null;
  /** profiles.preferred_language wenn user_id verlinkt; sonst metadata.language_code; sonst null */
  preferredLanguage: string | null;
};

export async function resolveChannelIdentity(
  input: ResolveInput
): Promise<ResolvedIdentity | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  // 1) Lookup existing identity
  const { data: existing } = await supabase
    .from("channel_identities")
    .select("id, user_id, anonymous_id, opt_out_at, metadata")
    .eq("channel", input.channel)
    .eq("external_id", input.externalId)
    .maybeSingle();

  if (existing) {
    // last_seen_at + ggf. metadata-Merge
    const mergedMetadata = {
      ...(existing.metadata ?? {}),
      ...(input.metadata ?? {}),
    };
    await supabase
      .from("channel_identities")
      .update({
        last_seen_at: new Date().toISOString(),
        metadata: mergedMetadata,
      })
      .eq("id", existing.id);

    const lastConv = await loadLastConversation({
      supabase,
      channel: input.channel,
      userId: existing.user_id,
      anonymousId: existing.anonymous_id,
    });

    const lang = await loadPreferredLanguage({
      supabase,
      userId: existing.user_id,
      metadata: mergedMetadata,
    });

    return {
      channelIdentityId: existing.id,
      userId: existing.user_id,
      anonymousId: existing.anonymous_id,
      isNew: false,
      isOptedOut: existing.opt_out_at !== null,
      lastConversationId: lastConv,
      preferredLanguage: lang,
    };
  }

  // 2) Fallback-Verknüpfung: bei Telegram über profiles.telegram_user_id
  // (falls jemand das Telegram-Login-Widget nutzte und so user_id↔tg_user_id
  // bereits verlinkt wurde, BEVOR der Bot-Webhook das erste Mal feuert).
  let linkedUserId: string | null = null;
  if (input.channel === "telegram") {
    const tgUserId = parseTelegramUserId(input.externalId);
    if (tgUserId !== null) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("telegram_user_id", tgUserId)
        .maybeSingle();
      if (profile?.id) linkedUserId = profile.id;
    }
  }

  // 3) Anonymous-ID generieren wenn keine User-Verknüpfung
  const anonymousId = linkedUserId ? null : crypto.randomUUID();

  const { data: created, error: createErr } = await supabase
    .from("channel_identities")
    .insert({
      channel: input.channel,
      external_id: input.externalId,
      user_id: linkedUserId,
      anonymous_id: anonymousId,
      verified_at: linkedUserId ? new Date().toISOString() : null,
      opt_in_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (createErr || !created) {
    console.error("[identity] insert failed", createErr);
    return null;
  }

  const lang = await loadPreferredLanguage({
    supabase,
    userId: linkedUserId,
    metadata: input.metadata ?? {},
  });

  return {
    channelIdentityId: created.id,
    userId: linkedUserId,
    anonymousId,
    isNew: true,
    isOptedOut: false,
    lastConversationId: null,
    preferredLanguage: lang,
  };
}

/**
 * Setzt `opt_out_at` auf jetzt. Idempotent.
 */
export async function markChannelOptedOut(
  channelIdentityId: string
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;
  const { error } = await supabase
    .from("channel_identities")
    .update({ opt_out_at: new Date().toISOString() })
    .eq("id", channelIdentityId);
  return !error;
}

/**
 * Setzt `opt_out_at` zurück auf null (Reaktivierung via /start).
 */
export async function markChannelOptedIn(
  channelIdentityId: string
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;
  const { error } = await supabase
    .from("channel_identities")
    .update({
      opt_out_at: null,
      opt_in_at: new Date().toISOString(),
    })
    .eq("id", channelIdentityId);
  return !error;
}

// ============================================================================
// Helpers
// ============================================================================

function parseTelegramUserId(externalId: string): number | null {
  const n = Number(externalId);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

type SupaClient = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

async function loadLastConversation(args: {
  supabase: SupaClient;
  channel: ResolveInput["channel"];
  userId: string | null;
  anonymousId: string | null;
}): Promise<string | null> {
  const q = args.supabase
    .from("conversations")
    .select("id")
    .eq("channel", args.channel)
    .order("updated_at", { ascending: false })
    .limit(1);
  const filtered = args.userId
    ? q.eq("user_id", args.userId)
    : args.anonymousId
      ? q.eq("anonymous_id", args.anonymousId)
      : null;
  if (!filtered) return null;
  const { data } = await filtered.maybeSingle();
  return data?.id ?? null;
}

async function loadPreferredLanguage(args: {
  supabase: SupaClient;
  userId: string | null;
  metadata: Record<string, unknown>;
}): Promise<string | null> {
  if (args.userId) {
    const { data } = await args.supabase
      .from("profiles")
      .select("preferred_language")
      .eq("id", args.userId)
      .maybeSingle();
    if (data?.preferred_language) return data.preferred_language as string;
  }
  const tgLang = args.metadata?.language_code;
  if (typeof tgLang === "string") {
    // Telegram language_code kann z.B. "de", "en", "ru-RU", "el-CY" sein
    const short = tgLang.slice(0, 2).toLowerCase();
    if (["de", "en", "ru", "el"].includes(short)) return short;
  }
  return null;
}
