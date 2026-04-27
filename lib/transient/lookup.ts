/**
 * Transient Lookup Orchestrator (Indexer-Spec v2.0 §5).
 *
 * - Trigger: Aufrufer entscheidet (Default: < N_MIN Index-Treffer).
 * - Cache: transient_lookups-Tabelle, profile_hash-keyed, TTL 1h.
 * - Quelle Phase 1: Bazaraki via fetchTransientBazaraki (HTTP-only).
 * - Output: TransientCandidate[] mit isTransient=true.
 * - Failure-Modus: bei rate_limited / error returnen wir leeres Array; der
 *   Aufrufer hat dann eben weniger Treffer (die Index-Treffer bleiben).
 */
import { createHash } from "node:crypto";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  fetchTransientBazaraki,
  type SearchProfile,
  type TransientCandidate,
} from "./bazaraki-search";

export const TRANSIENT_LIMIT_DEFAULT = 5;
/** Index-Treffer-Schwelle, ab der wir Transient zumischen. Wird von
 *  findMatchesForSession() aus Spec §5.1 gelesen (N_MIN = 3). */
export const TRANSIENT_TRIGGER_BELOW = 3;

/** Stable Hash über die Profil-Shape — gleiche Suche → gleicher Cache-Key. */
export function computeProfileHash(profile: SearchProfile): string {
  const parts = [
    profile.city.trim().toLowerCase(),
    profile.type,
    profile.rooms ?? "",
    profile.price_min ?? "",
    profile.price_max ?? "",
    profile.property_subtype ?? "apartments-flats",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

type CacheRow = {
  candidates: TransientCandidate[];
  fetched_at: string;
  expires_at: string;
  fetch_status: string;
};

/**
 * Holt transiente Kandidaten für ein Such-Profil. Cache-First mit TTL aus DB.
 * Bei Cache-Miss: fetcht live, schreibt Ergebnis in Cache (auch bei Fehlschlag,
 * mit fetch_status='rate_limited'/'error', kürzerer TTL via update).
 */
export async function findTransientMatches(
  profile: SearchProfile,
  limit = TRANSIENT_LIMIT_DEFAULT,
): Promise<TransientCandidate[]> {
  const sb = createSupabaseServiceClient();
  if (!sb) return [];

  const hash = computeProfileHash(profile);
  const source = "bazaraki" as const;

  // 1) Cache-Lookup
  const { data: cached } = await sb
    .from("transient_lookups")
    .select("candidates, fetched_at, expires_at, fetch_status")
    .eq("profile_hash", hash)
    .eq("source", source)
    .maybeSingle();

  if (cached) {
    const row = cached as unknown as CacheRow;
    const expired = new Date(row.expires_at).getTime() < Date.now();
    if (!expired) {
      // Cache-Hit; auch wenn fetch_status != 'ok' (negative caching, kurzer TTL)
      return Array.isArray(row.candidates)
        ? (row.candidates as TransientCandidate[]).slice(0, limit)
        : [];
    }
    // expired: weiter zu Live-Fetch
  }

  // 2) Live-Fetch
  const result = await fetchTransientBazaraki(profile, limit);

  // 3) Cache schreiben — auch bei Fehler (negative caching, kurzer TTL),
  //    damit wir bei Rate-Limit nicht in eine Retry-Schleife laufen.
  const candidates = result.status === "ok" ? result.candidates : [];
  const ttlMinutes = result.status === "ok" ? 60 : 5;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const fetchStatus = result.status === "ok" ? "ok" : result.status;

  const { error: upsertErr } = await sb
    .from("transient_lookups")
    .upsert(
      {
        profile_hash: hash,
        source,
        candidates,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt,
        fetch_status: fetchStatus,
      },
      { onConflict: "profile_hash,source" },
    );
  if (upsertErr) {
    console.warn("[transient] cache upsert failed", upsertErr.message);
  }

  if (result.status !== "ok") {
    console.warn(
      `[transient] bazaraki fetch ${result.status}: ${result.reason} (${result.url})`,
    );
    return [];
  }
  return candidates;
}

/**
 * Filtert Transient-Kandidaten so, dass keine Duplikate zu bereits aus dem
 * Index gelieferten Bazaraki-Listings landen. Aufrufer ist findMatchesForSession.
 */
export function dedupeAgainstIndex(
  transient: TransientCandidate[],
  indexExternalIdsBySource: Map<string, Set<string>>,
): TransientCandidate[] {
  const seen = indexExternalIdsBySource.get("bazaraki") ?? new Set<string>();
  return transient.filter((c) => !seen.has(c.external_id));
}
