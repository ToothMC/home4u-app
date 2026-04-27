/**
 * Vision-Extraktion für Scam-Shield (Spec B §2.2 / §5).
 *
 * Nimmt einen Screenshot eines Inserats (typisch Mobile-FB-Group) und
 * extrahiert dieselben Felder wie extract-text.ts via Haiku 4.5 Vision.
 *
 * Pattern gespiegelt aus app/api/listings/[id]/analyze (Sonnet+URL) und
 * fb-crawler/src/extract.py (Haiku+text). Hier: Haiku-Vision mit base64
 * — Bild kommt als Buffer aus dem Endpoint, nicht von einer URL.
 *
 * Quality-Signals (Spec §5.2): watermark_visible, image_blurry,
 * cropped_to_hide_watermark, branding_visible. Werden in den
 * text_scam_score (0..0.30) eingerechnet, der via score.ts §6.2 als
 * textScamScore-Slot in die Engine fließt.
 */
import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic, MODEL_HAIKU } from "@/lib/anthropic";

import type { ScamExtractResult } from "./extract-text";

const SYSTEM_PROMPT = `Du analysierst ein Foto eines Wohnungs-Inserats aus Zypern (typisch Mobile-Screenshot von Facebook-Gruppen, Bazaraki, Telegram).

REGELN:
1. Niemals Werte erfinden. Wenn etwas nicht im Bild steht, Feld weglassen.
2. Preis: numerisch in EUR. Currency separat, falls nicht EUR.
3. Phone: in E.164-Format (+357XXXXXXXX für Zypern). Bei Unsicherheit weglassen.
4. listing_type: rent oder sale. Wenn unklar → unknown.
5. confidence: 0..1, wie klar das Bild lesbar war.
6. quality_signals: nur reale Auffälligkeiten — z.B.
   - watermark_visible (Logo Booking/Airbnb/Hotels.com im Bild → Stockfoto-Verdacht)
   - image_blurry (unscharfes/komprimiertes Bild)
   - cropped_to_hide_watermark (rechter/unterer Rand verdächtig zugeschnitten)
   - branding_visible (Wasserzeichen einer Hotel-/Vermietungs-Plattform)
   - urgent_pressure (Druck zur schnellen Zahlung im Text)
   - deposit_before_viewing (Anzahlung vor Besichtigung gefordert)

Liefere ausschließlich via submit_scam_extract-Tool.`;

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "submit_scam_extract",
  description: "Strukturierte Eckdaten + Scam-Quality-Signals aus dem Screenshot.",
  input_schema: {
    type: "object",
    properties: {
      listing_type: { type: "string", enum: ["rent", "sale", "unknown"] },
      price: { type: "number" },
      currency: { type: "string" },
      city: { type: "string" },
      district: { type: "string" },
      rooms: { type: "integer", description: "Anzahl Schlafzimmer (Studio = 0)." },
      size_sqm: { type: "integer" },
      contact_phone: { type: "string", description: "E.164." },
      language: { type: "string", enum: ["de", "en", "ru", "el", "other"] },
      confidence: { type: "number", description: "0..1" },
      text_excerpt: {
        type: "string",
        description: "Erkennbarer Originaltext aus dem Screenshot, max 1500 Zeichen.",
      },
      quality_signals: {
        type: "array",
        items: { type: "string" },
        description: "Stable-IDs aus der Liste im System-Prompt.",
      },
    },
    required: ["listing_type", "confidence", "quality_signals"],
  },
};

const SIGNAL_WEIGHTS: Record<string, number> = {
  watermark_visible: 0.20,
  branding_visible: 0.15,
  cropped_to_hide_watermark: 0.20,
  image_blurry: 0.05,
  urgent_pressure: 0.10,
  deposit_before_viewing: 0.15,
  excessive_emojis: 0.03,
  broken_grammar: 0.05,
  stock_phrases: 0.05,
  cash_only: 0.10,
  remote_landlord: 0.10,
  no_viewing: 0.10,
};

function computeImageScamScore(signals: string[]): number {
  const sum = signals.reduce((acc, s) => acc + (SIGNAL_WEIGHTS[s] ?? 0), 0);
  return Math.min(0.30, sum);
}

const SUPPORTED_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
type SupportedMime = (typeof SUPPORTED_MIMES)[number];

function isSupportedMime(m: string): m is SupportedMime {
  return (SUPPORTED_MIMES as readonly string[]).includes(m);
}

export async function extractImageListing(
  buffer: Buffer,
  mimeType: string,
): Promise<ScamExtractResult> {
  // Anthropic Vision unterstützt nur jpeg/png/gif/webp; heic wird vor Anthropic
  // abgewiesen — der Caller (Endpoint) sollte heic2any-Konvertierung im Browser
  // einsetzen, dann ankommt jpeg.
  if (!isSupportedMime(mimeType) || mimeType === "image/heic") {
    throw new Error(`unsupported_mime:${mimeType}`);
  }

  const base64 = buffer.toString("base64");
  const client = getAnthropic();

  const response = await client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "submit_scam_extract" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/jpeg" | "image/png" | "image/webp",
              data: base64,
            },
          },
          {
            type: "text",
            text: "Analysiere dieses Inserat. Liefere die Eckdaten via Tool.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock =>
      c.type === "tool_use" && c.name === "submit_scam_extract",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    throw new Error("scam-extract-image: tool_use fehlt in LLM-Antwort");
  }

  const raw = toolUse.input as Record<string, unknown>;
  const listing_type =
    raw.listing_type === "rent" || raw.listing_type === "sale" ? raw.listing_type : "unknown";
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
    text_scam_score: computeImageScamScore(signals),
    text_excerpt: typeof raw.text_excerpt === "string" ? raw.text_excerpt.slice(0, 1500) : "",
  };
}
