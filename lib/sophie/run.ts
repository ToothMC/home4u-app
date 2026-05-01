/**
 * Kanal-agnostische Sophie-Loop (Block-Mode).
 *
 * Im Web läuft Sophie heute streaming in `/api/chat/route.ts`. Telegram braucht
 * dagegen Block-Mode: Webhook bekommt 200 OK so schnell wie möglich, Sophie
 * läuft synchron-blockierend bis sie eine Antwort hat, dann sendet der Adapter
 * via `bot.api.sendMessage` zurück.
 *
 * Diese Funktion kapselt:
 *   - System-Prompt + Channel-Context + User-Language
 *   - Tool-Loop (max 4 Rounds)
 *   - Persistenz von User-/Assistant-Messages und Tool-Calls
 *   - LLM-Usage-Logging
 *
 * Sie ist NICHT für Web gedacht (kein Streaming). Web bleibt vorerst auf der
 * eigenen Implementation in /api/chat.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL_SONNET } from "@/lib/anthropic";
import {
  SOPHIE_SYSTEM_PROMPT,
  SOPHIE_PROMPT_VERSION,
} from "@/lib/sophie/system-prompt";
import { SOPHIE_TOOLS } from "@/lib/sophie/tools";
import { executeTool, type ToolContext } from "@/lib/sophie/tool-handlers";
import {
  appendMessage,
  createConversation,
  logLlmUsage,
} from "@/lib/repo/conversations";

export type SophieChannel = "web" | "telegram";

export type SophieRunInput = {
  channel: SophieChannel;
  /** Session-Owner — entweder User oder Anonymous-ID. */
  userId?: string;
  anonymousId?: string;
  role?: ToolContext["role"];

  /** Bestehende Conversation-ID, sonst wird eine neue angelegt. */
  conversationId?: string;

  /** Volle History, die ans Modell geht. Letzte Message MUSS user sein. */
  messages: { role: "user" | "assistant"; content: string }[];

  /** Bevorzugte Sprache (DE/EN/RU/EL/ZH) — Sophie antwortet in dieser. */
  preferredLanguage?: string | null;

  /** Optional: Konversations-Region-Hint (Web Landing-Picker). */
  region?: { slug: string; label: string };

  /** Optional: Anhänge (URLs, Telegram lädt vorher zu Storage). */
  attachedMedia?: { url: string; kind: "image" | "video"; name: string }[];
};

export type SophieToolCallSummary = {
  name: string;
  input: unknown;
  result: { ok: boolean; data?: unknown; error?: string };
};

export type SophieRunResult = {
  conversationId: string | null;
  /** Finaler Assistant-Text (kann mehrere Turns sein, wenn Tools gelaufen sind). */
  assistantText: string;
  /** Alle Tool-Calls in Reihenfolge, damit der Adapter z.B. Inline-Keyboards rendern kann. */
  toolCalls: SophieToolCallSummary[];
  /** Falls Sophie die Max-Rounds erreicht hat ohne `end_turn`. */
  truncated: boolean;
};

const MAX_TOOL_ROUNDS = 4;

const LANG_NAME: Record<string, string> = {
  de: "Deutsch",
  en: "English",
  ru: "Русский (Russian)",
  el: "Ελληνικά (Greek)",
  zh: "中文 (Mandarin Chinese, simplified)",
};

const CHANNEL_CONTEXT_HINT: Record<SophieChannel, string> = {
  web: `Du antwortest auf Kanal: web. Voller Markdown, Tool-Cards, längere Antworten OK.`,
  telegram: `Du antwortest auf Kanal: telegram.
- Plain-Text mit Telegram-Markdown (* fett, _ kursiv) — KEINE Markdown-Tabellen
- Maximal ~1000 Zeichen pro Nachricht
- Buttons rendert der Telegram-Adapter aus deinen Tool-Results (Match-Karten, Quick-Replies)
- Wenn dies die ERSTE Sophie-Nachricht in dieser Konversation ist (keine vorherige assistant-Nachricht im Verlauf), beginne mit einem KI-Disclaimer: "Ich bin Sophie, die KI-Assistentin von Home4U." (in der User-Sprache)`,
};

export async function runSophieBlocking(
  input: SophieRunInput
): Promise<SophieRunResult> {
  const anthropic = getAnthropic();

  // 1) Conversation sicherstellen (anlegen wenn nicht vorhanden)
  let conversationId = input.conversationId ?? null;
  if (!conversationId && input.anonymousId) {
    const created = await createConversation({
      anonymousId: input.anonymousId,
      userId: input.userId ?? null,
      flow: "default",
    });
    conversationId = created?.id ?? null;
    // channel auf telegram updaten falls nötig
    if (conversationId && input.channel !== "web") {
      const { createSupabaseServiceClient } = await import(
        "@/lib/supabase/server"
      );
      const supabase = createSupabaseServiceClient();
      if (supabase) {
        await supabase
          .from("conversations")
          .update({ channel: input.channel })
          .eq("id", conversationId);
      }
    }
  }

  // 2) Letzte User-Message persistieren
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  if (conversationId && lastUser) {
    await appendMessage(conversationId, {
      role: "user",
      content: lastUser.content,
    });
  }

  // 3) System-Prompt zusammenbauen (cacheable + dynamic)
  const lang = input.preferredLanguage ?? "en";
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: SOPHIE_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `<channel_context>\n${CHANNEL_CONTEXT_HINT[input.channel]}\n</channel_context>`,
    },
    {
      type: "text",
      text: `<user_language>${lang}</user_language>\nDie bevorzugte Sprache des Nutzers ist **${LANG_NAME[lang] ?? lang}**. Antworte in dieser Sprache, solange der Nutzer nicht aktiv in einer anderen schreibt.`,
    },
    {
      type: "text",
      text: `<user_role>${input.role ?? "unknown"}</user_role>`,
    },
  ];

  if (input.region) {
    systemBlocks.push({
      type: "text",
      text: `<user_context>\nRegion-Default aus dem Landing-Picker: "${input.region.label}" (slug: ${input.region.slug}).\n</user_context>`,
    });
  }
  if (input.attachedMedia && input.attachedMedia.length > 0) {
    const mediaList = input.attachedMedia
      .map((m, i) => `${i + 1}. ${m.kind.toUpperCase()} — ${m.name} — ${m.url}`)
      .join("\n");
    systemBlocks.push({
      type: "text",
      text: `<attached_media>\n${mediaList}\n</attached_media>`,
    });
  }

  // 4) Tool-Loop
  const ctx: ToolContext = {
    anonymousId: input.anonymousId,
    userId: input.userId,
    role: input.role ?? null,
    conversationId: conversationId ?? undefined,
  };

  const conversation: Anthropic.Messages.MessageParam[] = input.messages.map(
    (m) => ({ role: m.role, content: m.content })
  );

  const collectedText: string[] = [];
  const toolCalls: SophieToolCallSummary[] = [];
  let truncated = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const startedAt = Date.now();
    const response = await anthropic.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1024,
      system: systemBlocks,
      tools: SOPHIE_TOOLS,
      messages: conversation,
      metadata: { user_id: `prompt_version=${SOPHIE_PROMPT_VERSION}` },
    });
    const latency = Date.now() - startedAt;

    conversation.push({ role: "assistant", content: response.content });

    // Persistenz: assistant-Text-Block extrahieren
    const assistantText = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (conversationId) {
      if (assistantText) {
        await appendMessage(conversationId, {
          role: "assistant",
          content: assistantText,
          usage: response.usage,
        });
      }
      await logLlmUsage({
        conversationId,
        model: MODEL_SONNET,
        usage: response.usage,
        latencyMs: latency,
      });
    }

    if (assistantText) collectedText.push(assistantText);

    if (response.stop_reason !== "tool_use") {
      // Fertig
      return {
        conversationId,
        assistantText: collectedText.join("\n").trim(),
        toolCalls,
        truncated: false,
      };
    }

    // Tools ausführen
    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );

    const toolResultsForLlm: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input, ctx);
      toolCalls.push({
        name: tu.name,
        input: tu.input,
        result: { ok: result.ok, data: result.data, error: result.error },
      });
      if (conversationId) {
        await appendMessage(conversationId, {
          role: "tool",
          content: null,
          toolName: tu.name,
          toolInput: tu.input,
          toolResult: result,
        });
      }
      toolResultsForLlm.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }

    conversation.push({ role: "user", content: toolResultsForLlm });

    if (round === MAX_TOOL_ROUNDS - 1) truncated = true;
  }

  return {
    conversationId,
    assistantText: collectedText.join("\n").trim(),
    toolCalls,
    truncated,
  };
}
