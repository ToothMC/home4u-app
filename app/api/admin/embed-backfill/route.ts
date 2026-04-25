// Backfill: berechnet fehlende Embeddings für listings + search_profiles.
// Admin-only. Läuft idempotent und in Batches; gibt nach jedem Lauf einen
// Counter zurück. Aufruf z.B. via curl mit gültigem Cookie:
//   curl -b cookies.txt -X POST http://localhost:3000/api/admin/embed-backfill?limit=100
//
// Empfehlung: nach Migration 0010 einmalig durchlaufen lassen, danach übernehmen
// die fire-and-forget-Hooks in tool-handlers + bulk-import.

import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  embedTexts,
  listingToEmbedText,
  profileToEmbedText,
} from "@/lib/embeddings";
import { openaiConfigured } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return Response.json({ error: "forbidden", reason: "admin_only" }, { status: 403 });
  }
  if (!openaiConfigured()) {
    return Response.json({ error: "openai_not_configured" }, { status: 503 });
  }
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return Response.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(10, Number(url.searchParams.get("limit")) || 100));

  const result = {
    listings: { processed: 0, embedded: 0, errors: 0 },
    profiles: { processed: 0, embedded: 0, errors: 0 },
  };

  // Listings ohne Embedding
  const { data: listings, error: lErr } = await supabase
    .from("listings")
    .select(
      "id, type, location_city, location_district, price, currency, rooms, size_sqm, language"
    )
    .is("embedding", null)
    .eq("status", "active")
    .limit(limit);
  if (lErr) {
    return Response.json({ error: "listings_query_failed", detail: lErr.message }, { status: 500 });
  }

  if (listings && listings.length > 0) {
    result.listings.processed = listings.length;
    const texts = listings.map((row) =>
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
    try {
      const vectors = await embedTexts(texts);
      await Promise.all(
        listings.map(async (row, idx) => {
          const v = vectors[idx];
          if (!v) {
            result.listings.errors += 1;
            return;
          }
          const { error } = await supabase
            .from("listings")
            .update({ embedding: v as unknown as string })
            .eq("id", row.id);
          if (error) {
            result.listings.errors += 1;
          } else {
            result.listings.embedded += 1;
          }
        })
      );
    } catch (err) {
      console.error("[backfill] listings embed failed", err);
      result.listings.errors = listings.length;
    }
  }

  // Search-Profile ohne Embedding
  const { data: profiles, error: pErr } = await supabase
    .from("search_profiles")
    .select(
      "id, location, budget_min, budget_max, rooms, type, household, lifestyle_tags, free_text"
    )
    .is("embedding", null)
    .eq("active", true)
    .limit(limit);
  if (pErr) {
    return Response.json({ error: "profiles_query_failed", detail: pErr.message }, { status: 500 });
  }

  if (profiles && profiles.length > 0) {
    result.profiles.processed = profiles.length;
    const texts = profiles.map((row) =>
      profileToEmbedText({
        location: row.location,
        budget_min: row.budget_min,
        budget_max: row.budget_max,
        rooms: row.rooms,
        type: row.type,
        household: row.household,
        lifestyle_tags: row.lifestyle_tags,
        free_text: row.free_text,
      })
    );
    try {
      const vectors = await embedTexts(texts);
      await Promise.all(
        profiles.map(async (row, idx) => {
          const v = vectors[idx];
          if (!v) {
            result.profiles.errors += 1;
            return;
          }
          const { error } = await supabase
            .from("search_profiles")
            .update({ embedding: v as unknown as string })
            .eq("id", row.id);
          if (error) {
            result.profiles.errors += 1;
          } else {
            result.profiles.embedded += 1;
          }
        })
      );
    } catch (err) {
      console.error("[backfill] profiles embed failed", err);
      result.profiles.errors = profiles.length;
    }
  }

  return Response.json({
    ok: true,
    limit,
    ...result,
    note:
      result.listings.processed === limit || result.profiles.processed === limit
        ? "Mehr Daten zu verarbeiten — Endpoint nochmal aufrufen."
        : "Alles aktuell.",
  });
}
