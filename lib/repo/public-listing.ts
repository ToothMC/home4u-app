import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  HonestAssessment,
  ListingPhoto,
  NearbyPOI,
  PublicListingData,
} from "@/components/listing-public/types";

export async function loadPublicListing(
  id: string
): Promise<PublicListingData | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const { data: l, error } = await supabase
    .from("listings")
    .select(
      `id, title, description, type, status, property_type,
       location_city, location_district, location_address, lat, lng,
       price, price_warm, price_cold, deposit, service_charge_monthly, utilities, currency,
       rooms, bathrooms, size_sqm, plot_sqm,
       floor, year_built, energy_class, furnishing,
       pets_allowed, available_from, features, media,
       honest_assessment, nearby_pois,
       floorplan_url, tour_3d_url, video_url,
       source, external_id, ai_analyzed_at, created_at`
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !l) return null;

  // Photos: bevorzugt aus listing_photos (mit room_type-Tags), fallback auf media[]
  const { data: photoRows } = await supabase
    .from("listing_photos")
    .select("id, url, room_type, caption, position")
    .eq("listing_id", id)
    .order("position", { ascending: true });

  let photos: ListingPhoto[];
  if (photoRows && photoRows.length > 0) {
    photos = photoRows.map((p) => ({
      id: p.id,
      url: p.url,
      room_type: p.room_type,
      caption: p.caption,
      position: p.position,
    }));
  } else {
    const fallback = (l.media ?? []) as string[];
    photos = fallback.map((url, idx) => ({
      id: `legacy-${idx}`,
      url,
      room_type: null,
      caption: null,
      position: idx,
    }));
  }

  return {
    id: l.id,
    title: l.title ?? null,
    description: l.description ?? null,
    type: l.type as "rent" | "sale",
    property_type: l.property_type ?? null,
    status: l.status,
    location_city: l.location_city,
    location_district: l.location_district ?? null,
    location_address: l.location_address ?? null,
    lat: l.lat != null ? Number(l.lat) : null,
    lng: l.lng != null ? Number(l.lng) : null,
    price: Number(l.price ?? 0),
    price_warm: l.price_warm != null ? Number(l.price_warm) : null,
    price_cold: l.price_cold != null ? Number(l.price_cold) : null,
    deposit: l.deposit != null ? Number(l.deposit) : null,
    service_charge_monthly:
      l.service_charge_monthly != null ? Number(l.service_charge_monthly) : null,
    utilities: (l.utilities as PublicListingData["utilities"]) ?? null,
    currency: l.currency ?? "EUR",
    rooms: l.rooms ?? null,
    bathrooms: l.bathrooms ?? null,
    size_sqm: l.size_sqm ?? null,
    plot_sqm: l.plot_sqm ?? null,
    floor: l.floor ?? null,
    year_built: l.year_built ?? null,
    energy_class: l.energy_class ?? null,
    furnishing: l.furnishing ?? null,
    pets_allowed: l.pets_allowed ?? null,
    available_from: l.available_from ?? null,
    features: (l.features ?? []) as string[],
    media: (l.media ?? []) as string[],
    photos,
    honest_assessment: (l.honest_assessment as HonestAssessment | null) ?? null,
    nearby_pois: ((l.nearby_pois as NearbyPOI[] | null) ?? []) as NearbyPOI[],
    floorplan_url: l.floorplan_url ?? null,
    tour_3d_url: l.tour_3d_url ?? null,
    video_url: l.video_url ?? null,
    source: l.source as string,
    external_id: l.external_id ?? null,
    ai_analyzed_at: l.ai_analyzed_at ?? null,
    created_at: l.created_at,
  };
}
