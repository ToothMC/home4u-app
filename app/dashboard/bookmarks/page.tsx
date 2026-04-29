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

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  apartment: "Wohnung",
  house: "Haus",
  villa: "Villa",
  studio: "Studio",
  townhouse: "Townhouse",
  penthouse: "Penthouse",
};

function fmtPrice(price: number, currency: string) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("de-DE", {
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

  const params = await searchParams;
  const showAll = params.show === "all";

  const allBookmarks = await getUserBookmarks(user.id);
  // Pipeline-Stufe 2: nur Favoriten ohne Match-Status. Angefragte sind Stufe
  // 3 und stehen in "Meine Anfragen". Toggle "?show=all" zeigt die Historie.
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
          <ArrowLeft className="size-4" /> Dashboard
        </Link>

        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <Heart className="size-6 fill-rose-500 stroke-rose-500" />
          <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--brand-navy)]">
            Meine Favoriten
          </h1>
          {bookmarks.length > 0 && (
            <span className="text-sm text-[var(--muted-foreground)]">
              {bookmarks.length}
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--muted-foreground)] mb-6">
          Deine Vorauswahl — von hier aus kannst du anfragen.
          {!showAll && hiddenCount > 0 && (
            <>
              {" "}
              <Link
                href="/dashboard/bookmarks?show=all"
                className="underline hover:no-underline"
              >
                Auch {hiddenCount} bereits angefragte zeigen
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
                Nur offene Favoriten
              </Link>
            </>
          )}
        </p>

        {bookmarks.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-[var(--card)] p-10 sm:p-14 text-center">
            <Heart className="mx-auto size-10 text-[var(--muted-foreground)] mb-4" />
            <p className="text-base font-medium text-[var(--foreground)] mb-1">
              {showAll ? "Noch keine Favoriten" : "Keine offenen Favoriten"}
            </p>
            <p className="text-sm text-[var(--muted-foreground)] mb-6 max-w-md mx-auto">
              {showAll
                ? "Speichere Inserate, die dich interessieren, mit dem Herz-Icon auf der Listing-Seite oder per Rechts-Wisch im Suchergebnis."
                : "Alle gespeicherten Inserate sind bereits angefragt. Schau in „Meine Anfragen“ im Dashboard."}
            </p>
            <Button asChild>
              <Link href="/matches">
                <Search className="size-4" />
                Inserate durchsuchen
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bookmarks.map((b) => (
              <li key={b.bookmarkId}>
                <BookmarkCard bookmark={b} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function BookmarkCard({ bookmark }: { bookmark: BookmarkedListing }) {
  const { listing, bookmarkedAt, bookmarkId, matchStatus, matchId, searchProfileId } = bookmark;
  const cover = listing.media?.[0];
  const isVideo = cover ? /\.(mp4|mov|webm)$/i.test(cover) : false;
  const typeLabel = listing.property_type
    ? TYPE_LABEL[listing.property_type] ?? "Immobilie"
    : "Immobilie";
  const priceSuffix = listing.type === "rent" ? " / Mo" : "";
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
              kein Bild
            </div>
          )}
          {inactive && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-[var(--brand-navy)]">
                Nicht mehr verfügbar
              </span>
            </div>
          )}
        </div>
        <div className="p-3">
          <p className="text-sm font-medium text-[var(--brand-navy)] truncate">
            {listing.rooms ? `${listing.rooms} Zi ` : ""}
            {typeLabel}
          </p>
          <p className="text-xs text-[var(--muted-foreground)] truncate">
            {listing.location_city}
            {listing.location_district ? ` · ${listing.location_district}` : ""}
            {listing.size_sqm ? ` · ${listing.size_sqm} m²` : ""}
          </p>
          <div className="mt-2 flex items-baseline justify-between">
            <p className="text-base font-semibold text-[var(--brand-navy)]">
              {fmtPrice(listing.price, listing.currency)}
              <span className="text-xs font-normal text-[var(--muted-foreground)]">
                {priceSuffix}
              </span>
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              gespeichert {fmtDate(bookmarkedAt)}
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
            hasSearchProfile={searchProfileId !== null}
          />
        </div>
      )}
    </div>
  );
}
