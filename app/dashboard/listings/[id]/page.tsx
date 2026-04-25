import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import {
  ListingEditor,
  type EditableListing,
} from "@/components/dashboard/ListingEditor";
import { getAuthUser } from "@/lib/supabase/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) {
    redirect(`/?auth=required&next=/dashboard/listings/${id}`);
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) redirect("/dashboard");

  const { data, error } = await supabase
    .from("listings")
    .select(
      `id, title, description, type, status, location_city, location_district,
       location_address, lat, lng,
       price, price_warm, price_cold, deposit, service_charge_monthly, utilities, currency,
       rooms, bathrooms, size_sqm, plot_sqm,
       property_type, floor, year_built, energy_class, furnishing,
       features, pets_allowed, available_from, contact_channel, language, media,
       floorplan_url, tour_3d_url, video_url,
       contract_min_months, contract_notes, ai_analyzed_at,
       owner_user_id, source, external_id`
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  if (data.owner_user_id !== user.id) {
    redirect("/dashboard");
  }

  const listing: EditableListing = {
    id: data.id,
    title: data.title ?? null,
    description: data.description ?? null,
    type: data.type as "rent" | "sale",
    status: data.status,
    location_city: data.location_city,
    location_district: data.location_district,
    location_address: data.location_address ?? null,
    lat: data.lat != null ? Number(data.lat) : null,
    lng: data.lng != null ? Number(data.lng) : null,
    price: Number(data.price),
    price_warm: data.price_warm != null ? Number(data.price_warm) : null,
    price_cold: data.price_cold != null ? Number(data.price_cold) : null,
    deposit: data.deposit != null ? Number(data.deposit) : null,
    service_charge_monthly:
      data.service_charge_monthly != null ? Number(data.service_charge_monthly) : null,
    utilities: data.utilities ?? null,
    currency: data.currency,
    rooms: data.rooms,
    bathrooms: data.bathrooms ?? null,
    size_sqm: data.size_sqm,
    plot_sqm: data.plot_sqm ?? null,
    property_type: data.property_type ?? null,
    floor: data.floor ?? null,
    year_built: data.year_built ?? null,
    energy_class: data.energy_class ?? null,
    furnishing: data.furnishing ?? null,
    features: data.features ?? [],
    pets_allowed: data.pets_allowed ?? null,
    available_from: data.available_from ?? null,
    contact_channel: data.contact_channel ?? null,
    language: data.language ?? null,
    media: data.media ?? [],
    floorplan_url: data.floorplan_url ?? null,
    tour_3d_url: data.tour_3d_url ?? null,
    video_url: data.video_url ?? null,
    contract_min_months: data.contract_min_months ?? null,
    contract_notes: data.contract_notes ?? null,
    ai_analyzed_at: data.ai_analyzed_at ?? null,
  };

  return (
    <main className="flex-1">
      <header className="mx-auto max-w-3xl w-full px-4 pt-4 flex items-center justify-between">
        <Link
          href="/dashboard?view=provider"
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> Inserate
        </Link>
        <AuthMenu />
      </header>

      <section className="mx-auto max-w-3xl w-full px-4 pt-4 pb-10">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">
            Inserat bearbeiten
          </h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1 flex items-center gap-1">
            <Sparkles className="size-3" />
            Sophie befüllt diese Felder per Foto-Analyse — hier kontrollierst und korrigierst du.
            {data.source && data.source !== "direct" && (
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px]">
                {data.source}
              </span>
            )}
          </p>
        </div>

        <ListingEditor initial={listing} />
      </section>
    </main>
  );
}
