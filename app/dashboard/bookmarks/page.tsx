import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Heart, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthMenu } from "@/components/auth/AuthMenu";
import { BrandLockup } from "@/components/brand/Logo";
import { getAuthUser } from "@/lib/supabase/auth";
import { getUserBookmarks } from "@/lib/repo/bookmarks";

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

export default async function BookmarksPage() {
  const user = await getAuthUser();
  if (!user) {
    redirect("/?auth=required");
  }

  const bookmarks = await getUserBookmarks(user.id);

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

        <div className="flex items-center gap-3 mb-6">
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

        {bookmarks.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-[var(--card)] p-10 sm:p-14 text-center">
            <Heart className="mx-auto size-10 text-[var(--muted-foreground)] mb-4" />
            <p className="text-base font-medium text-[var(--foreground)] mb-1">
              Noch keine Favoriten
            </p>
            <p className="text-sm text-[var(--muted-foreground)] mb-6 max-w-md mx-auto">
              Speichere Inserate, die dich interessieren, mit dem Herz-Icon
              auf der Listing-Seite — sie landen hier zum Wiederfinden.
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

function BookmarkCard({
  bookmark,
}: {
  bookmark: Awaited<ReturnType<typeof getUserBookmarks>>[number];
}) {
  const { listing, bookmarkedAt } = bookmark;
  const cover = listing.media?.[0];
  const isVideo = cover ? /\.(mp4|mov|webm)$/i.test(cover) : false;
  const typeLabel = listing.property_type
    ? TYPE_LABEL[listing.property_type] ?? "Immobilie"
    : "Immobilie";
  const priceSuffix = listing.type === "rent" ? " / Mo" : "";
  const inactive = listing.status !== "active";

  return (
    <Link
      href={`/listings/${listing.id}?from=bookmarks`}
      className="group block rounded-2xl border bg-[var(--card)] overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="relative aspect-[4/3] bg-[var(--muted)]">
        {cover ? (
          isVideo ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
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
  );
}
