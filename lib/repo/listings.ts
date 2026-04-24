import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type Listing = {
  id: string;
  source: string;
  type: "rent" | "sale";
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number | null;
  size_sqm: number | null;
  contact_channel: string | null;
};

export type ListingMatch = Listing & { score: number };

/**
 * Ruft den match_listings_for_profile-RPC auf. Bevorzugt das aktuelle
 * aktive Profil der anonymen Session; wenn keines existiert, returned [].
 */
export async function findMatchesForSession(
  anonymousId: string,
  limit = 5
): Promise<ListingMatch[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("match_listings_for_profile", {
    p_anonymous_id: anonymousId,
    p_limit: limit,
  });
  if (error) {
    console.error("[matching] rpc failed", error);
    return [];
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.listing_id as string,
    source: row.source as string,
    type: row.type as "rent" | "sale",
    location_city: row.location_city as string,
    location_district: (row.location_district as string) ?? null,
    price: Number(row.price),
    currency: row.currency as string,
    rooms: (row.rooms as number) ?? null,
    size_sqm: (row.size_sqm as number) ?? null,
    contact_channel: (row.contact_channel as string) ?? null,
    score: Number(row.score ?? 0),
  }));
}
