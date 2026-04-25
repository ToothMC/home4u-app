// POST /api/listings/[id]/analyze
// Sophie-Vision-Pipeline: Claude Sonnet 4.6 liest alle Fotos eines Inserats
// und füllt Title + Description + property_type + features + furnishing +
// honest_assessment + room_type pro Foto. Schreibt zurück in listings + listing_photos.
//
// Authorisierung: nur Listing-Owner.

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODEL_SONNET } from "@/lib/anthropic";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ANALYZE_SYSTEM_PROMPT, buildUserMessage } from "@/lib/listing-analyze/prompt";
import { ANALYZE_TOOL, type AnalyzeResult } from "@/lib/listing-analyze/tool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MAX_PHOTOS_PER_CALL = 20; // Anthropic verträgt mehr, aber Latenz steigt

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return Response.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  // Listing laden + Auth-Check
  const { data: listing, error: loadErr } = await supabase
    .from("listings")
    .select(
      `id, owner_user_id, type, location_city, location_district,
       rooms, size_sqm, price, currency, media, title, description`
    )
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !listing) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (listing.owner_user_id !== user.id) {
    return Response.json({ error: "not_owner" }, { status: 403 });
  }

  // Foto-Liste (nur Bilder, keine Videos für Vision)
  const allMedia = (listing.media ?? []) as string[];
  const imageUrls = allMedia
    .filter((u) => /\.(jpe?g|png|webp|heic|avif)(\?|$)/i.test(u))
    .slice(0, MAX_PHOTOS_PER_CALL);

  if (imageUrls.length < 1) {
    return Response.json(
      {
        error: "not_enough_photos",
        detail: "Mindestens 1 Foto benötigt — lade Bilder hoch und versuche es erneut.",
      },
      { status: 400 }
    );
  }

  const client = getAnthropic();

  // Anthropic-Message bauen: System-Prompt cached, User-Message mit Bildern
  const imageContent: Anthropic.ImageBlockParam[] = imageUrls.map((url) => ({
    type: "image",
    source: { type: "url", url },
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
      model: MODEL_SONNET,
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
          content: [
            { type: "text", text: userText },
            ...imageContent,
          ],
        },
      ],
    });
  } catch (err) {
    console.error("[analyze] anthropic call failed", err);
    return Response.json(
      {
        error: "anthropic_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "submit_listing_analysis"
  );
  if (!toolUse) {
    return Response.json({ error: "no_tool_response" }, { status: 502 });
  }
  const result = toolUse.input as AnalyzeResult;

  // DB-Update
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
  if (result.energy_class_estimate) updates.energy_class = result.energy_class_estimate;

  const { error: updateErr } = await supabase
    .from("listings")
    .update(updates)
    .eq("id", listing.id);

  if (updateErr) {
    console.error("[analyze] listing update failed", updateErr);
    return Response.json(
      { error: "update_failed", detail: updateErr.message },
      { status: 500 }
    );
  }

  // listing_photos: alle alten löschen, neue mit room_type einfügen
  await supabase.from("listing_photos").delete().eq("listing_id", listing.id);

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
    const { error: photosErr } = await supabase
      .from("listing_photos")
      .insert(photoRows);
    if (photosErr) {
      console.error("[analyze] photos insert failed", photosErr);
    }
  }

  return Response.json({
    ok: true,
    title: result.title,
    photos_tagged: photoRows.length,
    pros: result.honest_assessment.pros.length,
    cons: result.honest_assessment.cons.length,
    features: result.features.length,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
    },
  });
}
