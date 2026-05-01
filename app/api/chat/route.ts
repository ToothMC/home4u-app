import { NextRequest } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL_SONNET } from "@/lib/anthropic";
import {
  SOPHIE_SYSTEM_PROMPT,
  SOPHIE_PROMPT_VERSION,
} from "@/lib/sophie/system-prompt";
import { SOPHIE_TOOLS } from "@/lib/sophie/tools";
import { executeTool, type ToolContext } from "@/lib/sophie/tool-handlers";
import { getOrCreateAnonymousSession } from "@/lib/session";
import { getAuthUser } from "@/lib/supabase/auth";
import { getPreferredLanguage } from "@/lib/lang/preferred-language";
import {
  appendMessage,
  createConversation,
  logLlmUsage,
} from "@/lib/repo/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const RegionSchema = z
  .object({
    slug: z.string().min(1),
    label: z.string().min(1),
  })
  .optional();

const AttachedMediaSchema = z.object({
  url: z.string().url(),
  kind: z.enum(["image", "video"]),
  name: z.string().max(140),
});

const BodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  flow: z.string().optional(),
  messages: z.array(MessageSchema).min(1).max(40),
  region: RegionSchema,
  attached_media: z.array(AttachedMediaSchema).max(20).optional(),
});

const MAX_TOOL_ROUNDS = 4;

type AnthropicMessage = Anthropic.Messages.MessageParam;

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const json = await req.json();
    body = BodySchema.parse(json);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "invalid_body", detail: String(err) }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  let anthropic;
  try {
    anthropic = getAnthropic();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "missing_api_key", detail: String(err) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const session = await getOrCreateAnonymousSession();
  const authUser = await getAuthUser();
  const preferredLang = (await getPreferredLanguage()) ?? "de";

  // Conversation: weiterführen oder neu anlegen
  let conversationId = body.conversationId;
  if (!conversationId) {
    const created = await createConversation({
      anonymousId: session.anonymousId,
      userId: authUser?.id ?? null,
      flow: body.flow,
      regionSlug: body.region?.slug,
      regionLabel: body.region?.label,
    });
    conversationId = created?.id;
  }

  // Letzte User-Message persistieren (die älteren sind aus dem Client-State)
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  if (conversationId && lastUser) {
    await appendMessage(conversationId, {
      role: "user",
      content: lastUser.content,
    });
  }

  const ctx: ToolContext = {
    anonymousId: session.anonymousId,
    userId: authUser?.id,
    role: authUser?.role ?? null,
    conversationId,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      if (conversationId) {
        send({ type: "conversation", id: conversationId });
      }

      const conversation: AnthropicMessage[] = body.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
        {
          type: "text",
          text: SOPHIE_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ];
      // Rolle-Context: persistierte Rolle (eingeloggte User) oder 'unknown'.
      // Anonyme User mit flow-Query-Param bekommen einen weichen Hint.
      const roleTag = authUser?.role
        ? authUser.role
        : body.flow === "owner"
          ? "owner_intent_anonymous"
          : body.flow === "agent"
            ? "agent_intent_anonymous"
            : body.flow === "seeker"
              ? "seeker_intent_anonymous"
              : "unknown";
      systemBlocks.push({
        type: "text",
        text: `<user_role>${roleTag}</user_role>\nLeite davon ab, welche Tools du nutzen darfst. Bei 'unknown' oder '*_intent_anonymous' setze die Rolle via set_user_role (nur für eingeloggte Nutzer persistent).`,
      });

      // Sprach-Präferenz aus Profil oder Cookie. Sophie soll in dieser
      // Sprache antworten, solange der User nicht in einer anderen schreibt
      // — siehe Sprach-Regeln im SOPHIE_SYSTEM_PROMPT.
      const langName: Record<string, string> = {
        de: "Deutsch",
        en: "English",
        ru: "Русский (Russian)",
        el: "Ελληνικά (Greek)",
        zh: "中文 (Mandarin Chinese, simplified)",
      };
      systemBlocks.push({
        type: "text",
        text: `<user_language>${preferredLang}</user_language>\nDie bevorzugte Sprache des Nutzers ist **${langName[preferredLang] ?? preferredLang}**. Antworte in dieser Sprache, solange der Nutzer nicht aktiv in einer anderen schreibt. Wenn er die Sprache wechselt, wechselst du sofort mit — ohne Kommentar.`,
      });

      if (body.region) {
        systemBlocks.push({
          type: "text",
          text: `<user_context>\nDer Nutzer hat im Landing-Page-Picker die Region "${body.region.label}" (slug: ${body.region.slug}) gewählt. Frage nicht nochmal nach Land/Stadt, arbeite mit dieser Region als Default. Bei Wunsch nach anderer Region darf der Nutzer jederzeit wechseln.\n</user_context>`,
        });
      }
      if (body.attached_media && body.attached_media.length > 0) {
        const mediaList = body.attached_media
          .map(
            (m, i) =>
              `${i + 1}. ${m.kind.toUpperCase()} — ${m.name} — ${m.url}`
          )
          .join("\n");
        systemBlocks.push({
          type: "text",
          text: `<attached_media>\nDer Nutzer hat ${body.attached_media.length} Medien angehängt (in dieser Reihenfolge):\n${mediaList}\n\nNutze diese URLs unverändert im media_urls-Feld, wenn du create_listing aufrufst. Frage den Nutzer nicht nach weiteren Bildern, wenn er bereits welche angehängt hat. Die erste Datei wird als Cover verwendet.\n</attached_media>`,
        });
      }

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const startedAt = Date.now();
          const response = anthropic.messages.stream({
            model: MODEL_SONNET,
            max_tokens: 1024,
            system: systemBlocks,
            tools: SOPHIE_TOOLS,
            messages: conversation,
            metadata: { user_id: `prompt_version=${SOPHIE_PROMPT_VERSION}` },
          });

          for await (const event of response) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send({ type: "text", delta: event.delta.text });
            } else if (event.type === "content_block_start") {
              if (event.content_block.type === "tool_use") {
                send({
                  type: "tool_use_start",
                  name: event.content_block.name,
                  id: event.content_block.id,
                });
              }
            } else if (
              event.type === "content_block_delta" &&
              event.delta.type === "input_json_delta"
            ) {
              send({
                type: "tool_input_delta",
                delta: event.delta.partial_json,
              });
            }
          }

          const finalMessage = await response.finalMessage();
          const latency = Date.now() - startedAt;

          conversation.push({
            role: "assistant",
            content: finalMessage.content,
          });

          // Assistant-Turn persistieren
          const assistantText = finalMessage.content
            .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
          if (conversationId) {
            if (assistantText) {
              await appendMessage(conversationId, {
                role: "assistant",
                content: assistantText,
                usage: finalMessage.usage,
              });
            }
            await logLlmUsage({
              conversationId,
              model: MODEL_SONNET,
              usage: finalMessage.usage,
              latencyMs: latency,
            });
          }

          if (finalMessage.stop_reason !== "tool_use") {
            send({
              type: "done",
              stop_reason: finalMessage.stop_reason,
              usage: finalMessage.usage,
            });
            controller.close();
            return;
          }

          const toolUses = finalMessage.content.filter(
            (block): block is Anthropic.Messages.ToolUseBlock =>
              block.type === "tool_use"
          );

          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            const result = await executeTool(tu.name, tu.input, ctx);
            send({
              type: "tool_result",
              name: tu.name,
              id: tu.id,
              ok: result.ok,
              data: result.data,
              error: result.error,
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
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
              is_error: !result.ok,
            });
          }

          conversation.push({ role: "user", content: toolResults });
        }

        send({
          type: "error",
          message: `Max tool rounds (${MAX_TOOL_ROUNDS}) ohne end_turn erreicht`,
        });
        controller.close();
      } catch (err) {
        send({ type: "error", message: String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
