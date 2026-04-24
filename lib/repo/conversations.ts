import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { SOPHIE_PROMPT_VERSION } from "@/lib/sophie/system-prompt";

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
