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
import { loadPublicListing } from "@/lib/repo/public-listing";

export const dynamic = "force-dynamic";

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

  // Bookmark-Status parallel zur Listing-Auflösung wäre netter, aber load
  // ist schon über. Schnell genug — ein simpler indexierter Lookup.
  // Favoriten sind auth-only: Anon-User sehen den Save-Button immer "leer"
  // und werden beim Klick in den Login-Dialog geschickt.
  const user = await getAuthUser();

  // opted_out / archived: hart 404 (Inserent will nicht mehr gezeigt werden) —
  // ABER: der Eigentümer selbst muss die Vorschau weiter sehen können, sonst
  // bricht der Vorschau-Link im Editor sobald jemand das Inserat deaktiviert.
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

  // Kontext-abhängiger Back-Link: aus Editor zurück zur Bearbeitung,
  // sonst Default „zur Suche". Andere Quellen können denselben Mechanismus
  // nutzen (?from=matches, ?from=dashboard etc.).
  const back =
    from === "edit"
      ? { href: `/dashboard/listings/${id}`, label: "Zurück zur Bearbeitung" }
      : { href: "/matches", label: "Zurück zur Suche" };

  const heroImages = listing.photos.map((p) => p.url);
  const formattedPrice = formatPrice(
    listing.price_warm ?? listing.price,
    listing.currency
  );
  const priceLabel = listing.type === "rent" ? "/ Monat" : "";
  const priceTitle = listing.price_warm ? "Warmmiete" : listing.type === "rent" ? "Miete" : "Kaufpreis";

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

  return (
    <main className="bg-[var(--background)]">
      {unavailable && (
        <div className="mx-auto max-w-7xl w-full px-4 pt-4">
          {listing.status === "reserved" ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                Reserviert
              </span>
              <span className="text-[var(--muted-foreground)]">
                {" "}
                — der Inserent hat eine mündliche Zusage und das Inserat
                vorübergehend reserviert. Falls die Zusage platzt, ist das
                Inserat in den nächsten Tagen wieder regulär in den Treffern.
              </span>
            </div>
          ) : (
            <div className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-4 py-3 text-sm">
              <span className="font-semibold text-[var(--destructive)]">
                {listing.status === "rented"
                  ? "Inserat ist als vermietet markiert"
                  : listing.status === "sold"
                    ? "Inserat ist als verkauft markiert"
                    : "Verfügbarkeit unklar"}
              </span>
              <span className="text-[var(--muted-foreground)]">
                {" "}
                — der Inserent hat dieses Inserat als nicht mehr verfügbar
                gemeldet. Falls die Vermietung platzt und das Original-Inserat
                noch online ist, reaktivieren wir es nach 7 Tagen automatisch.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Top bar */}
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
            shareTitle={listing.title ?? "Inserat auf Home4U"}
            shareText={
              listing.title
                ? `${listing.title} — auf Home4U`
                : `Inserat in ${listing.location_city} auf Home4U`
            }
          />
          <AuthMenu />
        </div>
      </header>

      <div className="mx-auto max-w-7xl w-full px-4 pb-10 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        {/* Main column */}
        <div className="space-y-6 min-w-0">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              {listing.title ??
                fallbackTitle(
                  listing.rooms,
                  listing.property_type,
                  listing.location_district,
                  listing.location_city
                )}
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

          <QuickActionsRow listing={listing} />

          {listing.description && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Beschreibung</h2>
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-[var(--foreground)]/90">
                {listing.description}
              </p>
            </section>
          )}

          {listing.features.length > 0 && (
            <section id="features" className="space-y-2">
              <h2 className="text-base font-semibold">Ausstattung</h2>
              <div className="flex flex-wrap gap-2">
                {listing.features.map((f) => (
                  <span
                    key={f}
                    className="rounded-full border bg-[var(--card)] px-3 py-1 text-xs"
                  >
                    {featureLabel(f)}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Mobile: Sidebar elements rein in den Flow */}
          <div className="lg:hidden space-y-4">
            <PriceBox
              priceLabel={priceLabel}
              formattedPrice={formattedPrice}
              priceTitle={priceTitle}
              listingId={listing.id}
              marketData={marketData}
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
          />
        </div>

        {/* Right Sidebar (desktop) */}
        <aside className="hidden lg:block space-y-4">
          <div className="sticky top-4 space-y-4">
            <PriceBox
              priceLabel={priceLabel}
              formattedPrice={formattedPrice}
              priceTitle={priceTitle}
              listingId={listing.id}
              marketData={marketData}
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
  marketData,
}: {
  formattedPrice: string;
  priceLabel: string;
  priceTitle: string;
  listingId: string;
  marketData: MarketData | null;
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
      <RequestVisitButton listingId={listingId} full />
    </section>
  );
}

function FooterMeta({
  externalId,
  createdAt,
}: {
  externalId: string | null;
  createdAt: string;
}) {
  return (
    <div className="text-xs text-[var(--muted-foreground)] flex items-center justify-between border-t pt-4">
      <span>
        Inserat online seit{" "}
        {new Date(createdAt).toLocaleDateString("de-DE")}
      </span>
      {externalId && (
        <span className="font-mono">Objekt-ID {externalId.slice(0, 30)}</span>
      )}
    </div>
  );
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function fallbackTitle(
  rooms: number | null,
  propertyType: string | null,
  district: string | null,
  city: string
): string {
  const roomsLabel = rooms === 0 ? "Studio" : rooms ? `${rooms}-Zimmer-` : "";
  const typeLabel = propertyType
    ? PROPERTY_LABEL[propertyType] ?? "Wohnung"
    : "Wohnung";
  const place = district ? `${district}, ${city}` : city;
  return `${roomsLabel}${typeLabel} in ${place}`.trim();
}

const PROPERTY_LABEL: Record<string, string> = {
  apartment: "Wohnung",
  house: "Haus",
  villa: "Villa",
  maisonette: "Maisonette",
  studio: "Studio",
  townhouse: "Stadthaus",
  penthouse: "Penthouse",
  bungalow: "Bungalow",
  land: "Grundstück",
  commercial: "Gewerbe",
};

function featureLabel(value: string): string {
  return (
    {
      parking: "Parkplatz",
      covered_parking: "Garage",
      pool: "Pool",
      garden: "Garten",
      balcony: "Balkon",
      terrace: "Terrasse",
      elevator: "Aufzug",
      air_conditioning: "Klimaanlage",
      solar: "Solar",
      sea_view: "Meerblick",
      mountain_view: "Bergblick",
      storage: "Abstellraum",
      fireplace: "Kamin",
      jacuzzi: "Jacuzzi",
      gym: "Fitnessraum",
      smart_home: "Smart Home",
      accessible: "Barrierefrei",
    }[value] ?? value
  );
}
