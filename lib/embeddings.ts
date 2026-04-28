import { EMBEDDING_DIM, EMBEDDING_MODEL, getOpenAI, openaiConfigured } from "./openai";
import { createSupabaseServiceClient } from "./supabase/server";

export type ListingEmbedInput = {
  type: "rent" | "sale";
  location_city: string;
  location_district?: string | null;
  price?: number | null;
  currency?: string | null;
  rooms?: number | null;
  size_sqm?: number | null;
  language?: string | null;
  raw_text?: string | null;
};

export type SearchProfileEmbedInput = {
  location: string;
  budget_min?: number | null;
  budget_max?: number | null;
  rooms?: number | null;
  type?: "rent" | "sale" | null;
  /** Migration 0039 — engt das Embedding semantisch ein, damit
   *  „Plot in Paphos" cosine-näher bei Plot-Listings als bei Apartments liegt. */
  property_type?: "apartment" | "house" | "room" | "plot" | null;
  household?: string | null;
  lifestyle_tags?: string[] | null;
  free_text?: string | null;
};

const MAX_BATCH = 96;

/**
 * Erzeugt einen kompakten, embedding-tauglichen Repräsentations-Text.
 * Bewusst kurz (≤ 200 Tokens) — Cosine-Match misst Profil-vs-Listing-Affinität,
 * keine Volltextsuche. Format ist konsistent zwischen Listing und Profil,
 * damit der Vektor-Raum aligned ist.
 */
export function listingToEmbedText(l: ListingEmbedInput): string {
  const parts: string[] = [
    `Property: ${l.type === "rent" ? "Rental" : "Sale"}`,
    `City: ${l.location_city}`,
  ];
  if (l.location_district) parts.push(`District: ${l.location_district}`);
  if (l.rooms != null) parts.push(`Rooms: ${l.rooms}`);
  if (l.size_sqm != null) parts.push(`Size: ${l.size_sqm} sqm`);
  if (l.price != null && l.currency) {
    parts.push(`Price: ${l.price} ${l.currency}${l.type === "rent" ? "/month" : ""}`);
  }
  if (l.language) parts.push(`Language: ${l.language}`);
  if (l.raw_text) parts.push(`Notes: ${l.raw_text.slice(0, 500)}`);
  return parts.join(" | ");
}

export function profileToEmbedText(p: SearchProfileEmbedInput): string {
  const parts: string[] = [
    `Search: ${p.type === "sale" ? "Sale" : "Rental"}`,
    `Location: ${p.location}`,
  ];
  if (p.property_type) {
    // Capitalize: 'apartment' → 'Apartment'. Konsistent mit Listing-Format.
    parts.push(
      `Type: ${p.property_type[0].toUpperCase()}${p.property_type.slice(1)}`,
    );
  }
  if (p.rooms != null) parts.push(`Rooms: ${p.rooms}`);
  if (p.budget_max != null) {
    const min = p.budget_min ?? 0;
    parts.push(`Budget: ${min}-${p.budget_max} EUR${p.type === "sale" ? "" : "/month"}`);
  }
  if (p.household) parts.push(`Household: ${p.household}`);
  if (p.lifestyle_tags && p.lifestyle_tags.length > 0) {
    parts.push(`Lifestyle: ${p.lifestyle_tags.join(", ")}`);
  }
  if (p.free_text) parts.push(`Wishes: ${p.free_text.slice(0, 500)}`);
  return parts.join(" | ");
}

/**
 * Embed eine oder mehrere Strings via OpenAI text-embedding-3-small.
 * Wirft, wenn OPENAI_API_KEY fehlt — Caller muss dafür sorgen, dass
 * embedding optional bleibt (z.B. silent-skip bei nicht konfiguriert).
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getOpenAI();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIM,
    });
    for (const item of res.data) {
      out.push(item.embedding);
    }
  }
  return out;
}

export async function embedText(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v;
}

/**
 * Schreibt das Embedding zurück in die listings-Tabelle. Silent-skip wenn
 * Supabase oder OpenAI nicht konfiguriert sind — Listing wurde bereits
 * angelegt, Embedding ist Best-Effort.
 */
export async function embedAndStoreListing(listingId: string, input: ListingEmbedInput): Promise<boolean> {
  if (!openaiConfigured()) return false;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;
  try {
    const text = listingToEmbedText(input);
    const vector = await embedText(text);
    const { error } = await supabase
      .from("listings")
      .update({ embedding: vector as unknown as string })
      .eq("id", listingId);
    if (error) {
      console.error("[embeddings] listing update failed", listingId, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[embeddings] embedAndStoreListing failed", listingId, err);
    return false;
  }
}

export async function embedAndStoreSearchProfile(
  profileId: string,
  input: SearchProfileEmbedInput
): Promise<boolean> {
  if (!openaiConfigured()) return false;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;
  try {
    const text = profileToEmbedText(input);
    const vector = await embedText(text);
    const { error } = await supabase
      .from("search_profiles")
      .update({ embedding: vector as unknown as string })
      .eq("id", profileId);
    if (error) {
      console.error("[embeddings] profile update failed", profileId, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[embeddings] embedAndStoreSearchProfile failed", profileId, err);
    return false;
  }
}

/**
 * Bulk-Variante: für Bulk-Upload-Pfad. Holt die frisch eingefügten/aktualisierten
 * Listings aus DB (per dedup_hash), embedded sie und schreibt zurück.
 */
export async function embedAndStoreListingsByHash(
  brokerId: string,
  dedupHashes: string[]
): Promise<{ embedded: number; skipped: number }> {
  if (!openaiConfigured() || dedupHashes.length === 0) {
    return { embedded: 0, skipped: dedupHashes.length };
  }
  const supabase = createSupabaseServiceClient();
  if (!supabase) return { embedded: 0, skipped: dedupHashes.length };

  const { data, error } = await supabase
    .from("listings")
    .select(
      "id, type, location_city, location_district, price, currency, rooms, size_sqm, language"
    )
    .eq("owner_user_id", brokerId)
    .in("dedup_hash", dedupHashes);
  if (error || !data) {
    console.error("[embeddings] bulk fetch failed", error);
    return { embedded: 0, skipped: dedupHashes.length };
  }

  const texts = data.map((row) =>
    listingToEmbedText({
      type: row.type as "rent" | "sale",
      location_city: row.location_city,
      location_district: row.location_district,
      price: row.price,
      currency: row.currency,
      rooms: row.rooms,
      size_sqm: row.size_sqm,
      language: row.language,
    })
  );

  let vectors: number[][] = [];
  try {
    vectors = await embedTexts(texts);
  } catch (err) {
    console.error("[embeddings] bulk embed call failed", err);
    return { embedded: 0, skipped: data.length };
  }

  let embedded = 0;
  // Pro Listing einzeln updaten — Supabase unterstützt kein bulk-update über JS-SDK
  // ohne RPC. Kosten ist tragbar bei <5000 Zeilen pro Upload.
  await Promise.all(
    data.map(async (row, idx) => {
      const v = vectors[idx];
      if (!v) return;
      const { error: upErr } = await supabase
        .from("listings")
        .update({ embedding: v as unknown as string })
        .eq("id", row.id);
      if (!upErr) embedded += 1;
      else console.error("[embeddings] bulk update failed", row.id, upErr);
    })
  );

  return { embedded, skipped: dedupHashes.length - embedded };
}
