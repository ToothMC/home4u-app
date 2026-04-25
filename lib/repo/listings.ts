import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { NormalizedListing } from "@/lib/import/types";

export class ImporterUnavailableError extends Error {
  constructor() {
    super("Supabase service-role client not configured");
    this.name = "ImporterUnavailableError";
  }
}

export type BulkImportResult = {
  inserted: number;
  updated: number;
  failed: { index: number; reason: string }[];
};

/**
 * Bulk-Upsert über die bulk_upsert_listings-RPC (Migration 0009).
 * Re-Imports aktualisieren bestehende Zeilen via dedup_hash, blocken nicht.
 */
export async function bulkUpsertListings(
  brokerId: string,
  rows: NormalizedListing[]
): Promise<BulkImportResult> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) throw new ImporterUnavailableError();

  const payload = rows.map((r) => ({
    type: r.type,
    location_city: r.location_city,
    location_district: r.location_district,
    price: r.price,
    currency: r.currency,
    rooms: r.rooms,
    size_sqm: r.size_sqm,
    contact_name: r.contact_name,
    contact_phone: r.contact_phone,
    contact_channel: r.contact_channel,
    language: r.language,
    external_id: r.external_id,
    media: r.media,
    dedup_hash: r.dedup_hash,
  }));

  const { data, error } = await supabase.rpc("bulk_upsert_listings", {
    p_broker_id: brokerId,
    p_rows: payload,
  });

  if (error) {
    throw new Error(`bulk_upsert_listings failed: ${error.message}`);
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    inserted?: number;
    updated?: number;
    failed?: { index: number; reason: string }[];
    error?: string;
  };

  if (!result.ok) {
    throw new Error(`bulk_upsert_listings returned error: ${result.error ?? "unknown"}`);
  }

  return {
    inserted: result.inserted ?? 0,
    updated: result.updated ?? 0,
    failed: result.failed ?? [],
  };
}

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
 * Ruft den match_listings_for_profile-RPC auf. Bevorzugt user_id (eingeloggt),
 * fällt auf anonymous_id zurück (anonyme Session). Liefert [] wenn kein
 * aktives Profil existiert oder Supabase nicht konfiguriert ist.
 */
export async function findMatchesForSession(
  params: { anonymousId?: string | null; userId?: string | null },
  limit = 5
): Promise<ListingMatch[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("match_listings_for_profile", {
    p_anonymous_id: params.anonymousId ?? null,
    p_user_id: params.userId ?? null,
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
