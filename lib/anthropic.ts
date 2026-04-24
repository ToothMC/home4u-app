import Anthropic from "@anthropic-ai/sdk";

export const MODEL_SONNET =
  process.env.ANTHROPIC_MODEL_SONNET ?? "claude-sonnet-4-6";
export const MODEL_OPUS =
  process.env.ANTHROPIC_MODEL_OPUS ?? "claude-opus-4-7";
export const MODEL_HAIKU =
  process.env.ANTHROPIC_MODEL_HAIKU ?? "claude-haiku-4-5";

export function getAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY fehlt in der Umgebung. .env.local aus .env.example kopieren."
    );
  }
  return new Anthropic({ apiKey });
}
