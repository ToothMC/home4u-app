import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MapPin, Bed, Bath, Maximize2 } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";
import { LanguageFlagPicker } from "@/components/lang/LanguageFlagPicker";
import { Button } from "@/components/ui/button";
import { ChatLink } from "@/components/landing/PathCards";
import { BrowseFavoriteButton } from "@/components/browse/BrowseFavoriteButton";
import { BrowseFilterBar } from "@/components/browse/BrowseFilterBar";
import {
  applyFiltersToQuery,
  countActiveFilters,
  parseFiltersFromSearchParams,
  serializeFilters,
} from "@/lib/browse/filters";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

type Row = {
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

function roomsTitle(rooms: number | null, propertyType: string | null, t: T) {
  const typeLabel = propertyType
    ? t((`property.${propertyType}`) as TKey) || t("property.fallback")
    : t("property.fallback");
  if (rooms === 0) return `${t("listing.fallbackTitle.studio")} ${typeLabel}`;
  if (!rooms) return typeLabel;
  return `${rooms}${t("listing.fallbackTitle.roomsSuffix")} ${typeLabel}`.trim();
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: `${t("browse.heading")} — Home4U`,
    description: t("browse.subtitle"),
  };
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const pageNum = Math.max(
    1,
    Number.parseInt((Array.isArray(sp.p) ? sp.p[0] : sp.p) ?? "1", 10) || 1,
  );
  const from = (pageNum - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const filters = parseFiltersFromSearchParams(sp);
  const hasFilters = countActiveFilters(filters) > 0;

  const { t, lang } = await getT();
  const supabase = createSupabaseServiceClient();
  const user = await getAuthUser();

  let rows: Row[] = [];
  let total = 0;
  let savedIds = new Set<string>();

  if (supabase) {
    // Sortiert nach created_at (echtes Insert-Datum) — NICHT updated_at, sonst
    // recyceln Crawler-Touches alte Listings nach oben.
    let query = supabase
      .from("listings")
      .select(
        "id, type, rooms, size_sqm, bathrooms, price, currency, location_city, location_district, property_type, media",
        { count: "estimated" },
      )
      .eq("status", "active")
      .not("media", "is", null);

    query = applyFiltersToQuery(query, filters);

    const { data, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    rows = ((data ?? []) as Row[]).filter(
      (r) => Array.isArray(r.media) && r.media.length > 0,
    );
    total = count ?? 0;

    // Initial-Favoriten-Status für eingeloggte User in einer Query holen,
    // damit die Karten direkt korrekt gerendert werden (kein Flicker).
    if (user && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const { data: bm } = await supabase
        .from("listing_bookmarks")
        .select("listing_id")
        .eq("user_id", user.id)
        .in("listing_id", ids);
      savedIds = new Set((bm ?? []).map((b) => b.listing_id as string));
    }
  }

  const isAuthenticated = Boolean(user);

  const hasPrev = pageNum > 1;
  const hasNext = total > pageNum * PAGE_SIZE || rows.length === PAGE_SIZE;
  const filterQs = serializeFilters(filters).toString();
  function pageHref(n: number): string {
    const sp = new URLSearchParams(filterQs);
    if (n > 1) sp.set("p", String(n));
    const qs = sp.toString();
    return qs ? `/stoebern?${qs}` : "/stoebern";
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--warm-cream)]">
      <header className="sticky top-0 z-30 backdrop-blur bg-[var(--warm-cream)]/85 border-b border-[var(--border)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3.5 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              aria-label={t("common.home")}
              className="inline-flex items-center justify-center size-9 rounded-full text-[var(--brand-navy)] hover:bg-[var(--brand-gold-50)] hover:text-[var(--brand-gold)] transition-colors"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <BrandLockup iconSize={32} />
          </div>
          <div className="flex items-center gap-3">
            <LanguageFlagPicker
              initial={lang}
              labels={{ title: t("lang.label"), choose: t("lang.choose") }}
            />
            <AuthMenu />
          </div>
        </div>
      </header>

      <BrowseFilterBar initial={filters} />

      <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-6 sm:pt-8 pb-4">
        <h1 className="font-display text-3xl sm:text-4xl text-[var(--brand-navy)]">
          {t("browse.heading")}
        </h1>
        <p className="mt-2 text-sm text-[var(--warm-bark)]">
          {hasFilters
            ? tFormat(t("browse.resultsCount"), { n: total })
            : t("browse.subtitle")}
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 pb-12">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-12 text-center">
            <p className="text-[var(--warm-bark)] mb-6">{t("browse.empty")}</p>
            <Button asChild>
              <ChatLink>
                {t("browse.startSearch")}
                <ArrowRight />
              </ChatLink>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 sm:gap-6">
            {rows.map((l) => (
              <BrowseCard
                key={l.id}
                listing={l}
                t={t}
                lang={lang}
                initialSaved={savedIds.has(l.id)}
                isAuthenticated={isAuthenticated}
              />
            ))}
          </div>
        )}

        {rows.length > 0 && (hasPrev || hasNext) && (
          <nav
            className="mt-10 flex items-center justify-center gap-3"
            aria-label="Pagination"
          >
            {hasPrev ? (
              <Button asChild variant="outline" size="lg" className="rounded-full">
                <Link href={pageHref(pageNum - 1)} prefetch={false}>
                  <ArrowLeft />
                  {t("browse.prev")}
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="lg" className="rounded-full" disabled>
                <ArrowLeft />
                {t("browse.prev")}
              </Button>
            )}
            <span className="text-sm text-[var(--warm-bark)] tabular-nums px-2">
              {tFormat(t("browse.page"), { n: pageNum })}
            </span>
            {hasNext ? (
              <Button asChild variant="outline" size="lg" className="rounded-full">
                <Link href={pageHref(pageNum + 1)} prefetch={false}>
                  {t("browse.next")}
                  <ArrowRight />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="lg" className="rounded-full" disabled>
                {t("browse.next")}
                <ArrowRight />
              </Button>
            )}
          </nav>
        )}
      </section>
    </main>
  );
}

function BrowseCard({
  listing,
  t,
  lang,
  initialSaved,
  isAuthenticated,
}: {
  listing: Row;
  t: T;
  lang: SupportedLang;
  initialSaved: boolean;
  isAuthenticated: boolean;
}) {
  const cover = listing.media?.[0];
  return (
    <Link
      href={`/listings/${listing.id}`}
      className="group relative flex flex-col rounded-2xl overflow-hidden bg-white border border-[var(--border)] hover:border-[var(--brand-gold-300)] hover:shadow-[0_14px_40px_-10px_rgb(120_90_50/14%)] transition-all"
    >
      <div className="relative aspect-[4/3] bg-[var(--muted)] overflow-hidden">
        {cover && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={cover}
            alt=""
            className="absolute inset-0 h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
            loading="lazy"
          />
        )}
        <BrowseFavoriteButton
          listingId={listing.id}
          initialSaved={initialSaved}
          isAuthenticated={isAuthenticated}
        />
      </div>
      <div className="p-4 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-lg font-semibold text-[var(--brand-navy)]">
            {fmt(listing.price, listing.currency, lang)}
            {listing.type === "rent" && (
              <span className="text-xs font-normal text-[var(--warm-bark)]">
                {" "}
                {t("listing.price.perMonth")}
              </span>
            )}
          </div>
        </div>
        <h3 className="text-sm font-medium text-[var(--brand-navy)] leading-snug line-clamp-1">
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
        <div className="flex items-center gap-3 text-[11px] text-[var(--warm-bark)] pt-2 mt-1 border-t border-[var(--border)]">
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
