/**
 * Reine Vision-Analyse-Funktion. Kein Auth, kein HTTP — Caller (Owner-Route
 * oder Admin-Batch-Script) regelt den Zugang.
 *
 * Schreibt in:
 *   listings.{title, description, property_type, features, furnishing,
 *             bathrooms, energy_class, honest_assessment, ai_analyzed_at}
 *   listing_photos: alte gelöscht, neue mit room_type pro Foto
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAnthropic, MODEL_HAIKU, MODEL_SONNET } from "@/lib/anthropic";

// Generischer Supabase-Client-Typ — beide Aufrufer (createSupabaseServiceClient
// und createClient aus Scripts) sind kompatibel, der konkrete Schema-Typ
// interessiert hier nicht.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = SupabaseClient<any, any, any>;
import { ANALYZE_SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import { ANALYZE_TOOL, ROOM_TYPES, type AnalyzeResult } from "./tool";

// Per-Bild-Klassifizierung: 1 fokussierter Haiku-Call pro Foto, parallel.
// Sonnet auf einem Schlag mit 40 Bildern verschlampt zu viele Indices →
// Foto-Misclassification. Pro-Bild-Call sieht genau EIN Bild und beantwortet
// genau EINE Frage → nahezu 100% Treffer.
const ROOM_CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_room",
  description: "Klassifiziere den Raumtyp des einzelnen Fotos.",
  input_schema: {
    type: "object",
    properties: {
      room_type: {
        type: "string",
        enum: [...ROOM_TYPES],
        description:
          "Welcher Raum/Bereich ist auf dem Foto zu sehen? Bei Außenaufnahmen → exterior/garden/pool/parking/terrace/balcony/view je nach Motiv. Bei Innenräumen → living/kitchen/bedroom/bathroom/hallway/utility/office. Wenn unklar → other.",
      },
      caption: {
        type: "string",
        description: "Sehr kurze Bildunterschrift, max 6 Wörter (z. B. 'Wohnzimmer mit Sofa', 'Bad mit Dusche').",
      },
    },
    required: ["room_type"],
  },
};

async function classifyRoom(
  client: ReturnType<typeof getAnthropic>,
  url: string
): Promise<{ room_type: string; caption?: string } | null> {
  try {
    const res = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 200,
      tools: [ROOM_CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "classify_room" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: shrinkSupabaseUrl(url) },
            },
            {
              type: "text",
              text: "Welcher Raumtyp ist auf diesem Foto zu sehen? Antworte über das classify_room-Tool.",
            },
          ],
        },
      ],
    });
    const tu = res.content.find(
      (c): c is Anthropic.ToolUseBlock =>
        c.type === "tool_use" && c.name === "classify_room"
    );
    if (!tu) return null;
    const input = tu.input as { room_type: string; caption?: string };
    return input;
  } catch (err) {
    console.error("[classify_room] failed", url, err);
    return null;
  }
}

export type AnalyzeModel = "haiku" | "sonnet";

const MAX_PHOTOS_PER_CALL = 40;

// Anthropic-Limit: bei Many-Image-Requests darf KEINE Dimension >2000 px sein.
// Unsere Uploads werden auf 2400px komprimiert (compress.ts), also schreiben
// wir Supabase-Storage-URLs auf den Render-Endpoint um, der serverseitig auf
// 1920px herunterskaliert. Andere URLs (externe Crawler-Quellen) bleiben
// unverändert — die sind meist eh kleiner.
function shrinkSupabaseUrl(url: string): string {
  const m = url.match(
    /^(https:\/\/[^/]+\.supabase\.co)\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(\?.*)?$/
  );
  if (!m) return url;
  const [, host, bucket, path] = m;
  // resize=contain + width=height=1920 → BEIDE Dimensionen ≤1920, egal ob
  // Hochkant oder Querformat. Nur width=… reicht NICHT, weil Hochkantbilder
  // dann in der Höhe noch >2000 sein können (Anthropic-Limit).
  return `${host}/storage/v1/render/image/public/${bucket}/${path}?width=1920&height=1920&resize=contain&quality=80`;
}

export type AnalyzeOk = {
  ok: true;
  listing_id: string;
  title: string;
  photos_tagged: number;
  features: string[];
  pros_count: number;
  cons_count: number;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
};

export type AnalyzeErr = {
  ok: false;
  listing_id: string;
  error: string;
  detail?: string;
};

/**
 * Analysiert ein Listing anhand seiner media[]-URLs und schreibt
 * Ergebnis in die DB. Owner-Check macht der Caller.
 */
export async function analyzeListing(
  supabase: SupabaseLike,
  listingId: string,
  opts: { model?: AnalyzeModel } = {}
): Promise<AnalyzeOk | AnalyzeErr> {
  const model = opts.model === "haiku" ? MODEL_HAIKU : MODEL_SONNET;

  const { data: listing, error: loadErr } = await supabase
    .from("listings")
    .select(
      `id, type, location_city, location_district,
       rooms, size_sqm, price, currency, media, title, description`
    )
    .eq("id", listingId)
    .maybeSingle();
  if (loadErr || !listing) {
    return {
      ok: false,
      listing_id: listingId,
      error: "not_found",
      detail: loadErr?.message,
    };
  }

  const allMedia = (listing.media ?? []) as string[];
  const imageUrls = allMedia
    .filter((u) => /\.(jpe?g|png|webp|heic|avif)(\?|$)/i.test(u))
    .slice(0, MAX_PHOTOS_PER_CALL);

  if (imageUrls.length < 1) {
    return {
      ok: false,
      listing_id: listingId,
      error: "not_enough_photos",
    };
  }

  const client = getAnthropic();

  const userText = buildUserMessage({
    listingId: listing.id,
    city: listing.location_city,
    district: listing.location_district,
    type: listing.type as "rent" | "sale",
    rooms: listing.rooms,
    size_sqm: listing.size_sqm,
    price: Number(listing.price),
    currency: listing.currency ?? "EUR",
    existingTitle: listing.title,
    existingDescription: listing.description,
    imageCount: imageUrls.length,
  });

  // Bilder + Index-Labels interleaven, damit Sophie pro Bild eine
  // unmissverständliche Index-Anker-Zeile sieht. Sonst verliert sie bei
  // vielen Bildern die Reihenfolge und tagt "Garten" auf ein Schlafzimmer.
  type Block = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;
  const interleaved: Block[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    interleaved.push({ type: "text", text: `Foto ${i}:` });
    interleaved.push({
      type: "image",
      source: { type: "url", url: shrinkSupabaseUrl(imageUrls[i]) },
    });
  }

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: ANALYZE_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [ANALYZE_TOOL],
      tool_choice: { type: "tool", name: "submit_listing_analysis" },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: userText }, ...interleaved],
        },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      listing_id: listingId,
      error: "anthropic_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock =>
      c.type === "tool_use" && c.name === "submit_listing_analysis"
  );
  if (!toolUse) {
    return { ok: false, listing_id: listingId, error: "no_tool_response" };
  }
  const result = toolUse.input as AnalyzeResult;

  const updates: Record<string, unknown> = {
    title: result.title,
    description: result.description,
    property_type: result.property_type,
    features: result.features ?? [],
    honest_assessment: result.honest_assessment,
    ai_analyzed_at: new Date().toISOString(),
  };
  if (result.furnishing) updates.furnishing = result.furnishing;
  if (typeof result.bathrooms === "number") updates.bathrooms = result.bathrooms;
  if (result.energy_class_estimate)
    updates.energy_class = result.energy_class_estimate;

  const { error: updateErr } = await supabase
    .from("listings")
    .update(updates)
    .eq("id", listing.id);
  if (updateErr) {
    return {
      ok: false,
      listing_id: listingId,
      error: "update_failed",
      detail: updateErr.message,
    };
  }

  // Kostenoptimierung: nur Bilder klassifizieren, die noch KEIN room_type
  // haben (oder noch gar nicht in listing_photos sind). So zahlt der User
  // die ~0,2¢ pro Bild nur einmal, nicht bei jedem Re-Analyze.
  const { data: existingPhotos } = await supabase
    .from("listing_photos")
    .select("url, room_type")
    .eq("listing_id", listing.id);
  const alreadyClassified = new Set(
    (existingPhotos ?? [])
      .filter((p) => p.room_type != null && p.room_type !== "")
      .map((p) => p.url as string)
  );
  const toClassify = imageUrls.filter((u) => !alreadyClassified.has(u));

  // Per-Bild-Klassifizierung parallel: 1 Haiku-Call pro NEUEM Foto.
  // Sonnets photos[]-Antwort wird ignoriert (Index-Drift bei vielen Bildern).
  const classifications = await Promise.all(
    toClassify.map((url) => classifyRoom(client, url))
  );
  const photoRows = classifications
    .map((c, i) => {
      if (!c) return null;
      const url = toClassify[i];
      const idx = imageUrls.indexOf(url);
      return {
        listing_id: listing.id,
        url,
        room_type: c.room_type,
        caption: c.caption ?? null,
        position: idx,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (photoRows.length > 0) {
    await supabase
      .from("listing_photos")
      .upsert(photoRows, { onConflict: "listing_id,url" });
  }

  return {
    ok: true,
    listing_id: listing.id,
    title: result.title,
    photos_tagged: photoRows.length,
    features: result.features ?? [],
    pros_count: result.honest_assessment.pros.length,
    cons_count: result.honest_assessment.cons.length,
    model,
    usage: {
      input_tokens: response.usage.input_tokens ?? 0,
      output_tokens: response.usage.output_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
