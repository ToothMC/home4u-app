import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { HeroGallery } from "@/components/listing-public/HeroGallery";
import { ListingHeaderActions } from "@/components/listing-public/ListingHeaderActions";
import { isListingBookmarked } from "@/lib/repo/bookmarks";
import { getAuthUser } from "@/lib/supabase/auth";
import { RoomGalleryGrid } from "@/components/listing-public/RoomGalleryGrid";
import { QuickFactsBar } from "@/components/listing-public/QuickFactsBar";
import { QuickActionsRow } from "@/components/listing-public/QuickActionsRow";
import { HonestAssessmentBlock } from "@/components/listing-public/HonestAssessmentBlock";
import { LocationBlock } from "@/components/listing-public/LocationBlock";
import { MarketPriceBadge } from "@/components/listing-public/MarketPriceBadge";
import type { MarketData } from "@/components/listing-public/MarketPriceBlock";
import { ScamCheckBlock } from "@/components/scam-shield/ScamCheckBlock";
import { RequestVisitButton } from "@/components/listing-public/RequestVisitButton";
import { RevealPhoneButton } from "@/components/listing-public/RevealPhoneButton";
import {
  SourceLinkButton,
  NoContactFallback,
} from "@/components/listing-public/SourceLinkButton";
import { loadPublicListing } from "@/lib/repo/public-listing";
import { getT } from "@/lib/i18n/server";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

export const dynamic = "force-dynamic";

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

export default async function PublicListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const listing = await loadPublicListing(id);

  if (!listing) {
    notFound();
  }

  const user = await getAuthUser();
  const { t, lang } = await getT();

  // opted_out / archived: hart 404 (Inserent will nicht mehr gezeigt werden) —
  // ABER: der Eigentümer selbst muss die Vorschau weiter sehen können
  const isOwner = !!user && listing.owner_user_id === user.id;
  if (
    !isOwner &&
    (listing.status === "opted_out" || listing.status === "archived")
  ) {
    notFound();
  }
  const unavailable = listing.status !== "active";
  const initialSaved = user
    ? await isListingBookmarked(id, { userId: user.id })
    : false;

  const back =
    from === "edit"
      ? { href: `/dashboard/listings/${id}`, label: t("listing.back.edit") }
      : { href: "/matches", label: t("listing.back.search") };

  const hasOwnerContact =
    listing.source === "direct" && !!listing.owner_user_id;
  const hasImportedContact =
    listing.has_phone_contact || listing.has_email_contact;
  const hasInternalContact = hasOwnerContact || hasImportedContact;
  const showRevealPhone =
    !hasOwnerContact && listing.has_phone_contact && !listing.has_email_contact;

  const heroImages = listing.photos.map((p) => p.url);
  const formattedPrice = formatPrice(
    listing.price_warm ?? listing.price,
    listing.currency,
    lang,
  );
  const priceLabel = listing.type === "rent" ? t("listing.price.perMonth") : "";
  const priceTitle = listing.price_warm
    ? t("listing.price.warm")
    : listing.type === "rent"
      ? t("listing.price.rent")
      : t("listing.price.sale");

  const marketData: MarketData | null = listing.market_position
    ? {
        position: listing.market_position,
        price_per_sqm: listing.price_per_sqm,
        median_eur_sqm: listing.market_median_eur_sqm,
        p25_eur_sqm: listing.market_p25_eur_sqm,
        p75_eur_sqm: listing.market_p75_eur_sqm,
        compset_size: listing.market_compset_size,
        city: listing.location_city,
        district: listing.location_district,
        rooms: listing.rooms,
      }
    : null;

  const fallbackTitleStr = fallbackTitle(
    listing.rooms,
    listing.property_type,
    listing.location_district,
    listing.location_city,
    t,
  );

  const shareTitle = listing.title ?? t("listing.shareTitle");
  const shareText = listing.title
    ? tFormat(t("listing.shareTextOf"), { title: listing.title })
    : tFormat(t("listing.shareTextIn"), { city: listing.location_city });

  return (
    <main className="bg-[var(--background)]">
      {unavailable && (
        <div className="mx-auto max-w-7xl w-full px-4 pt-4">
          {listing.status === "reserved" ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                {t("listing.status.reserved")}
              </span>
              <span className="text-[var(--muted-foreground)]">
                {t("listing.status.reservedText")}
              </span>
            </div>
          ) : (
            <div className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-4 py-3 text-sm">
              <span className="font-semibold text-[var(--destructive)]">
                {listing.status === "rented"
                  ? t("listing.status.rented")
                  : listing.status === "sold"
                    ? t("listing.status.sold")
                    : t("listing.status.unknown")}
              </span>
              <span className="text-[var(--muted-foreground)]">
                {t("listing.status.unavailableText")}
              </span>
            </div>
          )}
        </div>
      )}

      <header className="mx-auto max-w-7xl w-full px-4 pt-4 pb-2 flex items-center justify-between">
        <Link
          href={back.href}
          className="text-sm text-[var(--muted-foreground)] hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="size-4" /> {back.label}
        </Link>
        <div className="flex items-center gap-3">
          <ListingHeaderActions
            listingId={id}
            initialSaved={initialSaved}
            isAuthenticated={!!user}
            shareTitle={shareTitle}
            shareText={shareText}
          />
          <AuthMenu />
        </div>
      </header>

      <div className="mx-auto max-w-7xl w-full px-4 pb-10 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        <div className="space-y-6 min-w-0">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              {listing.title ?? fallbackTitleStr}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)] flex items-center gap-1 mt-1">
              <MapPin className="size-3" />
              {listing.location_address ??
                [listing.location_district, listing.location_city]
                  .filter(Boolean)
                  .join(", ")}
            </p>
          </div>

          <HeroGallery images={heroImages} />

          <RoomGalleryGrid photos={listing.photos} />

          <QuickFactsBar listing={listing} />

          <QuickActionsRow
            listing={listing}
            labels={{
              heading: t("listing.actions.heading"),
              floorplan: t("listing.actions.floorplan"),
              floorplanSub: t("listing.actions.floorplanSub"),
              tour: t("listing.actions.tour"),
              tourSub: t("listing.actions.tourSub"),
              video: t("listing.actions.video"),
              videoSub: t("listing.actions.videoSub"),
              neighborhood: t("listing.actions.neighborhood"),
              neighborhoodSub: t("listing.actions.neighborhoodSub"),
              costs: t("listing.actions.costs"),
              costsSub: t("listing.actions.costsSub"),
              furnishing: t("listing.actions.furnishing"),
              furnishingSub: t("listing.actions.furnishingSub"),
            }}
          />

          {listing.description && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">{t("listing.description")}</h2>
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-[var(--foreground)]/90">
                {listing.description}
              </p>
            </section>
          )}

          {/* ClusterOffersBlock deaktiviert — pHash-Cluster waren unzuverlässig. */}

          {listing.features.length > 0 && (
            <section id="features" className="space-y-2">
              <h2 className="text-base font-semibold">{t("listing.features")}</h2>
              <div className="flex flex-wrap gap-2">
                {listing.features.map((f) => (
                  <span
                    key={f}
                    className="rounded-full border bg-[var(--card)] px-3 py-1 text-xs"
                  >
                    {featureLabel(f, t)}
                  </span>
                ))}
              </div>
            </section>
          )}

          <div className="lg:hidden space-y-4">
            <PriceBox
              priceLabel={priceLabel}
              formattedPrice={formattedPrice}
              priceTitle={priceTitle}
              listingId={listing.id}
              listingStatus={listing.status}
              marketData={marketData}
              hasInternalContact={hasInternalContact}
              showRevealPhone={showRevealPhone}
              isAuthenticated={!!user}
              sourceUrl={listing.source_url}
              source={listing.source}
            />
            <ScamCheckBlock
              scamScore={listing.scam_score}
              scamFlags={listing.scam_flags}
              scamCheckedAt={listing.scam_checked_at}
            />
            <HonestAssessmentBlock assessment={listing.honest_assessment} />
            <LocationBlock
              city={listing.location_city}
              district={listing.location_district}
              address={listing.location_address}
              lat={listing.lat}
              lng={listing.lng}
              pois={listing.nearby_pois}
            />
          </div>

          <FooterMeta
            externalId={listing.external_id}
            createdAt={listing.created_at}
            source={listing.source}
            sourceUrl={listing.source_url}
            t={t}
            lang={lang}
          />
        </div>

        <aside className="hidden lg:block space-y-4">
          <div className="sticky top-4 space-y-4">
            <PriceBox
              priceLabel={priceLabel}
              formattedPrice={formattedPrice}
              priceTitle={priceTitle}
              listingId={listing.id}
              listingStatus={listing.status}
              marketData={marketData}
              hasInternalContact={hasInternalContact}
              showRevealPhone={showRevealPhone}
              isAuthenticated={!!user}
              sourceUrl={listing.source_url}
              source={listing.source}
            />
            <ScamCheckBlock
              scamScore={listing.scam_score}
              scamFlags={listing.scam_flags}
              scamCheckedAt={listing.scam_checked_at}
            />
            <HonestAssessmentBlock assessment={listing.honest_assessment} />
            <LocationBlock
              city={listing.location_city}
              district={listing.location_district}
              address={listing.location_address}
              lat={listing.lat}
              lng={listing.lng}
              pois={listing.nearby_pois}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}

function PriceBox({
  formattedPrice,
  priceLabel,
  priceTitle,
  listingId,
  listingStatus,
  marketData,
  hasInternalContact,
  showRevealPhone,
  isAuthenticated,
  sourceUrl,
  source,
}: {
  formattedPrice: string;
  priceLabel: string;
  priceTitle: string;
  listingId: string;
  listingStatus: string;
  marketData: MarketData | null;
  hasInternalContact: boolean;
  showRevealPhone: boolean;
  isAuthenticated: boolean;
  sourceUrl: string | null;
  source: string;
}) {
  return (
    <section className="rounded-2xl border bg-[var(--card)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-semibold">{formattedPrice}</span>
            {priceLabel && (
              <span className="text-sm text-[var(--muted-foreground)]">{priceLabel}</span>
            )}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {priceTitle}
          </div>
        </div>
        {marketData && marketData.position !== "unknown" && (
          <MarketPriceBadge data={marketData} />
        )}
      </div>
      {showRevealPhone ? (
        <RevealPhoneButton
          listingId={listingId}
          isAuthenticated={isAuthenticated}
          source={source}
          sourceUrl={sourceUrl}
          full
        />
      ) : hasInternalContact ? (
        <RequestVisitButton listingId={listingId} full listingStatus={listingStatus} />
      ) : sourceUrl ? (
        <SourceLinkButton sourceUrl={sourceUrl} source={source} full />
      ) : (
        <NoContactFallback full />
      )}
    </section>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  bazaraki: "Bazaraki",
  index_cy: "INDEX.cy",
  cyprus_real_estate: "Cyprus-Real.Estate",
  fb: "Facebook",
  direct: "Home4U",
  other: "—",
};

function FooterMeta({
  externalId,
  createdAt,
  source,
  sourceUrl,
  t,
  lang,
}: {
  externalId: string | null;
  createdAt: string;
  source: string;
  sourceUrl: string | null;
  t: T;
  lang: SupportedLang;
}) {
  const sourceLabel = SOURCE_LABELS[source] ?? source;
  return (
    <div className="text-xs text-[var(--muted-foreground)] flex flex-wrap items-center justify-between gap-2 border-t pt-4">
      <span>
        {t("listing.onlineSince")}{" "}
        {new Date(createdAt).toLocaleDateString(NUMBER_LOCALE[lang])}
      </span>
      <div className="flex items-center gap-3">
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {tFormat(t("listing.originalAt"), { source: sourceLabel })}
          </a>
        ) : source !== "direct" ? (
          <span>
            {t("listing.source")}: {sourceLabel}
          </span>
        ) : null}
        {externalId && (
          <span className="font-mono">
            {t("listing.objectId")} {externalId.slice(0, 30)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatPrice(amount: number, currency: string, lang: SupportedLang) {
  return new Intl.NumberFormat(NUMBER_LOCALE[lang], {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function fallbackTitle(
  rooms: number | null,
  propertyType: string | null,
  district: string | null,
  city: string,
  t: T,
): string {
  const roomsLabel =
    rooms === 0
      ? t("listing.fallbackTitle.studio")
      : rooms
        ? `${rooms}${t("listing.fallbackTitle.roomsSuffix")} `
        : "";
  const typeLabel = propertyType
    ? t((`property.${propertyType}`) as TKey) || t("property.fallback")
    : t("property.fallback");
  const place = district ? `${district}, ${city}` : city;
  return `${roomsLabel}${typeLabel} ${t("listing.fallbackTitle.in")} ${place}`.trim();
}

function featureLabel(value: string, t: T): string {
  const key = (`feature.${value}`) as TKey;
  return t(key) || value;
}
