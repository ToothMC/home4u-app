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
  const [brokenIdx, setBrokenIdx] = React.useState<Set<number>>(() => new Set());
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const heroRef = React.useRef<HTMLImageElement | null>(null);

  // Reset image index + broken-set when card changes
  React.useEffect(() => {
    setImgIdx(0);
    setBrokenIdx(new Set());
  }, [data.id]);

  // Active thumbnail in den View scrollen
  React.useEffect(() => {
    if (!stripRef.current) return;
    const target = stripRef.current.querySelector<HTMLElement>(
      `[data-thumb-idx="${imgIdx}"]`
    );
    target?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [imgIdx]);

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
        {hasImages && !brokenIdx.has(imgIdx) ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            ref={heroRef}
            src={images[imgIdx]}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
            onError={() =>
              setBrokenIdx((prev) => {
                const next = new Set(prev);
                next.add(imgIdx);
                return next;
              })
            }
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
            {hasImages ? "Bild nicht ladbar" : "Kein Bild"}
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

        {/* Counter badge top-left */}
        {total > 1 && (
          <div className="absolute top-3 left-3 rounded-full bg-black/60 backdrop-blur px-2 py-0.5 text-[10px] font-medium text-white">
            {imgIdx + 1} / {total}
          </div>
        )}

        {/* Score badge — nur ab 60 % zeigen, sonst zu schwach */}
        {data.score >= 0.6 && (
          <div className="absolute top-3 right-3 rounded-full bg-white/90 backdrop-blur px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            {Math.round(data.score * 100)} % Match
          </div>
        )}

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

      {/* Thumbnail strip — Bilder-Variety auf einen Blick */}
      {total > 1 && (
        <div
          ref={stripRef}
          className="px-3 pt-3 pb-1 flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {images.map((src, i) => (
            <button
              key={`${data.id}-thumb-${i}`}
              data-thumb-idx={i}
              onClick={() => setImgIdx(i)}
              className={cn(
                "relative shrink-0 size-16 rounded-md overflow-hidden border-2 snap-start transition-all",
                i === imgIdx
                  ? "border-rose-500 ring-2 ring-rose-200"
                  : "border-transparent opacity-70 hover:opacity-100"
              )}
              aria-label={`Bild ${i + 1} anzeigen`}
            >
              {!brokenIdx.has(i) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                  onError={() =>
                    setBrokenIdx((prev) => {
                      const next = new Set(prev);
                      next.add(i);
                      return next;
                    })
                  }
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-[8px] text-[var(--muted-foreground)] bg-[var(--muted)]">
                  ✗
                </div>
              )}
            </button>
          ))}
        </div>
      )}

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
