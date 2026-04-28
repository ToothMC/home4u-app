import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const MAX_SEARCH_PROFILES = 3;

type OwnerKey =
  | { userId: string; anonymousId?: string | null }
  | { userId?: null; anonymousId: string };

export type PropertyType = "apartment" | "house" | "room" | "plot";

type SearchProfileInsert = OwnerKey & {
  conversationId?: string | null;
  /** rent (Mietsuche) | sale (Kaufsuche). DB-Default ist 'rent' — wenn
   *  Sophie type='sale' meldet, muss dieser Wert hier ankommen, sonst
   *  matched die RPC nur Miet-Listings (Hard-Filter). */
  type?: "rent" | "sale";
  /** Migration 0039: NULL = matched alle Property-Types (apartment+house+
   *  plot+room). Sonst harter Filter — z.B. „nur Grundstücke" mit 'plot'. */
  property_type?: PropertyType;
  location: string;
  budget_min?: number;
  budget_max?: number;
  rooms?: number;
  /** Migration 0042: wenn true, matched RPC nur exakt rooms (kein ±1).
   *  Sophie setzt es bei "genau N", "nur N", "exakt N", "ausschließlich N". */
  rooms_strict?: boolean;
  move_in_date?: string;
  household?: string;
  lifestyle_tags?: string[];
  pets?: boolean;
  free_text?: string;
};

export type UpsertSearchProfileResult =
  | { id: string }
  | { error: "limit_reached" }
  | null;

/**
 * Upsertet ein aktives Suchprofil für den eindeutigen Owner:
 * bei eingeloggtem User → user_id als Schlüssel (anonymous_id wird auf null gesetzt)
 * bei anonymem Besucher  → anonymous_id als Schlüssel
 */
export async function upsertSearchProfile(
  input: SearchProfileInsert
): Promise<UpsertSearchProfileResult> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const keyColumn = input.userId ? "user_id" : "anonymous_id";
  const keyValue = input.userId ?? input.anonymousId!;

  // Innerhalb derselben Conversation upserten — sonst INSERT (neue Suche).
  let existingId: string | null = null;
  if (input.conversationId) {
    const { data: existing } = await supabase
      .from("search_profiles")
      .select("id")
      .eq(keyColumn, keyValue)
      .eq("conversation_id", input.conversationId)
      .limit(1)
      .maybeSingle();
    existingId = existing?.id ?? null;
  }

  // type: nur ins Payload, wenn explizit gesetzt. Bei UPDATE bewahrt das den
  // bestehenden Wert; bei INSERT greift der DB-Default 'rent' falls fehlt.
  // Sophie ist via Tool-Schema verpflichtet, type zu liefern — aber Robustheit.
  const payload: Record<string, unknown> = {
    user_id: input.userId ?? null,
    anonymous_id: input.userId ? null : (input.anonymousId ?? null),
    conversation_id: input.conversationId ?? null,
    location: input.location,
    budget_min: input.budget_min ?? null,
    budget_max: input.budget_max ?? 0,
    rooms: input.rooms ?? null,
    rooms_strict: input.rooms_strict ?? false,
    move_in_date: input.move_in_date ?? null,
    household: input.household ?? null,
    lifestyle_tags: input.lifestyle_tags ?? [],
    pets: input.pets ?? null,
    free_text: input.free_text ?? null,
  };
  if (input.type === "rent" || input.type === "sale") {
    payload.type = input.type;
  }
  // property_type: NULL erlaubt (= kein Filter, alle Property-Types)
  const VALID_PROPERTY_TYPES = ["apartment", "house", "room", "plot"] as const;
  if (
    input.property_type &&
    (VALID_PROPERTY_TYPES as readonly string[]).includes(input.property_type)
  ) {
    payload.property_type = input.property_type;
  }

  if (existingId) {
    const { data, error } = await supabase
      .from("search_profiles")
      .update(payload)
      .eq("id", existingId)
      .select("id")
      .single();
    if (error || !data) {
      console.error("[search_profiles] update failed", error);
      return null;
    }
    return { id: data.id };
  }

  // Limit prüfen, bevor neu angelegt wird.
  const { count, error: countError } = await supabase
    .from("search_profiles")
    .select("id", { count: "exact", head: true })
    .eq(keyColumn, keyValue)
    .eq("active", true);
  if (countError) {
    console.error("[search_profiles] count failed", countError);
    return null;
  }
  if ((count ?? 0) >= MAX_SEARCH_PROFILES) {
    return { error: "limit_reached" };
  }

  const { data, error } = await supabase
    .from("search_profiles")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) {
    console.error("[search_profiles] insert failed", error);
    return null;
  }
  return { id: data.id };
}

export type ActiveSearchProfile = {
  id: string;
  location: string;
  type: "rent" | "sale";
  rooms: number | null;
  budget_min: number | null;
  budget_max: number | null;
};

/**
 * Lädt das aktive Suchprofil. Genutzt vom Transient-Lookup (lib/transient/),
 * um die Live-Search-URL zu bauen, wenn match_listings_for_profile zu wenig
 * Treffer liefert.
 */
export async function loadActiveSearchProfile(ctx: {
  userId?: string | null;
  anonymousId?: string | null;
}): Promise<ActiveSearchProfile | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const keyColumn = ctx.userId ? "user_id" : "anonymous_id";
  const keyValue = ctx.userId ?? ctx.anonymousId;
  if (!keyValue) return null;

  const { data, error } = await supabase
    .from("search_profiles")
    .select("id, location, type, rooms, budget_min, budget_max")
    .eq(keyColumn, keyValue)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    location: data.location as string,
    type: data.type as "rent" | "sale",
    rooms: (data.rooms as number) ?? null,
    budget_min: data.budget_min != null ? Number(data.budget_min) : null,
    budget_max: data.budget_max != null ? Number(data.budget_max) : null,
  };
}

export async function updateSearchProfileField(
  ctx: { userId?: string | null; anonymousId?: string | null },
  field: string,
  value: unknown
): Promise<boolean> {
  const ALLOWED = new Set([
    "type",
    "property_type",
    "location",
    "budget_min",
    "budget_max",
    "rooms",
    "rooms_strict",
    "move_in_date",
    "household",
    "lifestyle_tags",
    "pets",
    "free_text",
  ]);
  if (!ALLOWED.has(field)) return false;
  if (field === "type" && value !== "rent" && value !== "sale") return false;
  if (field === "rooms_strict" && typeof value !== "boolean") return false;
  if (
    field === "property_type" &&
    value !== null &&
    value !== "apartment" &&
    value !== "house" &&
    value !== "room" &&
    value !== "plot"
  ) {
    return false;
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;

  const keyColumn = ctx.userId ? "user_id" : "anonymous_id";
  const keyValue = ctx.userId ?? ctx.anonymousId;
  if (!keyValue) return false;

  const { error } = await supabase
    .from("search_profiles")
    .update({ [field]: value })
    .eq(keyColumn, keyValue)
    .eq("active", true);
  if (error) {
    console.error("[search_profiles] field update failed", error);
    return false;
  }
  return true;
}
