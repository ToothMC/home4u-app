import { createSupabaseServiceClient } from "@/lib/supabase/server";

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
