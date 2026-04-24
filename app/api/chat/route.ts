import { NextRequest } from "next/server";
import { z } from "zod";
import { getAnthropic, MODEL_SONNET } from "@/lib/anthropic";
import {
  SOPHIE_SYSTEM_PROMPT,
  SOPHIE_PROMPT_VERSION,
} from "@/lib/sophie/system-prompt";
import { SOPHIE_TOOLS } from "@/lib/sophie/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
});

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

  const messages = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const response = anthropic.messages.stream({
          model: MODEL_SONNET,
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: SOPHIE_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: SOPHIE_TOOLS,
          messages,
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
            send({ type: "tool_input_delta", delta: event.delta.partial_json });
          } else if (event.type === "message_delta" && event.usage) {
            send({ type: "usage", usage: event.usage });
          }
        }

        const finalMessage = await response.finalMessage();
        send({
          type: "done",
          stop_reason: finalMessage.stop_reason,
          usage: finalMessage.usage,
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
