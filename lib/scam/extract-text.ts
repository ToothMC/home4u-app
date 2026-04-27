/**
 * Text-Extraktion für Scam-Shield (Spec B §2.3 / §3).
 *
 * Nimmt Freitext eines Inserats (z. B. aus Telegram/WhatsApp), schickt ihn
 * an Haiku 4.5 mit Tool-Use, gibt strukturierte Felder zurück. Pattern
 * gespiegelt aus fb-crawler/src/extract.py + lib/listing-analyze/tool.ts.
 *
 * Niemals Werte erfinden — falls etwas im Text fehlt, Feld leer lassen.
 */
import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic, MODEL_HAIKU } from "@/lib/anthropic";

const MAX_TEXT_CHARS = 8_000;

const SYSTEM_PROMPT = `Du extrahierst Eckdaten aus dem Text eines Immobilien-Inserats für Zypern.

REGELN:
1. Niemals Werte erfinden. Wenn etwas im Text nicht steht, Feld weglassen.
2. Preis: nur die Zahl (numerisch), keine Tausenderpunkte. Currency separat (Default EUR).
3. Phone: in E.164-Format normalisieren (+357XXXXXXXX für Zypern). Bei Unsicherheit weglassen.
4. listing_type: rent oder sale. Wenn unklar → unknown.
5. confidence: deine Selbsteinschätzung 0..1, wie klar das Inserat war (Vollständigkeit + Plausibilität).
6. quality_signals: Auffälligkeiten im Text — z.B. "urgent_pressure" (Druck zur schnellen Zahlung), "deposit_before_viewing" (Anzahlung vor Besichtigung), "excessive_emojis", "broken_grammar", "stock_phrases".

Liefere ausschließlich via submit_scam_extract-Tool.`;

export type ScamExtractResult = {
  listing_type: "rent" | "sale" | "unknown";
  price?: number;
  currency?: string;
  city?: string;
  district?: string;
  rooms?: number;
  size_sqm?: number;
  contact_phone?: string;
  language?: "de" | "en" | "ru" | "el" | "other";
  /** 0..1 — wie sicher ist die Extraktion */
  confidence: number;
  /** 0..0.30 — Beitrag der Text-Heuristiken zum Gesamtscore (Score-Engine §6.2) */
  text_scam_score: number;
  /** Welche Auffälligkeiten haben den text_scam_score getrieben */
  quality_signals: string[];
  /** Gekürzter Originaltext für Persistierung (max 2000 Zeichen) */
  text_excerpt: string;
};

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "submit_scam_extract",
  description: "Liefert strukturierte Eckdaten + Scam-Quality-Signals aus dem Inseratstext.",
  input_schema: {
    type: "object",
    properties: {
      listing_type: { type: "string", enum: ["rent", "sale", "unknown"] },
      price: { type: "number" },
      currency: { type: "string", description: "ISO-Code, default EUR." },
      city: { type: "string" },
      district: { type: "string" },
      rooms: { type: "integer", description: "Anzahl Schlafzimmer (Studio = 0)." },
      size_sqm: { type: "integer" },
      contact_phone: { type: "string", description: "E.164-Format, +357 für Zypern." },
      language: { type: "string", enum: ["de", "en", "ru", "el", "other"] },
      confidence: { type: "number", description: "0..1" },
      quality_signals: {
        type: "array",
        items: { type: "string" },
        description: "Stable-IDs der Auffälligkeiten, z. B. urgent_pressure, deposit_before_viewing.",
      },
    },
    required: ["listing_type", "confidence", "quality_signals"],
  },
};

/** Mappe quality_signals auf einen 0..0.30-Score-Beitrag.
 *  Gewichte sind Startwerte — wie Match-Score (§7.2) später A/B-tunbar. */
const SIGNAL_WEIGHTS: Record<string, number> = {
  urgent_pressure: 0.10,
  deposit_before_viewing: 0.15,
  excessive_emojis: 0.03,
  broken_grammar: 0.05,
  stock_phrases: 0.05,
  cash_only: 0.10,
  remote_landlord: 0.10,    // "Eigentümer im Ausland"
  no_viewing: 0.10,         // "Besichtigung nicht möglich"
};

function computeTextScamScore(signals: string[]): number {
  const sum = signals.reduce((acc, s) => acc + (SIGNAL_WEIGHTS[s] ?? 0), 0);
  return Math.min(0.30, sum);
}

export async function extractTextListing(text: string): Promise<ScamExtractResult> {
  const truncated = text.slice(0, MAX_TEXT_CHARS);
  const client = getAnthropic();

  const response = await client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "submit_scam_extract" },
    messages: [{ role: "user", content: `Inseratstext:\n${truncated}` }],
  });

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "submit_scam_extract",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    throw new Error("scam-extract: tool_use fehlt in LLM-Antwort");
  }

  const raw = toolUse.input as Record<string, unknown>;
  const listing_type = raw.listing_type === "rent" || raw.listing_type === "sale" ? raw.listing_type : "unknown";
  const signals = Array.isArray(raw.quality_signals) ? raw.quality_signals.map(String) : [];

  return {
    listing_type,
    price: typeof raw.price === "number" ? raw.price : undefined,
    currency: typeof raw.currency === "string" ? raw.currency : undefined,
    city: typeof raw.city === "string" ? raw.city : undefined,
    district: typeof raw.district === "string" ? raw.district : undefined,
    rooms: typeof raw.rooms === "number" ? Math.round(raw.rooms) : undefined,
    size_sqm: typeof raw.size_sqm === "number" ? Math.round(raw.size_sqm) : undefined,
    contact_phone: typeof raw.contact_phone === "string" ? raw.contact_phone : undefined,
    language:
      typeof raw.language === "string" &&
      ["de", "en", "ru", "el", "other"].includes(raw.language as string)
        ? (raw.language as ScamExtractResult["language"])
        : undefined,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    quality_signals: signals,
    text_scam_score: computeTextScamScore(signals),
    text_excerpt: truncated.slice(0, 2_000),
  };
}
