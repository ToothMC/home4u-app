"use client";

import * as React from "react";
import Link from "next/link";
import {
  Heart,
  X as XIcon,
  MapPin,
  ExternalLink,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
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

export type SwipeDirection = "like" | "skip";

export function MatchCard({
  data,
  onSwipe,
  isTop,
}: {
  data: MatchCardData;
  /** Wird gerufen, wenn User horizontal über Threshold zieht. */
  onSwipe?: (dir: SwipeDirection) => void;
  /** Nur die oberste Karte ist swipe-bar. */
  isTop?: boolean;
}) {
  const images = data.media && data.media.length > 0 ? data.media : [];
  const total = images.length;
  const [imgIdx, setImgIdx] = React.useState(0);
  const [brokenIdx, setBrokenIdx] = React.useState<Set<number>>(() => new Set());
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

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

  const next = React.useCallback(() => {
    if (total > 1) setImgIdx((i) => (i + 1) % total);
  }, [total]);
  const prev = React.useCallback(() => {
    if (total > 1) setImgIdx((i) => (i - 1 + total) % total);
  }, [total]);

  // ---------- Swipe-Gesture ----------
  const [drag, setDrag] = React.useState({ x: 0, y: 0, active: false, axis: "" as "" | "x" | "y" });
  const startRef = React.useRef<{ x: number; y: number } | null>(null);
  const flyOutRef = React.useRef<"left" | "right" | null>(null);

  React.useEffect(() => {
    if (!isTop || !cardRef.current) return;
    const el = cardRef.current;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY };
      setDrag({ x: 0, y: 0, active: true, axis: "" });
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      // Achse einrasten ab 10px Bewegung
      let axis: "" | "x" | "y" = drag.axis;
      if (!axis && (absX > 10 || absY > 10)) {
        axis = absX > absY ? "x" : "y";
      }

      if (axis === "x" || axis === "y") {
        // Während Card-Drag: Page-Scroll verhindern
        e.preventDefault();
      }

      setDrag({
        x: axis === "x" ? dx : 0,
        y: axis === "y" ? dy : 0,
        active: true,
        axis,
      });
    };

    const onTouchEnd = () => {
      const { x, y, axis } = drag;
      const swipeWidth = window.innerWidth * 0.28;
      if (axis === "x" && Math.abs(x) > swipeWidth) {
        // Animate fly-out, dann Action
        flyOutRef.current = x > 0 ? "right" : "left";
        setDrag({
          x: x > 0 ? window.innerWidth : -window.innerWidth,
          y: 0,
          active: false,
          axis: "",
        });
        setTimeout(() => {
          onSwipe?.(x > 0 ? "like" : "skip");
        }, 180);
      } else if (axis === "y" && Math.abs(y) > 60) {
        // Vertikal: Bild wechseln
        if (y < 0) next();
        else prev();
        setDrag({ x: 0, y: 0, active: false, axis: "" });
      } else {
        setDrag({ x: 0, y: 0, active: false, axis: "" });
      }
      startRef.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // touchmove muss non-passive sein, damit preventDefault wirkt
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isTop, drag, next, prev, onSwipe]);

  const formatPrice = (n: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: data.currency || "EUR",
      maximumFractionDigits: 0,
    }).format(n);

  const roomsLabel =
    data.rooms === 0 ? "Studio" : data.rooms === 1 ? "1 Zi" : `${data.rooms ?? "?"} Zi`;

  // Drag-Visualisierung
  const isFlying = flyOutRef.current !== null && !drag.active;
  const rotation = drag.axis === "x" ? Math.max(-12, Math.min(12, drag.x * 0.04)) : 0;
  const opacityHorizontal = drag.axis === "x" ? Math.min(1, Math.abs(drag.x) / 200) : 0;
  const showLikeOverlay = drag.axis === "x" && drag.x > 30;
  const showSkipOverlay = drag.axis === "x" && drag.x < -30;
  const verticalHint = drag.axis === "y" ? Math.min(1, Math.abs(drag.y) / 80) : 0;

  return (
    <article
      ref={cardRef}
      className={cn(
        "rounded-2xl overflow-hidden bg-[var(--card)] border shadow-sm relative select-none",
        isTop ? "touch-none" : "",
        isFlying ? "transition-transform duration-200" : drag.active ? "" : "transition-transform duration-200"
      )}
      style={{
        transform: `translate(${drag.x}px, ${drag.y * 0.3}px) rotate(${rotation}deg)`,
      }}
    >
      {/* Image area */}
      <div className="relative aspect-[4/5] bg-[var(--muted)]">
        {total > 0 && !brokenIdx.has(imgIdx) ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
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
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
            {total > 0 ? "Bild nicht ladbar" : "Kein Bild"}
          </div>
        )}

        {/* Counter top-left */}
        {total > 1 && (
          <div className="absolute top-3 left-3 rounded-full bg-black/60 backdrop-blur px-2 py-0.5 text-[10px] font-medium text-white">
            {imgIdx + 1} / {total}
          </div>
        )}

        {/* Score badge — nur ab 60 % */}
        {data.score >= 0.6 && (
          <div className="absolute top-3 right-12 rounded-full bg-white/90 backdrop-blur px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            {Math.round(data.score * 100)} % Match
          </div>
        )}

        {/* Inserat-anzeigen-Button (oben rechts) */}
        <Link
          href={`/listings/${data.id}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Inserat in voller Ansicht öffnen"
          className="absolute top-3 right-3 size-8 rounded-full bg-white/90 hover:bg-white backdrop-blur flex items-center justify-center text-[var(--foreground)] shadow"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-4" />
        </Link>

        {/* Up/Down Hint bei vertical-Drag */}
        {verticalHint > 0 && total > 1 && (
          <div
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none"
            style={{ opacity: verticalHint }}
          >
            <span className="size-12 rounded-full bg-black/60 backdrop-blur flex items-center justify-center text-white">
              {drag.y < 0 ? <ChevronUp className="size-6" /> : <ChevronDown className="size-6" />}
            </span>
          </div>
        )}

        {/* Like-Overlay */}
        {showLikeOverlay && (
          <div
            className="absolute inset-0 bg-rose-500/30 flex items-center justify-center pointer-events-none"
            style={{ opacity: opacityHorizontal }}
          >
            <div className="rounded-2xl border-4 border-white text-white px-6 py-3 -rotate-12 flex items-center gap-2 text-2xl font-bold tracking-wide">
              <Heart className="size-7 fill-white" /> INTERESSE
            </div>
          </div>
        )}

        {/* Skip-Overlay */}
        {showSkipOverlay && (
          <div
            className="absolute inset-0 bg-gray-700/30 flex items-center justify-center pointer-events-none"
            style={{ opacity: opacityHorizontal }}
          >
            <div className="rounded-2xl border-4 border-white text-white px-6 py-3 rotate-12 flex items-center gap-2 text-2xl font-bold tracking-wide">
              <XIcon className="size-7" /> WEITER
            </div>
          </div>
        )}

        {/* Info gradient overlay */}
        <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-white pointer-events-none">
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

      {/* Thumbnail strip */}
      {total > 1 && (
        <div
          ref={stripRef}
          className="px-3 pt-3 pb-1 flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-hidden"
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
