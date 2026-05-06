import Link from "next/link";
import { ArrowRight, MapPin, Bed, Bath, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { detectRegion } from "@/lib/geo/detect-region";
import { getT } from "@/lib/i18n/server";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

type FeaturedListing = {
  id: string;
  type: "rent" | "sale";
  rooms: number | null;
  size_sqm: number | null;
  bathrooms: number | null;
  price: number;
  currency: string;
  location_city: string;
  location_district: string | null;
  property_type: string | null;
  media: string[] | null;
};

function fmt(price: number, currency: string, lang: SupportedLang) {
  return new Intl.NumberFormat(NUMBER_LOCALE[lang], {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

function roomsTitle(
  rooms: number | null,
  propertyType: string | null,
  t: T,
): string {
  const typeLabel = propertyType
    ? t((`property.${propertyType}`) as TKey) || t("property.fallback")
    : t("property.fallback");
  if (rooms === 0) return `${t("listing.fallbackTitle.studio")} ${typeLabel}`;
  if (!rooms) return typeLabel;
  return `${rooms}${t("listing.fallbackTitle.roomsSuffix")} ${typeLabel}`.trim();
}

export async function FeaturedListings({
  regionSlug,
}: {
  regionSlug?: string | null;
} = {}) {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return null;
  }

  // Region: URL-Param → letzte Suche → IP-Geo → fallback (kein Filter).
  const detected = await detectRegion({ urlSlug: regionSlug });
  const region = detected.region;

  // "Neu reingekommen" = sortiert nach created_at (echtes Insert-Datum), NICHT
  // updated_at — sonst würde nach jedem Crawler-Touch das gleiche alte Listing
  // wieder oben landen.
  let query = supabase
    .from("listings")
    .select(
      "id, type, rooms, size_sqm, bathrooms, price, currency, location_city, location_district, property_type, media, status, created_at"
    )
    .eq("status", "active")
    .not("media", "is", null)
    .order("created_at", { ascending: false })
    .limit(region ? 16 : 8);

  if (region) {
    // Prefix-Match deckt "Paphos", "Paphos District", "Paphos – Universal" etc. ab.
    query = query.ilike("location_city", `${region.cityPrefix}%`);
  }

  const { data } = await query;

  let listings = (data ?? [])
    .filter(
      (l): l is FeaturedListing & { status: string; created_at: string } =>
        Array.isArray(l.media) && l.media.length > 0
    )
    .slice(0, 4);

  // Wenn Region-Filter zu wenig liefert (< 2), greift Fallback auf Mix.
  if (region && listings.length < 2) {
    const { data: fallback } = await supabase
      .from("listings")
      .select(
        "id, type, rooms, size_sqm, bathrooms, price, currency, location_city, location_district, property_type, media, status, created_at"
      )
      .eq("status", "active")
      .not("media", "is", null)
      .order("created_at", { ascending: false })
      .limit(8);
    listings = (fallback ?? [])
      .filter(
        (l): l is FeaturedListing & { status: string; created_at: string } =>
          Array.isArray(l.media) && l.media.length > 0
      )
      .slice(0, 4);
  }

  if (listings.length === 0) return null;

  const { t, lang } = await getT();
  const heading = region
    ? tFormat(t("featured.headingIn"), { region: region.label })
    : t("featured.headingFor");

  return (
    <section className="mx-auto max-w-6xl px-6 pb-12 sm:pb-20">
      <h2 className="font-display text-3xl sm:text-4xl text-center text-[var(--brand-navy)] mb-10">
        {heading}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {listings.map((l) => (
          <ListingCard key={l.id} listing={l} t={t} lang={lang} />
        ))}
      </div>

      <div className="flex justify-center mt-10">
        <Button asChild variant="outline" size="lg" className="rounded-full">
          <Link href="/matches">
            {t("featured.viewAll")}
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function ListingCard({
  listing,
  t,
  lang,
}: {
  listing: FeaturedListing;
  t: T;
  lang: SupportedLang;
}) {
  const cover = listing.media?.[0];
  return (
    <Link
      href={`/listings/${listing.id}`}
      className="group rounded-2xl overflow-hidden bg-white border border-[var(--border)] hover:border-[var(--brand-gold-300)] hover:shadow-[0_14px_40px_-10px_rgb(120_90_50/12%)] transition-all flex flex-col"
    >
      <div className="relative aspect-[4/3] bg-[var(--muted)] overflow-hidden">
        {cover && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={cover}
            alt=""
            className="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        )}
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <h3 className="font-medium text-[var(--brand-navy)] leading-snug">
          {roomsTitle(listing.rooms, listing.property_type, t)}
        </h3>
        <div className="flex items-center gap-1 text-xs text-[var(--warm-bark)]">
          <MapPin className="size-3 text-[var(--brand-gold)]" />
          <span className="truncate">
            {listing.location_district
              ? `${listing.location_district}, ${listing.location_city}`
              : listing.location_city}
          </span>
        </div>
        <div className="text-lg font-semibold text-[var(--brand-navy)] mt-auto">
          {fmt(listing.price, listing.currency, lang)}
          {listing.type === "rent" && (
            <span className="text-xs font-normal text-[var(--warm-bark)]"> {t("listing.price.perMonth")}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--warm-bark)] pt-2 border-t border-[var(--border)]">
          {listing.size_sqm && (
            <span className="inline-flex items-center gap-1">
              <Maximize2 className="size-3" />
              {listing.size_sqm} m²
            </span>
          )}
          {listing.rooms !== null && listing.rooms > 0 && (
            <span className="inline-flex items-center gap-1">
              <Bed className="size-3" />
              {listing.rooms}
            </span>
          )}
          {listing.bathrooms && (
            <span className="inline-flex items-center gap-1">
              <Bath className="size-3" />
              {listing.bathrooms}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
