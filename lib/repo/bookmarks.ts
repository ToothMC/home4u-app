import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type BookmarkedListing = {
  bookmarkId: string;
  bookmarkedAt: string;
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
      `id, created_at,
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

  return (data ?? [])
    .map((row): BookmarkedListing | null => {
      // Supabase typed `listings` als Array auch bei !inner — flatten.
      const l = Array.isArray(row.listings) ? row.listings[0] : row.listings;
      if (!l) return null;
      return {
        bookmarkId: row.id as string,
        bookmarkedAt: row.created_at as string,
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
