import Link from "next/link";
import { ChevronRight, Heart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getUserBookmarks } from "@/lib/repo/bookmarks";
import { InquireButton } from "./InquireButton";

const PREVIEW_LIMIT = 3;

/**
 * Pipeline-Stufe 2 auf der Dashboard-Übersicht.
 * Zeigt nur Bookmarks ohne Match-Status (matchStatus="none") — bereits
 * angefragte sind eine Stufe weiter und stehen unten in "Meine Anfragen".
 */
export async function FavoritesSection({ userId }: { userId: string }) {
  const all = await getUserBookmarks(userId, { limit: 50 });
  const open = all.filter((b) => b.matchStatus === "none");
  const preview = open.slice(0, PREVIEW_LIMIT);

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Heart className="size-4 fill-rose-500 stroke-rose-500" />
          Meine Favoriten ({open.length})
        </h2>
        {all.length > 0 && (
          <Link
            href="/dashboard/bookmarks"
            className="text-xs text-[var(--muted-foreground)] hover:underline inline-flex items-center gap-0.5"
          >
            Alle ansehen <ChevronRight className="size-3" />
          </Link>
        )}
      </div>

      {preview.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-[var(--muted-foreground)]">
            Noch keine Favoriten — wisch im Suchergebnis nach rechts oder klick
            das Herz auf einer Listing-Seite.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {preview.map((b) => {
            const cover = b.listing.media?.[0];
            return (
              <div
                key={b.bookmarkId}
                className="flex items-stretch gap-3 rounded-lg border bg-[var(--card)] p-2"
              >
                <Link
                  href={`/listings/${b.listing.id}?from=bookmarks`}
                  className="relative shrink-0 size-20 overflow-hidden rounded-md bg-[var(--muted)] border"
                >
                  {cover ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={cover}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-[10px] text-[var(--muted-foreground)]">
                      kein Bild
                    </div>
                  )}
                </Link>
                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                  <Link
                    href={`/listings/${b.listing.id}?from=bookmarks`}
                    className="hover:underline"
                  >
                    <p className="truncate text-sm font-medium">
                      {b.listing.location_city}
                      {b.listing.location_district
                        ? ` · ${b.listing.location_district}`
                        : ""}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {b.listing.rooms ?? "?"} Zi ·{" "}
                      {Number(b.listing.price).toLocaleString("de-DE")} €
                      {b.listing.size_sqm ? ` · ${b.listing.size_sqm} m²` : ""}
                    </p>
                  </Link>
                </div>
                <div className="shrink-0 self-center w-32">
                  <InquireButton
                    bookmarkId={b.bookmarkId}
                    matchStatus={b.matchStatus}
                    matchId={b.matchId}
                    hasSearchProfile={b.searchProfileId !== null}
                  />
                </div>
              </div>
            );
          })}
          {open.length > preview.length && (
            <Link
              href="/dashboard/bookmarks"
              className="block text-center text-sm text-[var(--muted-foreground)] hover:underline py-2"
            >
              Alle {open.length} Favoriten ansehen →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
