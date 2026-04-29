"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ListingStatusBadge } from "./ListingStatusBadge";

export type ListingRowData = {
  id: string;
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number | null;
  size_sqm: number | null;
  media: string[] | null;
  status: string;
};

export function ListingRow({
  listing,
  newCount,
  handledCount,
}: {
  listing: ListingRowData;
  newCount: number;
  handledCount: number;
}) {
  const thumb = listing.media?.[0];
  const isVideo = thumb ? /\.(mp4|mov|webm)$/i.test(thumb) : false;

  return (
    <Link
      href={`/dashboard/listings/${listing.id}`}
      className="group flex items-center gap-3 rounded-lg border p-2 hover:bg-[var(--accent)] transition-colors"
    >
      <div className="shrink-0 size-14 overflow-hidden rounded-md bg-[var(--muted)] border">
        {thumb ? (
          isVideo ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={thumb}
              className="h-full w-full object-cover"
              muted
              playsInline
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          )
        ) : (
          <div className="h-full w-full flex items-center justify-center text-[10px] text-[var(--muted-foreground)]">
            kein Bild
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {listing.location_city}
          {listing.location_district ? ` · ${listing.location_district}` : ""}
        </p>
        <p className="truncate text-xs text-[var(--muted-foreground)]">
          {listing.rooms ?? "?"} Zi
          {listing.size_sqm ? ` · ${listing.size_sqm} m²` : ""} ·{" "}
          {Number(listing.price).toLocaleString("de-DE")}{" "}
          {listing.currency || "EUR"}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1 text-xs">
        <ListingStatusBadge status={listing.status} />
        {newCount > 0 ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
            {newCount} neu
          </span>
        ) : (
          <span className="text-[10px] text-[var(--muted-foreground)]">
            keine neuen
          </span>
        )}
        {handledCount > 0 && (
          <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
            {handledCount} bearbeitet
          </span>
        )}
      </div>

      <ChevronRight className="size-4 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}
