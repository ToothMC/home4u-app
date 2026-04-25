"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export type MatchCardData = {
  id: string;
  type: "rent" | "sale";
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number | null;
  size_sqm: number | null;
  media: string[] | null;
  score: number;
};

export function MatchCard({ data }: { data: MatchCardData }) {
  const images = data.media && data.media.length > 0 ? data.media : [];
  const [imgIdx, setImgIdx] = React.useState(0);
  const [touchStart, setTouchStart] = React.useState<number | null>(null);

  // Reset image index when card changes
  React.useEffect(() => {
    setImgIdx(0);
  }, [data.id]);

  const total = images.length;
  const hasImages = total > 0;

  const next = React.useCallback(() => {
    if (total > 1) setImgIdx((i) => (i + 1) % total);
  }, [total]);
  const prev = React.useCallback(() => {
    if (total > 1) setImgIdx((i) => (i - 1 + total) % total);
  }, [total]);

  const formatPrice = (n: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: data.currency || "EUR",
      maximumFractionDigits: 0,
    }).format(n);

  const roomsLabel =
    data.rooms === 0 ? "Studio" : data.rooms === 1 ? "1 Zi" : `${data.rooms ?? "?"} Zi`;

  return (
    <article className="rounded-2xl overflow-hidden bg-[var(--card)] border shadow-sm">
      {/* Image area */}
      <div className="relative aspect-[4/5] bg-[var(--muted)]">
        {hasImages ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={images[imgIdx]}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
            onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchStart === null) return;
              const dx = e.changedTouches[0].clientX - touchStart;
              if (Math.abs(dx) > 50) (dx < 0 ? next : prev)();
              setTouchStart(null);
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
            Kein Bild
          </div>
        )}

        {/* Tap-zones for prev/next on mobile */}
        {total > 1 && (
          <>
            <button
              aria-label="Vorheriges Bild"
              onClick={prev}
              className="absolute inset-y-0 left-0 w-1/3 hidden md:flex items-center justify-start pl-2 hover:bg-black/5 transition-colors"
            >
              <span className="rounded-full bg-black/40 p-1 text-white">
                <ChevronLeft className="size-5" />
              </span>
            </button>
            <button
              aria-label="Nächstes Bild"
              onClick={next}
              className="absolute inset-y-0 right-0 w-1/3 hidden md:flex items-center justify-end pr-2 hover:bg-black/5 transition-colors"
            >
              <span className="rounded-full bg-black/40 p-1 text-white">
                <ChevronRight className="size-5" />
              </span>
            </button>
          </>
        )}

        {/* Image dots indicator */}
        {total > 1 && (
          <div className="absolute top-3 inset-x-0 flex items-center justify-center gap-1 px-4 pointer-events-none">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all",
                  i === imgIdx
                    ? "bg-white w-6"
                    : "bg-white/60 w-1.5"
                )}
              />
            ))}
          </div>
        )}

        {/* Score badge */}
        <div className="absolute top-3 right-3 rounded-full bg-white/90 backdrop-blur px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          {Math.round(data.score * 100)} % Match
        </div>

        {/* Info gradient overlay */}
        <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white">
          <div className="text-2xl font-semibold leading-none">
            {formatPrice(data.price)}
            {data.type === "rent" && (
              <span className="text-sm font-normal opacity-80"> / Monat</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1 text-sm opacity-95">
            <MapPin className="size-3" />
            {data.location_district
              ? `${data.location_district}, ${data.location_city}`
              : data.location_city}
          </div>
        </div>
      </div>

      {/* Facts row */}
      <div className="px-4 py-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <div className="font-semibold">{roomsLabel}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            Zimmer
          </div>
        </div>
        <div>
          <div className="font-semibold">
            {data.size_sqm ? `${data.size_sqm} m²` : "—"}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            Fläche
          </div>
        </div>
        <div>
          <div className="font-semibold">{total || "—"}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            Bilder
          </div>
        </div>
      </div>
    </article>
  );
}
