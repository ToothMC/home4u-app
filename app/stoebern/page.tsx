import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MapPin, Bed, Bath, Maximize2 } from "lucide-react";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";
import { LanguageFlagPicker } from "@/components/lang/LanguageFlagPicker";
import { Button } from "@/components/ui/button";
import { ChatLink } from "@/components/landing/PathCards";
import { BrowseFavoriteButton } from "@/components/browse/BrowseFavoriteButton";
import { BrowseFilterBar } from "@/components/browse/BrowseFilterBar";
import { SophieDrawerTrigger } from "@/components/chat/SophieDrawer";
import {
  applyFiltersToQuery,
  countActiveFilters,
  parseFiltersFromSearchParams,
  serializeFilters,
  type BrowseFilters,
} from "@/lib/browse/filters";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

// Bis zu dieser geschätzten Trefferzahl wird exakt nachgezählt. Die
// Planer-Schätzung rechnet mit dem Typ-Anteil der GANZEN Tabelle (inkl.
// stillgelegter und ausgeblendeter Zeilen) und lag bei "Miete" 64 % zu hoch
// (16.376 statt 10.002, 2026-10-26). Exakt zählen kostet bei ~10k Treffern
// ~0,3 s, bei 175k aber 11 s — darum nur für kleine Mengen, mit Zeitlimit.
const EXACT_COUNT_MAX = 20_000;
const EXACT_COUNT_TIMEOUT_MS = 2_000;

const NUMBER_LOCALE: Record<SupportedLang, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

type MarketPosition =
  | "very_good"
  | "good"
  | "fair"
  | "above"
  | "expensive"
  | "unknown";

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
  market_position: MarketPosition | null;
};

/** "N ähnliche Inserate · günstigste ab €X" — gleiche Regel wie bei den
 *  Sophie-Treffern (RPC browse_cluster_stats). Nichts wird ausgeblendet. */
type ClusterInfo = { offers: number; minPrice: number | null };

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
  const filters = parseFiltersFromSearchParams(sp);
  const filterQs = serializeFilters(filters).toString();

  const { t, lang } = await getT();

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

      <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-6 sm:pt-8">
        <h1 className="font-display text-3xl sm:text-4xl text-[var(--brand-navy)]">
          {t("browse.heading")}
        </h1>
      </section>

      {/* Ergebnisse streamen hinter einer EIGENEN Suspense-Boundary. Ohne die
          bleibt bei router.push aus der Filter-Leiste die komplette alte
          Seite stehen, bis der Server fertig gerendert hat — der Klick fühlt
          sich dann wie ein Hänger an. Der `key` erzwingt pro Filter-Stand
          einen Remount, sonst hält React die alte Liste fest und zeigt den
          Fallback nicht. */}
      <Suspense key={`${filterQs}|${pageNum}`} fallback={<ResultsSkeleton />}>
        <BrowseResults
          filters={filters}
          pageNum={pageNum}
          filterQs={filterQs}
          t={t}
          lang={lang}
        />
      </Suspense>
    </main>
  );
}

async function BrowseResults({
  filters,
  pageNum,
  filterQs,
  t,
  lang,
}: {
  filters: BrowseFilters;
  pageNum: number;
  filterQs: string;
  t: T;
  lang: SupportedLang;
}) {
  const from = (pageNum - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const hasFilters = countActiveFilters(filters) > 0;
  const supabase = createSupabaseServiceClient();

  // Auth-Lookup und Listings-Query laufen parallel — vorher seriell, das
  // legte den Auth-Roundtrip voll auf die Query-Zeit obendrauf.
  const [user, listings] = await Promise.all([
    getAuthUser(),
    loadListings(),
  ]);

  async function loadListings(): Promise<ListingsResult> {
    if (!supabase) return { ok: false };
    // Ein Timeout ist bei kaltem Cache oft beim zweiten Versuch weg (die
    // Seiten liegen dann im RAM). Darum einmal still wiederholen, bevor wir
    // dem User einen Fehler zeigen.
    const first = await queryListings();
    if (first.ok) return first;
    const second = await queryListings();
    if (!second.ok) {
      console.error("stoebern: Listings-Abfrage zweimal fehlgeschlagen:", second.error);
    }
    return second;
  }

  async function queryListings(): Promise<ListingsResult & { error?: string }> {
    if (!supabase) return { ok: false };
    // Sortiert nach created_at (echtes Insert-Datum) — NICHT updated_at, sonst
    // recyceln Crawler-Touches alte Listings nach oben.
    // Indizes: listings_browse_type_created_ok_idx, bei Regionsfilter
    // listings_browse_region_type_created_idx.
    //
    // Liste und Zählung sind ZWEI Anfragen (parallel). Hängt count an der
    // Liste, prüft PostgREST den Offset gegen die Zählung und antwortet mit
    // 416, sobald der Offset darüber liegt. Bei count: "planned" ist das
    // eine Schätzung: Miete/Paphos/Pegeia schätzte 54 statt 100 Treffer,
    // Seite 4 (Offset 72) brach dann immer ab (2026-10-26).
    //
    // count: "planned" = reine Planner-Schätzung, KEIN Durchzählen.
    // "estimated" zählt in PostgREST erst bis db-max-rows exakt (ein zweiter
    // Scan über bis zu 1000 passende Zeilen pro Klick) und hat die Abfrage
    // damit regelmäßig über das 8-s-Timeout geschoben.
    // Ob es eine nächste Seite gibt, entscheidet eine Zeile mehr (PAGE_SIZE+1).
    const listQuery = visibleListings(
      "id, type, rooms, size_sqm, bathrooms, price, currency, location_city, location_district, property_type, media, market_position",
    );
    const countQuery = visibleListings("id", { count: "planned", head: true });
    if (!listQuery || !countQuery) return { ok: false };

    const [{ data, error }, { count }] = await Promise.all([
      listQuery.order("created_at", { ascending: false }).range(from, to + 1),
      countQuery,
    ]);

    // Fehler NICHT als leere Liste ausgeben — genau das war "0 Treffer"
    // bei Timeouts. Fehlt nur die Schätzung, zählt unten `seen`.
    if (error) return { ok: false, error: error.message };

    const all = (data ?? []) as unknown as Row[];
    const hasNext = all.length > PAGE_SIZE;
    const pageRows = all.slice(0, PAGE_SIZE);
    // Letzte Seite → exakte Zahl ist bekannt. Sonst Planner-Schätzung,
    // mindestens aber so viele, wie wir sicher gesehen haben.
    const seen = from + all.length;
    let total = hasNext ? Math.max(count ?? 0, seen) : seen;
    let totalIsExact = !hasNext;
    if (hasNext && count != null && count <= EXACT_COUNT_MAX) {
      const exact = await exactCount();
      if (exact != null) {
        total = Math.max(exact, seen);
        totalIsExact = true;
      }
    }

    return {
      ok: true,
      rows: pageRows.filter(
        (r) => Array.isArray(r.media) && r.media.length > 0,
      ),
      total,
      totalIsExact,
      hasNext,
    };
  }

  // Basis-Abfrage für /stoebern: sichtbar = aktiv, mit Bild, Bild nicht als
  // gelöscht markiert, plus Nutzer-Filter. Eine Stelle für Liste und Zählung.
  function visibleListings(
    columns: string,
    opts?: { count: "planned" | "exact"; head?: boolean },
  ) {
    if (!supabase) return null;
    const q = supabase
      .from("listings")
      .select(columns, opts)
      .eq("status", "active")
      .not("media", "is", null)
      // media_ok=false = Cover beim Anbieter gelöscht (Bazaraki räumt den
      // GCS-Bucket auf, sobald das Inserat offline geht). Die Karte wäre
      // eine graue Fläche und fast immer auch eine Karteileiche.
      // NULL = noch nicht geprüft und bleibt sichtbar.
      .not("media_ok", "is", false);
    return applyFiltersToQuery(q, filters);
  }

  // Exakte Trefferzahl mit Zeitlimit; null = zu langsam oder Fehler, dann
  // bleibt die Schätzung stehen.
  async function exactCount(): Promise<number | null> {
    const q = visibleListings("id", { count: "exact", head: true });
    if (!q) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EXACT_COUNT_TIMEOUT_MS);
    try {
      const { count, error } = await q.abortSignal(ctrl.signal);
      return error || count == null ? null : count;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  if (!listings.ok) {
    return <LoadError t={t} href={currentHref(filterQs, pageNum)} />;
  }

  const { rows, total, totalIsExact, hasNext } = listings;

  // Favoriten-Status (eingeloggt) und Badge-Daten für alle Karten der Seite
  // parallel in je einer Abfrage — kein Flicker, keine Abfrage pro Karte.
  const ids = rows.map((r) => r.id);
  const [savedIds, clusterById] = await Promise.all([
    loadSavedIds(),
    loadClusterInfo(),
  ]);

  async function loadSavedIds(): Promise<Set<string>> {
    if (!supabase || !user || ids.length === 0) return new Set();
    const { data: bm } = await supabase
      .from("listing_bookmarks")
      .select("listing_id")
      .eq("user_id", user.id)
      .in("listing_id", ids);
    return new Set((bm ?? []).map((b) => b.listing_id as string));
  }

  // Fehler hier dürfen die Seite nicht kippen — dann eben ohne Badge.
  async function loadClusterInfo(): Promise<Map<string, ClusterInfo>> {
    const out = new Map<string, ClusterInfo>();
    if (!supabase || ids.length === 0) return out;
    const { data, error } = await supabase.rpc("browse_cluster_stats", { p_ids: ids });
    if (error) {
      console.error("stoebern: browse_cluster_stats fehlgeschlagen:", error.message);
      return out;
    }
    for (const r of (data ?? []) as {
      listing_id: string;
      cluster_offers_count: number;
      min_cluster_price: number | string | null;
    }[]) {
      out.set(r.listing_id, {
        offers: Number(r.cluster_offers_count) || 1,
        minPrice: r.min_cluster_price == null ? null : Number(r.min_cluster_price),
      });
    }
    return out;
  }

  const isAuthenticated = Boolean(user);
  const hasPrev = pageNum > 1;
  const pageHref = (n: number) => currentHref(filterQs, n);
  // URL für den Zurück-Button auf der Detail-Seite — encodiert auf den
  // exakten Stand inkl. Filter + aktueller Seite, damit der User nach
  // dem Zurück-Klick wieder genau dort landet, wo er die Karte gewählt hat.
  const backUrlForCards = pageHref(pageNum);

  return (
    <>
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pb-4">
        <p className="mt-2 text-sm text-[var(--warm-bark)]">
          {hasFilters
            ? tFormat(
                t(totalIsExact ? "browse.resultsCount" : "browse.resultsCountApprox"),
                { n: new Intl.NumberFormat(NUMBER_LOCALE[lang]).format(total) },
              )
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
                backUrl={backUrlForCards}
                cluster={clusterById.get(l.id)}
              />
            ))}
          </div>
        )}

        <SophieDrawerTrigger
          variant="fab"
          context={{
            page: "stoebern",
            filters,
            visible_listing_ids: rows.map((r) => r.id),
          }}
          seed={t(hasFilters ? "sidekick.seed.stoebern" : "sidekick.seed.stoebern.empty")}
        />

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
    </>
  );
}

type ListingsResult =
  | {
      ok: true;
      rows: Row[];
      total: number;
      totalIsExact: boolean;
      hasNext: boolean;
    }
  | { ok: false };

function currentHref(filterQs: string, n: number): string {
  const sp = new URLSearchParams(filterQs);
  if (n > 1) sp.set("p", String(n));
  const qs = sp.toString();
  return qs ? `/stoebern?${qs}` : "/stoebern";
}

// Fehlerzustand statt "0 Treffer". Plain <a> statt <Link>, damit "Erneut
// laden" garantiert frisch vom Server rendert und nicht aus dem Router-Cache.
function LoadError({ t, href }: { t: T; href: string }) {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-6 pb-12">
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-12 text-center">
        <p className="text-[var(--warm-bark)] mb-6">{t("browse.loadError")}</p>
        <Button asChild>
          <a href={href}>{t("browse.retry")}</a>
        </Button>
      </div>
    </section>
  );
}

// Platzhalter in der exakten Geometrie der Karten — die Filter-Leiste bleibt
// dadurch an ihrem Platz und die Seite springt nicht, wenn die Ergebnisse
// nachstreamen.
function ResultsSkeleton() {
  return (
    <>
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pb-4" aria-hidden>
        <div className="mt-2 h-5 w-48 rounded bg-[var(--muted)] animate-pulse" />
      </section>
      <section
        className="mx-auto max-w-7xl px-4 sm:px-6 pb-12"
        aria-busy="true"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 sm:gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col rounded-2xl overflow-hidden bg-white border border-[var(--border)]"
            >
              <div className="aspect-[4/3] bg-[var(--muted)] animate-pulse" />
              <div className="p-4 flex flex-col gap-2">
                <div className="h-6 w-28 rounded bg-[var(--muted)] animate-pulse" />
                <div className="h-4 w-40 rounded bg-[var(--muted)] animate-pulse" />
                <div className="h-3 w-32 rounded bg-[var(--muted)] animate-pulse" />
                <div className="mt-2 pt-2 border-t border-[var(--border)]">
                  <div className="h-3 w-24 rounded bg-[var(--muted)] animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function BrowseCard({
  listing,
  t,
  lang,
  initialSaved,
  isAuthenticated,
  backUrl,
  cluster,
}: {
  listing: Row;
  t: T;
  lang: SupportedLang;
  initialSaved: boolean;
  isAuthenticated: boolean;
  backUrl: string;
  cluster?: ClusterInfo;
}) {
  const cover = listing.media?.[0];
  const href = `/listings/${listing.id}?back=${encodeURIComponent(backUrl)}`;
  return (
    <Link
      href={href}
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
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-lg font-semibold text-[var(--brand-navy)]">
            {fmt(listing.price, listing.currency, lang)}
            {listing.type === "rent" && (
              <span className="text-xs font-normal text-[var(--warm-bark)]">
                {" "}
                {t("listing.price.perMonth")}
              </span>
            )}
          </div>
          <MarketPositionPill position={listing.market_position} t={t} />
        </div>
        <ClusterPill listing={listing} cluster={cluster} t={t} lang={lang} />
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

// Gleicher Hinweis wie auf den Sophie-Treffern (MatchCard), aber als <span>:
// die Karte ist selbst ein <Link>, ein zweiter Link darin wäre ungültig. Die
// Liste der ähnlichen Inserate steht auf der Detailseite (#cluster-offers).
function ClusterPill({
  listing,
  cluster,
  t,
  lang,
}: {
  listing: Row;
  cluster?: ClusterInfo;
  t: T;
  lang: SupportedLang;
}) {
  if (!cluster || cluster.offers < 2) return null;
  const others = cluster.offers - 1;
  const cheaper = cluster.minPrice != null && cluster.minPrice < listing.price;
  return (
    <span className="self-start inline-flex items-center rounded-full bg-amber-100 text-amber-900 border border-amber-200 text-[10px] font-medium px-2 py-0.5">
      {cheaper
        ? tFormat(t("matchCard.cheaperElsewhere"), {
            price: fmt(cluster.minPrice as number, listing.currency, lang),
            n: others,
          })
        : tFormat(t("matchCard.providers"), { n: others })}
    </span>
  );
}

// Kompakte, NICHT-interaktive Variante der MarketPriceBadge — die Browse-
// Karte ist selbst ein <Link>, daher kein Popover (würde nested-button-Markup
// erzeugen). Detail-Seite zeigt weiterhin die volle Badge mit Popover.
function MarketPositionPill({
  position,
  t,
}: {
  position: MarketPosition | null;
  t: T;
}) {
  if (!position || position === "unknown") return null;
  const cfg = MARKET_PILL_CONFIG[position];
  const label = t(cfg.key);
  const isGreen = cfg.tone === "green";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 border text-[10px] font-semibold whitespace-nowrap",
        isGreen
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700",
      ].join(" ")}
      aria-label={label}
    >
      <span className="inline-flex items-end gap-[1.5px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => {
          const active = i <= cfg.bars;
          return (
            <span
              key={i}
              className={[
                "w-[2px] rounded-sm",
                active
                  ? isGreen
                    ? "bg-emerald-600"
                    : "bg-amber-500"
                  : isGreen
                    ? "bg-emerald-200"
                    : "bg-amber-200",
              ].join(" ")}
              style={{ height: 4 + i * 1.5 }}
            />
          );
        })}
      </span>
      {label}
    </span>
  );
}

const MARKET_PILL_CONFIG: Record<
  Exclude<MarketPosition, "unknown">,
  { bars: number; key: TKey; tone: "green" | "orange" }
> = {
  very_good: { bars: 5, key: "matchCard.priceVeryGood", tone: "green" },
  good: { bars: 4, key: "matchCard.priceGood", tone: "green" },
  fair: { bars: 3, key: "matchCard.priceFair", tone: "green" },
  above: { bars: 2, key: "matchCard.priceElevated", tone: "orange" },
  expensive: { bars: 1, key: "matchCard.priceHigh", tone: "orange" },
};
