import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { SOPHIE_PROMPT_VERSION } from "@/lib/sophie/system-prompt";

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { id: string; name: string; input: string; result?: { ok: boolean; error?: string } }[];
};

export type ConversationInput = {
  anonymousId: string;
  flow?: string;
  regionSlug?: string;
  regionLabel?: string;
};

export type PersistedMessage = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  usage?: unknown;
};

/**
 * Legt eine neue Conversation an. Liefert null wenn Supabase nicht
 * konfiguriert ist — der Caller macht dann einfach keine Persistenz.
 */
export async function createConversation(
  input: ConversationInput
): Promise<{ id: string } | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      anonymous_id: input.anonymousId,
      flow: input.flow ?? "default",
      channel: "web",
      prompt_version: SOPHIE_PROMPT_VERSION,
      region_slug: input.regionSlug,
      region_label: input.regionLabel,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[conversations] insert failed", error);
    return null;
  }
  return { id: data.id };
}

export async function appendMessage(
  conversationId: string,
  message: PersistedMessage
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return;

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    tool_name: message.toolName,
    tool_input: message.toolInput ?? null,
    tool_result: message.toolResult ?? null,
    token_usage: message.usage ?? null,
  });
  if (error) {
    console.error("[conversations] message insert failed", error);
  }
}

export type UsageLike = {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
};

export async function loadLastConversation(params: {
  anonymousId?: string | null;
  userId?: string | null;
}): Promise<{ conversationId: string; messages: HistoryMessage[] } | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;
  if (!params.anonymousId && !params.userId) return null;

  let query = supabase
    .from("conversations")
    .select("id, updated_at, user_id, anonymous_id")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (params.userId && params.anonymousId) {
    query = query.or(
      `user_id.eq.${params.userId},anonymous_id.eq.${params.anonymousId}`
    );
  } else if (params.userId) {
    query = query.eq("user_id", params.userId);
  } else if (params.anonymousId) {
    query = query.eq("anonymous_id", params.anonymousId);
  }

  const { data: conv, error: convErr } = await query.maybeSingle();
  if (convErr || !conv) return null;

  const { data: rows, error: msgErr } = await supabase
    .from("messages")
    .select("role, content, tool_name, tool_input, tool_result, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: true });
  if (msgErr) {
    console.error("[history] messages fetch failed", msgErr);
    return { conversationId: conv.id, messages: [] };
  }

  // Tool-Rows an letzte assistant-Message hängen
  const messages: HistoryMessage[] = [];
  for (const r of rows ?? []) {
    if (r.role === "user") {
      messages.push({ role: "user", content: r.content ?? "" });
    } else if (r.role === "assistant") {
      messages.push({ role: "assistant", content: r.content ?? "" });
    } else if (r.role === "tool") {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        last.toolCalls = last.toolCalls ?? [];
        const result = r.tool_result as { ok?: boolean; error?: string } | null;
        last.toolCalls.push({
          id: `${r.created_at}-${r.tool_name}`,
          name: r.tool_name ?? "tool",
          input: r.tool_input ? JSON.stringify(r.tool_input) : "",
          result: result
            ? { ok: Boolean(result.ok), error: result.error ?? undefined }
            : undefined,
        });
      }
    }
  }

  return { conversationId: conv.id, messages };
}

export async function logLlmUsage(params: {
  conversationId?: string;
  model: string;
  usage: UsageLike | null | undefined;
  latencyMs?: number;
}): Promise<void> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return;
  await supabase.from("llm_usage").insert({
    conversation_id: params.conversationId,
    provider: "anthropic",
    model: params.model,
    input_tokens: params.usage?.input_tokens ?? null,
    cache_creation_tokens: params.usage?.cache_creation_input_tokens ?? null,
    cache_read_tokens: params.usage?.cache_read_input_tokens ?? null,
    output_tokens: params.usage?.output_tokens ?? null,
    latency_ms: params.latencyMs ?? null,
  });
}
