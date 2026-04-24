import { createSupabaseServiceClient } from "@/lib/supabase/server";

type OwnerKey =
  | { userId: string; anonymousId?: string | null }
  | { userId?: null; anonymousId: string };

type SearchProfileInsert = OwnerKey & {
  location: string;
  budget_min?: number;
  budget_max?: number;
  rooms?: number;
  move_in_date?: string;
  household?: string;
  lifestyle_tags?: string[];
  pets?: boolean;
  free_text?: string;
};

/**
 * Upsertet ein aktives Suchprofil für den eindeutigen Owner:
 * bei eingeloggtem User → user_id als Schlüssel (anonymous_id wird auf null gesetzt)
 * bei anonymem Besucher  → anonymous_id als Schlüssel
 */
export async function upsertSearchProfile(
  input: SearchProfileInsert
): Promise<{ id: string } | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const keyColumn = input.userId ? "user_id" : "anonymous_id";
  const keyValue = input.userId ?? input.anonymousId!;

  const { data: existing } = await supabase
    .from("search_profiles")
    .select("id")
    .eq(keyColumn, keyValue)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
    user_id: input.userId ?? null,
    anonymous_id: input.userId ? null : (input.anonymousId ?? null),
    location: input.location,
    budget_min: input.budget_min ?? null,
    budget_max: input.budget_max ?? 0,
    rooms: input.rooms ?? null,
    move_in_date: input.move_in_date ?? null,
    household: input.household ?? null,
    lifestyle_tags: input.lifestyle_tags ?? [],
    pets: input.pets ?? null,
    free_text: input.free_text ?? null,
  };

  if (existing) {
    const { data, error } = await supabase
      .from("search_profiles")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error || !data) {
      console.error("[search_profiles] update failed", error);
      return null;
    }
    return { id: data.id };
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

export async function updateSearchProfileField(
  ctx: { userId?: string | null; anonymousId?: string | null },
  field: string,
  value: unknown
): Promise<boolean> {
  const ALLOWED = new Set([
    "location",
    "budget_min",
    "budget_max",
    "rooms",
    "move_in_date",
    "household",
    "lifestyle_tags",
    "pets",
    "free_text",
  ]);
  if (!ALLOWED.has(field)) return false;

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
