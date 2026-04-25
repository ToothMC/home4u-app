import OpenAI from "openai";

export const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY fehlt. .env.local aus .env.example kopieren."
    );
  }
  cached = new OpenAI({ apiKey });
  return cached;
}

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
