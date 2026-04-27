import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { NormalizedListing } from "@/lib/import/types";
import { loadActiveSearchProfile } from "@/lib/repo/search-profiles";
import {
  TRANSIENT_LIMIT_DEFAULT,
  TRANSIENT_TRIGGER_BELOW,
  dedupeAgainstIndex,
  findTransientMatches,
} from "@/lib/transient/lookup";

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

export type ListingMatch = Listing & {
  score: number;
  external_id: string | null;
  media: string[] | null;
  /** Indexer-Spec v2.0 §5: true → live von Quelle, nicht im Index. UI muss
   *  das markieren ("live von Bazaraki, noch nicht im Index"). */
  isTransient?: boolean;
  /** Nur für Transient: externe URL für "ansehen"-Klick. Index-Listings
   *  haben einen eigenen /listings/[id]-Pfad. */
  detailUrl?: string;
  /** Nur für Transient: Title aus der Listing-Karte. */
  title?: string | null;
};

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
  const indexMatches: ListingMatch[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.listing_id as string,
    source: row.source as string,
    type: row.type as "rent" | "sale",
    external_id: (row.external_id as string) ?? null,
    location_city: row.location_city as string,
    location_district: (row.location_district as string) ?? null,
    price: Number(row.price),
    currency: row.currency as string,
    rooms: (row.rooms as number) ?? null,
    size_sqm: (row.size_sqm as number) ?? null,
    contact_channel: (row.contact_channel as string) ?? null,
    media: (row.media as string[]) ?? null,
    score: Number(row.score ?? 0),
  }));

  // Indexer-Spec v2.0 §5: bei zu wenig Index-Treffern Transient-Mix.
  if (indexMatches.length >= TRANSIENT_TRIGGER_BELOW) return indexMatches;

  const profile = await loadActiveSearchProfile(params);
  if (!profile) return indexMatches;

  const transient = await findTransientMatches(
    {
      city: profile.location,
      type: profile.type,
      rooms: profile.rooms,
      price_min: profile.budget_min,
      price_max: profile.budget_max,
    },
    Math.max(TRANSIENT_LIMIT_DEFAULT, limit - indexMatches.length),
  );

  // Dedup: keine Transient-Items, deren external_id schon im Index ist.
  const indexExternalIds = new Map<string, Set<string>>();
  for (const m of indexMatches) {
    if (!m.external_id) continue;
    if (!indexExternalIds.has(m.source)) indexExternalIds.set(m.source, new Set());
    indexExternalIds.get(m.source)!.add(m.external_id);
  }
  const filtered = dedupeAgainstIndex(transient, indexExternalIds);

  const transientAsMatches: ListingMatch[] = filtered.map((t) => ({
    // Synthetic id: UI darf damit nicht /listings/<id> aufrufen.
    id: `transient-${t.source}-${t.external_id}`,
    source: t.source,
    type: t.type,
    external_id: t.external_id,
    location_city: t.city,
    location_district: t.district,
    price: t.price,
    currency: t.currency,
    rooms: t.rooms,
    size_sqm: t.size_sqm,
    contact_channel: null,
    media: t.media,
    // Konservativer Score: kein Embedding-Match, hard-filter ist via Search-URL
    // erfüllt, kein Scam-Check. Match-Score-Formel §7.2 (mit cosine=0):
    // 0.6×0 + 0.3×1 + 0.1×1 = 0.4.
    score: 0.4,
    isTransient: true,
    detailUrl: t.detail_url,
    title: t.title,
  }));

  return [...indexMatches, ...transientAsMatches].slice(0, limit);
}
