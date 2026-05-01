import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Heart, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";
import { getAuthUser } from "@/lib/supabase/auth";
import { getUserBookmarks, type BookmarkedListing } from "@/lib/repo/bookmarks";
import { InquireButton } from "@/components/dashboard/InquireButton";
import { DeleteBookmarkOverlay } from "@/components/dashboard/DeleteBookmarkOverlay";
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

const PROPERTY_TYPE_KEY: Record<string, TKey> = {
  apartment: "property.apartment",
  house: "property.house",
  villa: "property.villa",
  studio: "property.studio",
  townhouse: "property.townhouse",
  penthouse: "property.penthouse",
};

function fmtPrice(price: number, currency: string, lang: SupportedLang) {
  return new Intl.NumberFormat(NUMBER_LOCALE[lang], {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

function fmtDate(iso: string, lang: SupportedLang) {
  return new Intl.DateTimeFormat(NUMBER_LOCALE[lang], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export default async function BookmarksPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) {
    redirect("/?auth=required");
  }

  const { t, lang } = await getT();
  const params = await searchParams;
  const showAll = params.show === "all";

  const allBookmarks = await getUserBookmarks(user.id);
  const bookmarks = showAll
    ? allBookmarks
    : allBookmarks.filter((b) => b.matchStatus === "none");
  const hiddenCount = allBookmarks.length - bookmarks.length;

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-30 backdrop-blur bg-[var(--warm-cream)]/85 border-b border-[var(--border)]">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <BrandLockup />
          <AuthMenu />
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 pt-8 pb-12">
        <Link
          href="/dashboard"
          className="text-sm text-[var(--muted-foreground)] hover:underline inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="size-4" /> {t("common.dashboard")}
        </Link>

        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <Heart className="size-6 fill-rose-500 stroke-rose-500" />
          <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--brand-navy)]">
            {t("bookmarks.heading")}
          </h1>
          {bookmarks.length > 0 && (
            <span className="text-sm text-[var(--muted-foreground)]">
              {bookmarks.length}
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--muted-foreground)] mb-6">
          {t("bookmarks.subtitle")}
          {!showAll && hiddenCount > 0 && (
            <>
              {" "}
              <Link
                href="/dashboard/bookmarks?show=all"
                className="underline hover:no-underline"
              >
                {tFormat(t("bookmarks.showAlsoRequested"), { n: hiddenCount })}
              </Link>
            </>
          )}
          {showAll && (
            <>
              {" "}
              <Link
                href="/dashboard/bookmarks"
                className="underline hover:no-underline"
              >
                {t("bookmarks.onlyOpen")}
              </Link>
            </>
          )}
        </p>

        {bookmarks.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-[var(--card)] p-10 sm:p-14 text-center">
            <Heart className="mx-auto size-10 text-[var(--muted-foreground)] mb-4" />
            <p className="text-base font-medium text-[var(--foreground)] mb-1">
              {showAll ? t("bookmarks.emptyAll") : t("bookmarks.emptyOpen")}
            </p>
            <p className="text-sm text-[var(--muted-foreground)] mb-6 max-w-md mx-auto">
              {showAll ? t("bookmarks.emptyAllSub") : t("bookmarks.emptyOpenSub")}
            </p>
            <Button asChild>
              <Link href="/matches">
                <Search className="size-4" />
                {t("bookmarks.searchListings")}
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bookmarks.map((b) => (
              <li key={b.bookmarkId}>
                <BookmarkCard bookmark={b} t={t} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function BookmarkCard({
  bookmark,
  t,
  lang,
}: {
  bookmark: BookmarkedListing;
  t: T;
  lang: SupportedLang;
}) {
  const { listing, bookmarkedAt, bookmarkId, matchStatus, matchId } = bookmark;
  const cover = listing.media?.[0];
  const isVideo = cover ? /\.(mp4|mov|webm)$/i.test(cover) : false;
  const typeLabel = listing.property_type
    ? PROPERTY_TYPE_KEY[listing.property_type]
      ? t(PROPERTY_TYPE_KEY[listing.property_type])
      : t("property.fallback")
    : t("property.fallback");
  const priceSuffix = listing.type === "rent" ? ` ${t("listing.price.perMonth")}` : "";
  const inactive = listing.status !== "active";

  return (
    <div className="group relative block rounded-2xl border bg-[var(--card)] overflow-hidden hover:shadow-md transition-shadow">
      <DeleteBookmarkOverlay listingId={listing.id} />
      <Link href={`/listings/${listing.id}?from=bookmarks`} className="block">
        <div className="relative aspect-[4/3] bg-[var(--muted)]">
          {cover ? (
            isVideo ? (
              <video
                src={cover}
                className="h-full w-full object-cover"
                muted
                playsInline
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                className="h-full w-full object-cover group-hover:scale-[1.02] transition-transform"
              />
            )
          ) : (
            <div className="h-full w-full flex items-center justify-center text-xs text-[var(--muted-foreground)]">
              {t("match.noImage")}
            </div>
          )}
          {inactive && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[var(--brand-navy)]">
                {t("bookmarks.unavailable")}
              </span>
            </div>
          )}
        </div>
        <div className="p-3">
          <p className="text-sm font-medium text-[var(--brand-navy)] truncate">
            {listing.rooms ? `${listing.rooms} ${t("matchCard.roomsShort")} ` : ""}
            {typeLabel}
          </p>
          <p className="text-xs text-[var(--muted-foreground)] truncate">
            {listing.location_city}
            {listing.location_district ? ` · ${listing.location_district}` : ""}
            {listing.size_sqm ? ` · ${listing.size_sqm} m²` : ""}
          </p>
          <div className="mt-2 flex items-baseline justify-between">
            <p className="text-base font-semibold text-[var(--brand-navy)]">
              {fmtPrice(listing.price, listing.currency, lang)}
              <span className="text-xs font-normal text-[var(--muted-foreground)]">
                {priceSuffix}
              </span>
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              {tFormat(t("bookmarks.savedOn"), { date: fmtDate(bookmarkedAt, lang) })}
            </p>
          </div>
        </div>
      </Link>
      {!inactive && (
        <div className="px-3 pb-3">
          <InquireButton
            bookmarkId={bookmarkId}
            matchStatus={matchStatus}
            matchId={matchId}
            listingStatus={listing.status}
          />
        </div>
      )}
    </div>
  );
}
