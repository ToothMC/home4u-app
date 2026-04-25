// POST /api/admin/geocode-backfill?limit=30
// Geocodet Listings ohne lat/lng. Admin-only.
// Pro Run-Limit (default 30) wegen Nominatim-Rate-Limit (1 req/sec).

import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { geocodeListingLocation } from "@/lib/geocoding/nominatim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return Response.json({ error: "forbidden", reason: "admin_only" }, { status: 403 });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return Response.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const limit = Math.min(60, Math.max(5, Number(url.searchParams.get("limit")) || 30));

  const { data: listings, error } = await supabase
    .from("listings")
    .select("id, location_address, location_district, location_city")
    .is("lat", null)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    return Response.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }
  if (!listings || listings.length === 0) {
    return Response.json({ ok: true, processed: 0, hits: 0, note: "Alles aktuell." });
  }

  let hits = 0;
  let misses = 0;
  for (const l of listings) {
    const result = await geocodeListingLocation({
      address: l.location_address,
      district: l.location_district,
      city: l.location_city,
    });
    if (result) {
      const { error: upErr } = await supabase
        .from("listings")
        .update({ lat: result.lat, lng: result.lng })
        .eq("id", l.id);
      if (!upErr) hits += 1;
    } else {
      misses += 1;
    }
  }

  return Response.json({
    ok: true,
    processed: listings.length,
    hits,
    misses,
    note:
      listings.length === limit
        ? "Mehr Daten zu verarbeiten — Endpoint nochmal aufrufen."
        : "Alles aktuell.",
  });
}
