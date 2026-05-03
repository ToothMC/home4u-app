// PATCH + DELETE eines Listings — nur Owner darf.
// Authentifizierte User: RLS macht den Auth-Check.
// Service-Role-Pfad mit explizitem owner-check für Konsistenz mit Match-APIs.

import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { geocodeListingLocation } from "@/lib/geocoding/nominatim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    title: z.string().max(160).nullable().optional(),
    description: z.string().max(8000).nullable().optional(),
    type: z.enum(["rent", "sale"]).optional(),
    location_city: z.string().min(1).max(120).optional(),
    location_district: z.string().max(120).nullable().optional(),
    price: z.number().min(0).max(50_000_000).optional(),
    currency: z.string().min(3).max(3).optional(),
    rooms: z.number().int().min(0).max(20).nullable().optional(),
    bathrooms: z.number().int().min(0).max(20).nullable().optional(),
    size_sqm: z.number().int().min(0).max(10000).nullable().optional(),
    plot_sqm: z.number().int().min(0).max(1_000_000).nullable().optional(),
    property_type: z.string().max(40).nullable().optional(),
    floor: z.string().max(40).nullable().optional(),
    year_built: z.number().int().min(1800).max(2100).nullable().optional(),
    energy_class: z.string().max(8).nullable().optional(),
    furnishing: z.enum(["furnished", "semi_furnished", "unfurnished"]).nullable().optional(),
    features: z.array(z.string().max(60)).max(40).nullable().optional(),
    pets_allowed: z.boolean().nullable().optional(),
    available_from: z.string().nullable().optional(), // ISO date
    contact_channel: z.string().max(40).nullable().optional(),
    language: z.enum(["de", "en", "ru", "el", "zh"]).nullable().optional(),
    media: z.array(z.string().url().max(1024)).max(100).optional(),
    // Vollständige Statusliste — der Editor bietet im Dropdown alle 7 Werte
    // an (aktiv/reserviert/vermietet/verkauft/fraglich/archiviert/deaktiviert).
    // Sonst kippt das Speichern beim Wechsel auf reserved/rented/sold.
    status: z
      .enum([
        "active",
        "stale",
        "reserved",
        "rented",
        "sold",
        "opted_out",
        "archived",
      ])
      .optional(),
    // Adresse + Geo
    location_address: z.string().max(240).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    // Preise (alle €)
    price_warm: z.number().min(0).max(50_000_000).nullable().optional(),
    price_cold: z.number().min(0).max(50_000_000).nullable().optional(),
    deposit: z.number().min(0).max(50_000_000).nullable().optional(),
    service_charge_monthly: z.number().min(0).max(50_000).nullable().optional(),
    utilities: z
      .object({
        water: z
          .enum(["included", "tenant_pays", "landlord_pays", "estimated"])
          .nullable()
          .optional(),
        electricity: z
          .enum(["included", "tenant_pays", "landlord_pays", "estimated"])
          .nullable()
          .optional(),
        internet: z
          .enum(["included", "tenant_pays", "landlord_pays", "not_provided"])
          .nullable()
          .optional(),
        garbage: z
          .enum(["included", "tenant_pays", "landlord_pays", "estimated"])
          .nullable()
          .optional(),
        bills_in_tenant_name: z.boolean().nullable().optional(),
        estimated_monthly_total: z.number().min(0).max(50_000).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
      })
      .nullable()
      .optional(),
    // Externe Assets für Quick-Actions
    floorplan_url: z.string().url().max(1024).nullable().optional(),
    tour_3d_url: z.string().url().max(1024).nullable().optional(),
    video_url: z.string().url().max(1024).nullable().optional(),
    // Mietvertrag
    contract_min_months: z.number().int().min(0).max(120).nullable().optional(),
    contract_notes: z.string().max(500).nullable().optional(),
  })
  .strict();

async function ensureOwner(listingId: string, userId: string) {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return { ok: false as const, status: 503, error: "supabase_not_configured" };
  const { data, error } = await supabase
    .from("listings")
    .select("owner_user_id")
    .eq("id", listingId)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 404, error: "not_found" };
  if (data.owner_user_id !== userId) {
    return { ok: false as const, status: 403, error: "not_owner" };
  }
  return { ok: true as const, supabase };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", detail: parsed.error.message },
      { status: 400 }
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: "empty_patch" }, { status: 400 });
  }

  const owner = await ensureOwner(id, user.id);
  if (!owner.ok) {
    return Response.json({ error: owner.error }, { status: owner.status });
  }

  // Media als Sonderfall: über RPC, damit listing_photos synchron bleibt
  // (Migration 0040). Sonst sieht der Public-View neue Uploads/Reorder nicht.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { media: mediaPatch, ...nonMediaPatch } = parsed.data;
  if (mediaPatch !== undefined) {
    const { error: mediaErr } = await owner.supabase.rpc("set_listing_media", {
      p_listing_id: id,
      p_media: mediaPatch,
    });
    if (mediaErr) {
      console.error("[listings/PATCH] media rpc failed", mediaErr);
      return Response.json(
        { error: "update_failed", detail: mediaErr.message },
        { status: 500 }
      );
    }
  }

  // Restliche Felder via klassischem update — leerer Patch wird übersprungen.
  const hasNonMedia = Object.keys(nonMediaPatch).length > 0;
  const { data, error } = hasNonMedia
    ? await owner.supabase
        .from("listings")
        .update({ ...nonMediaPatch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id, location_address, location_district, location_city, lat, lng")
        .single()
    : await owner.supabase
        .from("listings")
        .select("id, location_address, location_district, location_city, lat, lng")
        .eq("id", id)
        .single();

  if (error || !data) {
    console.error("[listings/PATCH] update failed", error);
    return Response.json(
      { error: "update_failed", detail: error?.message ?? "unknown" },
      { status: 500 }
    );
  }

  // Geocoding nachziehen wenn Adress-Felder verändert wurden ODER lat/lng noch leer
  // sind (Adresse vorhanden). User-Geo-Override (manueller lat/lng-Patch) vermeidet
  // Re-Geocode automatisch.
  const addressTouched =
    parsed.data.location_address !== undefined ||
    parsed.data.location_district !== undefined ||
    parsed.data.location_city !== undefined;
  const userSetGeo = parsed.data.lat !== undefined || parsed.data.lng !== undefined;
  const needsGeo = !userSetGeo && (addressTouched || data.lat == null);

  if (needsGeo) {
    void geocodeListingLocation({
      address: data.location_address,
      district: data.location_district,
      city: data.location_city,
    }).then(async (hit) => {
      if (!hit) return;
      const { error: geoErr } = await owner.supabase
        .from("listings")
        .update({ lat: hit.lat, lng: hit.lng })
        .eq("id", id);
      if (geoErr) console.error("[geocode] persist failed", id, geoErr);
    });
  }

  return Response.json({ ok: true, id });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const owner = await ensureOwner(id, user.id);
  if (!owner.ok) {
    return Response.json({ error: owner.error }, { status: owner.status });
  }

  const { error } = await owner.supabase.from("listings").delete().eq("id", id);
  if (error) {
    console.error("[listings/DELETE] delete failed", error);
    return Response.json(
      { error: "delete_failed", detail: error.message },
      { status: 500 }
    );
  }
  return Response.json({ ok: true });
}
