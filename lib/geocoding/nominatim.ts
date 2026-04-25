/**
 * Geocoding via OpenStreetMap Nominatim.
 *
 * Nutzungsregeln (https://operations.osmfoundation.org/policies/nominatim/):
 * - Max 1 Request/Sekunde
 * - Aussagekräftiger User-Agent
 * - Aggressives Caching (deshalb geocode_cache-Tabelle)
 *
 * Cyprus-Listings → countrycodes=cy.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type GeoHit = {
  lat: number;
  lng: number;
  display_name: string;
};

const RATE_LIMIT_MS = 1100;
let lastCall = 0;

function buildQueryKey(parts: { address: string | null; district: string | null; city: string }): string {
  const segs = [parts.address, parts.district, parts.city, "Cyprus"]
    .filter(Boolean)
    .map((s) => s!.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return segs.join("|");
}

function buildQueryString(parts: { address: string | null; district: string | null; city: string }): string {
  return [parts.address, parts.district, parts.city, "Cyprus"]
    .filter(Boolean)
    .join(", ");
}

async function nominatimSearch(query: string): Promise<GeoHit | null> {
  // Rate-Limit
  const wait = Math.max(0, lastCall + RATE_LIMIT_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "cy");

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Home4U-Geocoder/0.1 (contact@home4u.ai)",
        "Accept-Language": "en",
      },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!data?.length) return null;
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      display_name: data[0].display_name,
    };
  } catch (err) {
    console.error("[geocode] nominatim error", err);
    return null;
  }
}

/**
 * Cached geocoding. Liefert null bei nicht gefunden.
 * Versucht spezifisch (mit Adresse) → fallback auf district+city → city only.
 */
export async function geocodeListingLocation(parts: {
  address: string | null;
  district: string | null;
  city: string;
}): Promise<GeoHit | null> {
  const supabase = createSupabaseServiceClient();

  // Drei Query-Stufen, von spezifisch zu grob
  const attempts: { key: string; query: string }[] = [];
  if (parts.address) {
    attempts.push({
      key: buildQueryKey(parts),
      query: buildQueryString(parts),
    });
  }
  if (parts.district) {
    attempts.push({
      key: buildQueryKey({ address: null, district: parts.district, city: parts.city }),
      query: buildQueryString({ address: null, district: parts.district, city: parts.city }),
    });
  }
  attempts.push({
    key: buildQueryKey({ address: null, district: null, city: parts.city }),
    query: buildQueryString({ address: null, district: null, city: parts.city }),
  });

  for (const attempt of attempts) {
    // Cache-Lookup
    if (supabase) {
      const { data: cached } = await supabase
        .from("geocode_cache")
        .select("lat, lng, display_name, not_found")
        .eq("query_key", attempt.key)
        .maybeSingle();
      if (cached) {
        // touch-update last_used + hit_count
        await supabase
          .from("geocode_cache")
          .update({
            last_used: new Date().toISOString(),
            hit_count: undefined,
          })
          .eq("query_key", attempt.key);
        if (cached.not_found) continue;
        if (cached.lat != null && cached.lng != null) {
          return {
            lat: Number(cached.lat),
            lng: Number(cached.lng),
            display_name: cached.display_name ?? "",
          };
        }
      }
    }

    // Live-Call
    const hit = await nominatimSearch(attempt.query);
    if (supabase) {
      await supabase.from("geocode_cache").upsert(
        {
          query_key: attempt.key,
          lat: hit?.lat ?? null,
          lng: hit?.lng ?? null,
          display_name: hit?.display_name ?? null,
          not_found: !hit,
          last_used: new Date().toISOString(),
        },
        { onConflict: "query_key" }
      );
    }
    if (hit) return hit;
  }

  return null;
}
