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
import { ANALYZE_TOOL, type AnalyzeResult } from "./tool";

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
  const imageContent: Anthropic.ImageBlockParam[] = imageUrls.map((url) => ({
    type: "image",
    source: { type: "url", url: shrinkSupabaseUrl(url) },
  }));

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
          content: [{ type: "text", text: userText }, ...imageContent],
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

  // Vorher: erst ALLE listing_photos löschen, dann neu einfügen — das hat
  // bei >MAX_PHOTOS_PER_CALL Bildern die nicht-analysierten Bilder aus
  // listing_photos entfernt. Jetzt: gezieltes Upsert pro analysierter URL,
  // nicht-analysierte Bilder bleiben unangetastet (ihr room_type kann
  // manuell im Editor gesetzt werden).
  const photoRows = result.photos
    .filter((p) => p.index >= 0 && p.index < imageUrls.length)
    .map((p) => ({
      listing_id: listing.id,
      url: imageUrls[p.index],
      room_type: p.room_type,
      caption: p.caption ?? null,
      position: p.index,
    }));

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
