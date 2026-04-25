// PATCH + DELETE eines Listings — nur Owner darf.
// Authentifizierte User: RLS macht den Auth-Check.
// Service-Role-Pfad mit explizitem owner-check für Konsistenz mit Match-APIs.

import { z } from "zod";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

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
    language: z.enum(["de", "en", "ru", "el"]).nullable().optional(),
    media: z.array(z.string().url().max(1024)).max(40).optional(),
    status: z.enum(["active", "stale", "opted_out", "archived"]).optional(),
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

  const { data, error } = await owner.supabase
    .from("listings")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .single();

  if (error || !data) {
    console.error("[listings/PATCH] update failed", error);
    return Response.json(
      { error: "update_failed", detail: error?.message ?? "unknown" },
      { status: 500 }
    );
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
