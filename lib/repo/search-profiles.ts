import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SearchProfileInsert = {
  anonymousId: string;
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

export async function upsertSearchProfile(
  input: SearchProfileInsert
): Promise<{ id: string } | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const { data: existing } = await supabase
    .from("search_profiles")
    .select("id")
    .eq("anonymous_id", input.anonymousId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  const payload = {
    anonymous_id: input.anonymousId,
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
  anonymousId: string,
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

  const { error } = await supabase
    .from("search_profiles")
    .update({ [field]: value })
    .eq("anonymous_id", anonymousId)
    .eq("active", true);
  if (error) {
    console.error("[search_profiles] field update failed", error);
    return false;
  }
  return true;
}
