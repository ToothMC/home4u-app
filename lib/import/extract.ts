import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL_HAIKU, MODEL_SONNET } from "@/lib/anthropic";
import { computeDedupHash } from "./dedup";
import type { ParseResult } from "./parser";
import type { FieldError, NormalizedListing } from "./types";

const ROW_BATCH_SIZE = 25;
const MAX_BATCHES = 50; // Hard cap → max ~1250 Listings pro Upload (über AI-Pfad)

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "submit_listings",
  description:
    "Liefert die extrahierten Immobilien-Inserate als strukturierte Daten. Auch leere Liste erlaubt, wenn die Eingabe keine Inserate enthält.",
  input_schema: {
    type: "object",
    properties: {
      listings: {
        type: "array",
        description: "Alle erkannten Inserate aus der Eingabe.",
        items: {
          type: "object",
          properties: {
            source_index: {
              type: "integer",
              description:
                "Bei tabellarischer Eingabe: Index der Quellzeile (0-basiert) im aktuellen Batch. Bei freiem Text: laufende Nummer.",
            },
            type: {
              type: "string",
              enum: ["rent", "sale"],
              description:
                "Miete oder Kauf. Erkenne aus Wörtern wie 'rent/miete/rental/аренда/ενοικίαση' bzw. 'sale/kauf/verkauf/продажа/πώληση'.",
            },
            location_city: {
              type: "string",
              description: "Stadt (z. B. Limassol, Paphos, Nicosia).",
            },
            location_district: {
              type: "string",
              description:
                "Stadtteil/Viertel falls erkennbar (z. B. Germasogeia, Mouttagiaka). Sonst leer lassen.",
            },
            price: {
              type: "number",
              description:
                "Numerischer Preis. Tausender-Trenner und Währungssymbole entfernen. Bei Miete: Monatspreis. Bei Kauf: Gesamtpreis.",
            },
            currency: {
              type: "string",
              description:
                "ISO-3-Code (EUR, USD, GBP, RUB). € → EUR, $ → USD. Default EUR.",
            },
            rooms: {
              type: "integer",
              description:
                "Zimmerzahl (oder Schlafzimmer/bedrooms). 0 = Studio. Wenn nur Quadratmeter, schätze NICHT.",
            },
            size_sqm: {
              type: "integer",
              description: "Wohnfläche in m². Falls in sq ft angegeben, umrechnen (1 sqft = 0.0929 m²).",
            },
            contact_phone: {
              type: "string",
              description:
                "Telefonnummer in E.164 (z. B. +35799123456). CY-Default ist +357 wenn keine Ländervorwahl angegeben.",
            },
            contact_name: {
              type: "string",
              description: "Name der Kontaktperson / des Maklers.",
            },
            contact_channel: {
              type: "string",
              description:
                "Bevorzugter Kanal falls genannt (whatsapp, telegram, email, phone).",
            },
            external_id: {
              type: "string",
              description:
                "Referenz/ID des Inserats im Quellsystem (z. B. 'REF-1001', 'Objektnummer 42').",
            },
            media: {
              type: "array",
              items: { type: "string" },
              description:
                "Bild- oder Video-URLs (Endung .jpg/.jpeg/.png/.webp/.heic/.gif/.avif/.mp4/.webm/.mov). NIEMALS Listing-Detail-Seiten oder Übersichtsseiten hier reintun — die gehören nach source_url.",
            },
            source_url: {
              type: "string",
              description:
                "Original-Inserat-URL (z. B. Bazaraki/ImmoScout-Detailseite). NICHT in media. Wird als Kontext gespeichert.",
            },
            language: {
              type: "string",
              enum: ["de", "en", "ru", "el", "zh"],
              description: "Sprache des Inserats falls erkennbar.",
            },
            confidence: {
              type: "number",
              description:
                "Selbsteinschätzung 0..1, wie sicher die Extraktion ist. Unter 0.5 wird die Zeile als Fehler markiert.",
            },
            note: {
              type: "string",
              description:
                "Optionaler Hinweis, falls etwas auffällt (z. B. 'Preis unklar', 'mehrere Wohnungen in einer Zeile').",
            },
          },
          required: ["type", "location_city", "price", "currency", "rooms", "confidence"],
        },
      },
    },
    required: ["listings"],
  },
};

const SYSTEM_PROMPT = `Du bist Home4Us Daten-Extraktor für Immobilien-Inserate.

Aufgabe: Aus der Eingabe (Tabelle, PDF-Text oder Freitext) ALLE Immobilien-Inserate extrahieren und strukturiert via submit_listings ausgeben.

Regeln:
- Pflichtfelder: type, location_city, price, currency, rooms.
- Wenn ein Pflichtfeld fehlt oder unklar ist: confidence < 0.5 setzen, trotzdem aufnehmen — die Plattform sortiert das raus.
- Niemals Werte erfinden. Bei fehlenden optionalen Feldern: leer lassen.
- Mehrsprachige Spaltennamen verstehen (DE/EN/RU/EL).
- Bei Tabellen-Input: source_index = Index der Quellzeile (0-basiert).
- Bei Freitext: jeden Eintrag als separates Listing aufnehmen, source_index laufend hochzählen.
- Preise: Tausender-Trenner '.' und ',' richtig interpretieren (DE: 1.234,56 / US: 1,234.56).
- Telefonnummern: E.164. CY-Default = +357.
- Bilder: nur http(s)://-URLs. Lokale Pfade verwerfen.
- Wenn die Eingabe gar keine Immobilien-Inserate enthält: leeres Array zurückgeben.`;

export type RawExtraction = {
  source_index?: number;
  type?: string;
  location_city?: string;
  location_district?: string;
  price?: number | string;
  currency?: string;
  rooms?: number | string;
  size_sqm?: number | string;
  contact_phone?: string;
  contact_name?: string;
  contact_channel?: string;
  external_id?: string;
  source_url?: string;
  media?: string[];
  language?: string;
  confidence?: number;
  note?: string;
};

export type ExtractionItem =
  | {
      status: "valid";
      sourceIndex: number;
      normalized: NormalizedListing;
      confidence: number;
      note?: string;
    }
  | {
      status: "error";
      sourceIndex: number;
      errors: FieldError[];
      raw: RawExtraction;
      confidence: number;
      note?: string;
    };

export type ExtractionResult = {
  items: ExtractionItem[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
};

export async function extractListings(
  parsed: ParseResult,
  brokerId: string
): Promise<ExtractionResult> {
  const items: ExtractionItem[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

  if (parsed.kind === "rows") {
    const batches = chunk(parsed.rows, ROW_BATCH_SIZE).slice(0, MAX_BATCHES);
    let globalOffset = 0;
    for (const batch of batches) {
      const userText = formatRowsForPrompt(parsed.headers, batch);
      const { listings, usage: u } = await callExtractor({
        system: SYSTEM_PROMPT,
        user: userText,
        model: MODEL_HAIKU,
      });
      addUsage(usage, u);
      for (const l of listings) {
        const localIdx =
          typeof l.source_index === "number" ? l.source_index : 0;
        const sourceIndex = globalOffset + Math.max(0, Math.min(batch.length - 1, localIdx));
        items.push(buildItem(l, sourceIndex, brokerId));
      }
      globalOffset += batch.length;
    }
  } else {
    const { listings, usage: u } = await callExtractor({
      system: SYSTEM_PROMPT,
      user: `Eingabe-Format: ${parsed.format.toUpperCase()}.\n\n${parsed.text}`,
      model: MODEL_SONNET,
    });
    addUsage(usage, u);
    listings.forEach((l, idx) => {
      const sourceIndex = typeof l.source_index === "number" ? l.source_index : idx;
      items.push(buildItem(l, sourceIndex, brokerId));
    });
  }

  return { items, usage };
}

function formatRowsForPrompt(headers: string[], rows: Record<string, string>[]): string {
  // JSON-Lines mit explizitem Index → Claude kann source_index präzise zurückmelden
  const lines = rows.map((r, idx) => {
    const compact: Record<string, string> = {};
    for (const h of headers) {
      const v = r[h];
      if (v && String(v).trim()) compact[h] = String(v).trim();
    }
    return JSON.stringify({ source_index: idx, data: compact });
  });
  return [
    "Tabellarische Eingabe — jede Zeile ist ein potenzielles Inserat.",
    `Spalten-Header: ${JSON.stringify(headers)}`,
    "",
    "Zeilen:",
    ...lines,
  ].join("\n");
}

async function callExtractor(args: {
  system: string;
  user: string;
  model: string;
}): Promise<{ listings: RawExtraction[]; usage: ExtractionResult["usage"] }> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: args.model,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: args.system,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "submit_listings" },
    messages: [{ role: "user", content: args.user }],
  });

  const usage = {
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
  };

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "submit_listings"
  );
  if (!toolUse) {
    return { listings: [], usage };
  }
  const input = toolUse.input as { listings?: RawExtraction[] };
  return { listings: input.listings ?? [], usage };
}

function buildItem(
  raw: RawExtraction,
  sourceIndex: number,
  brokerId: string
): ExtractionItem {
  const errors: FieldError[] = [];
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;

  const type =
    raw.type === "rent" || raw.type === "sale" ? raw.type : null;
  if (!type) {
    errors.push({ field: "type", value: raw.type ?? null, reason: "type fehlt oder ungültig" });
  }

  const city = (raw.location_city ?? "").trim();
  if (!city) {
    errors.push({ field: "location_city", value: null, reason: "Stadt fehlt" });
  }

  const price = toNumber(raw.price);
  if (price === null || price <= 0) {
    errors.push({ field: "price", value: String(raw.price ?? ""), reason: "Preis ungültig" });
  } else if (price > 50_000_000) {
    errors.push({ field: "price", value: String(raw.price), reason: "Preis unrealistisch hoch" });
  }

  const currency = normalizeCurrency(raw.currency);
  const rooms = toInt(raw.rooms);
  if (rooms === null) {
    errors.push({ field: "rooms", value: String(raw.rooms ?? ""), reason: "Zimmerzahl fehlt/ungültig" });
  } else if (rooms < 0 || rooms > 20) {
    errors.push({ field: "rooms", value: String(raw.rooms), reason: "Zimmerzahl außerhalb 0..20" });
  }

  if (confidence < 0.5) {
    errors.push({
      field: "type",
      value: null,
      reason: `AI-Confidence zu niedrig (${confidence.toFixed(2)})${raw.note ? `: ${raw.note}` : ""}`,
    });
  }

  if (errors.length > 0) {
    return {
      status: "error",
      sourceIndex,
      errors,
      raw,
      confidence,
      note: raw.note,
    };
  }

  const sizeSqm = raw.size_sqm != null ? toInt(raw.size_sqm) : null;
  // Hard-Filter: nur Bild-/Video-URLs in media, sonst landen Listing-Detail-Seiten
  // (z. B. bazaraki.com/adv/...) als <img src> im Dashboard und werden vom
  // Adblocker geblockt.
  const MEDIA_EXT = /\.(jpe?g|png|webp|heic|gif|avif|mp4|webm|mov)(\?|$)/i;
  const STORAGE_PATH = /\/storage\/v1\/object\//i;
  const media = (raw.media ?? [])
    .filter(
      (u) =>
        typeof u === "string" &&
        /^https?:\/\//i.test(u) &&
        (MEDIA_EXT.test(u) || STORAGE_PATH.test(u))
    )
    .slice(0, 12);
  const language =
    raw.language && ["de", "en", "ru", "el", "zh"].includes(raw.language)
      ? (raw.language as NormalizedListing["language"])
      : null;

  const partial: Omit<NormalizedListing, "dedup_hash"> = {
    type: type as "rent" | "sale",
    location_city: city,
    location_district: (raw.location_district ?? "").trim() || null,
    price: price as number,
    currency,
    rooms: rooms as number,
    size_sqm: sizeSqm,
    contact_phone: normalizePhone(raw.contact_phone),
    contact_name: (raw.contact_name ?? "").trim() || null,
    contact_channel: (raw.contact_channel ?? "").trim() || null,
    // Fallback: source_url als external_id verwenden, wenn keiner explizit
    // angegeben ist (Bazaraki/ImmoScout-URLs sind stabile Referenzen → besserer
    // Dedup-Key als Stadt+Preis+Zimmer)
    external_id:
      (raw.external_id ?? "").trim() ||
      (raw.source_url ?? "").trim() ||
      null,
    media,
    language,
  };

  return {
    status: "valid",
    sourceIndex,
    normalized: { ...partial, dedup_hash: computeDedupHash(brokerId, partial) },
    confidence,
    note: raw.note,
  };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.,-]/g, "");
    if (!cleaned) return null;
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    let normalized: string;
    if (lastComma === -1 && lastDot === -1) normalized = cleaned;
    else if (lastComma > lastDot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
    else normalized = cleaned.replace(/,/g, "");
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toInt(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.trunc(n);
}

function normalizeCurrency(input: string | undefined): string {
  if (!input) return "EUR";
  const trimmed = input.trim().toUpperCase();
  if (trimmed === "€" || trimmed === "EUR" || trimmed === "EURO") return "EUR";
  if (trimmed === "$" || trimmed === "USD") return "USD";
  if (trimmed === "£" || trimmed === "GBP") return "GBP";
  if (trimmed === "₽" || trimmed === "RUB") return "RUB";
  if (/^[A-Z]{3}$/.test(trimmed)) return trimmed;
  return "EUR";
}

function normalizePhone(input: string | undefined): string | null {
  if (!input) return null;
  const cleaned = input.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) {
    return /^\+\d{8,15}$/.test(cleaned) ? cleaned : null;
  }
  if (cleaned.startsWith("00")) {
    const num = "+" + cleaned.slice(2);
    return /^\+\d{8,15}$/.test(num) ? num : null;
  }
  if (cleaned.length >= 8 && cleaned.length <= 10) {
    return "+357" + cleaned.replace(/^0+/, "");
  }
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function addUsage(target: ExtractionResult["usage"], add: ExtractionResult["usage"]) {
  target.inputTokens += add.inputTokens;
  target.outputTokens += add.outputTokens;
  target.cacheReadTokens += add.cacheReadTokens;
  target.cacheCreationTokens += add.cacheCreationTokens;
}
