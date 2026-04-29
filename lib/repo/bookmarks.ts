import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type MatchStatus = "none" | "pending" | "connected" | "rejected";

export type BookmarkedListing = {
  bookmarkId: string;
  bookmarkedAt: string;
  searchProfileId: string | null;
  matchStatus: MatchStatus;
  matchId: string | null;
  listing: {
    id: string;
    type: "rent" | "sale";
    property_type: string | null;
    status: string;
    location_city: string;
    location_district: string | null;
    price: number;
    currency: string;
    rooms: number | null;
    size_sqm: number | null;
    media: string[] | null;
  };
};

/**
 * Liefert alle Bookmarks eines (eingeloggten) Users mit den nötigen
 * Listing-Feldern für eine kompakte Liste — sortiert nach Speicher-Datum
 * absteigend. Anonymous Bookmarks werden bewusst ignoriert: die Favoriten-
 * Ansicht ist auth-only.
 *
 * Joint zusätzlich den Match-Status (LEFT JOIN über listing_id +
 * search_profile_id), damit das UI die CRM-Pipeline-Stufe pro Item
 * darstellen kann (Stufe 2 "Favorit" vs. Stufe 3 "angefragt").
 */
export async function getUserBookmarks(
  userId: string,
  opts: { limit?: number } = {}
): Promise<BookmarkedListing[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];
  const limit = opts.limit ?? 200;

  const { data, error } = await supabase
    .from("listing_bookmarks")
    .select(
      `id, created_at, search_profile_id, listing_id,
       listings!inner (
         id, type, property_type, status,
         location_city, location_district,
         price, currency, rooms, size_sqm, media
       )`
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[bookmarks] getUserBookmarks failed", error);
    return [];
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Match-Status pro (search_profile_id, listing_id) Tupel abfragen — nur
  // wo search_profile_id gesetzt ist. Alt-Bookmarks (NULL) bleiben "none".
  const profileIds = Array.from(
    new Set(
      rows
        .map((r) => r.search_profile_id as string | null)
        .filter((x): x is string => Boolean(x))
    )
  );
  const listingIds = rows.map((r) => r.listing_id as string);

  type MatchRow = {
    id: string;
    listing_id: string;
    search_profile_id: string;
    seeker_interest: boolean | null;
    owner_interest: boolean | null;
    connected_at: string | null;
  };
  let matchMap = new Map<string, MatchRow>();
  if (profileIds.length > 0 && listingIds.length > 0) {
    const { data: matchRows } = await supabase
      .from("matches")
      .select(
        "id, listing_id, search_profile_id, seeker_interest, owner_interest, connected_at"
      )
      .in("search_profile_id", profileIds)
      .in("listing_id", listingIds)
      .eq("seeker_interest", true);
    matchMap = new Map(
      (matchRows ?? []).map((m) => [
        `${m.search_profile_id}:${m.listing_id}`,
        m as MatchRow,
      ])
    );
  }

  return rows
    .map((row): BookmarkedListing | null => {
      const l = Array.isArray(row.listings) ? row.listings[0] : row.listings;
      if (!l) return null;
      const spid = (row.search_profile_id as string | null) ?? null;
      const lid = row.listing_id as string;
      const match = spid ? matchMap.get(`${spid}:${lid}`) : undefined;
      let matchStatus: MatchStatus = "none";
      if (match) {
        if (match.connected_at) matchStatus = "connected";
        else if (match.owner_interest === false) matchStatus = "rejected";
        else matchStatus = "pending";
      }
      return {
        bookmarkId: row.id as string,
        bookmarkedAt: row.created_at as string,
        searchProfileId: spid,
        matchStatus,
        matchId: match?.id ?? null,
        listing: {
          id: l.id,
          type: l.type as "rent" | "sale",
          property_type: l.property_type ?? null,
          status: l.status,
          location_city: l.location_city,
          location_district: l.location_district ?? null,
          price: Number(l.price ?? 0),
          currency: l.currency ?? "EUR",
          rooms: l.rooms ?? null,
          size_sqm: l.size_sqm ?? null,
          media: l.media ?? null,
        },
      };
    })
    .filter((x): x is BookmarkedListing => x !== null);
}

/**
 * Prüft ob der gegebene Owner (user_id ODER anonymous_id) das Listing
 * bereits gespeichert hat. Genutzt von der Listing-Page um den initialen
 * UI-Zustand des Save-Buttons zu rendern (gefülltes vs. leeres Herz).
 */
export async function isListingBookmarked(
  listingId: string,
  ctx: { userId?: string | null; anonymousId?: string | null }
): Promise<boolean> {
  const keyValue = ctx.userId ?? ctx.anonymousId;
  if (!keyValue) return false;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;
  const keyColumn = ctx.userId ? "user_id" : "anonymous_id";
  const { data, error } = await supabase
    .from("listing_bookmarks")
    .select("id")
    .eq("listing_id", listingId)
    .eq(keyColumn, keyValue)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[bookmarks] isListingBookmarked failed", error);
    return false;
  }
  return Boolean(data);
}
