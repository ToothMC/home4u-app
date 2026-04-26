"use client";

import * as React from "react";
import Link from "next/link";
import {
  Heart,
  X as XIcon,
  MapPin,
  ExternalLink,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

// Slide-Höhe als Anteil der Image-Area-Höhe. Rest = (1 - SLIDE_RATIO) / 2 als
// Spacer oben und unten, damit beim aktiven Bild ein Stück voriges/nächstes
// Bild peekt → Card-Stack-Metapher, "wischbar" wird selbsterklärend.
const SLIDE_RATIO = 0.85;
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
  // Swipe-Handler hängt an der Image-Area allein, damit Touches auf den
  // (vertikal scrollbaren) Thumbnails nicht versehentlich Like/Skip triggern.
  const swipeAreaRef = React.useRef<HTMLDivElement | null>(null);

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

  // Image-Stack auf das aktive Bild scrollen, wenn imgIdx von außen geändert wird
  // (Thumbnail-Klick, prev/next-Button). Idempotent — wenn der Stack-Scroll
  // selbst imgIdx via onScroll gesetzt hat, ist scrollTop schon korrekt und
  // wir lösen kein zweites Scroll aus.
  React.useEffect(() => {
    const el = swipeAreaRef.current;
    if (!el || total === 0) return;
    const slideH =
      total > 1 ? el.clientHeight * SLIDE_RATIO : el.clientHeight;
    const target = imgIdx * slideH;
    if (Math.abs(el.scrollTop - target) > 2) {
      el.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [imgIdx, total]);

  // 3D-Stack-Effekt: Während des Scrollens skalieren wir jede Slide in
  // Abhängigkeit ihrer Distanz vom Viewport-Mittelpunkt. Aktive Slide = 1.0,
  // Peek-Slides am Rand = 0.86 + reduzierte Opazität → wirkt wie hinter der
  // aktiven Karte liegende Karten in einem physischen Stapel.
  React.useEffect(() => {
    const el = swipeAreaRef.current;
    if (!el || total <= 1) return;

    let frame = 0;
    const apply = () => {
      const center = el.scrollTop + el.clientHeight / 2;
      const half = el.clientHeight / 2;
      el.querySelectorAll<HTMLElement>("[data-slide-idx]").forEach((slide) => {
        const slideCenter = slide.offsetTop + slide.offsetHeight / 2;
        const distance = Math.abs(center - slideCenter);
        const t = Math.min(1, distance / half);
        const scale = 1 - t * 0.14; // 0.86 .. 1.0
        const opacity = 1 - t * 0.55; // 0.45 .. 1.0
        slide.style.transform = `scale(${scale})`;
        slide.style.opacity = String(opacity);
      });
    };
    const onScroll = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [total, data.id]);

  const next = React.useCallback(() => {
    if (total > 1) setImgIdx((i) => (i + 1) % total);
  }, [total]);
  const prev = React.useCallback(() => {
    if (total > 1) setImgIdx((i) => (i - 1 + total) % total);
  }, [total]);

  // ---------- Swipe-Gesture ----------
  // dragRef = live state für Handler (kein closure-stale)
  // dragVisual = state für Render
  const dragRef = React.useRef({ x: 0, y: 0, axis: "" as "" | "x" | "y" });
  const [dragVisual, setDragVisual] = React.useState({
    x: 0,
    y: 0,
    axis: "" as "" | "x" | "y",
  });
  const startRef = React.useRef<{ x: number; y: number } | null>(null);
  const animatingRef = React.useRef(false);

  // Refs für die aktuellen Callbacks/Funktionen → handler bleibt stabil
  const onSwipeRef = React.useRef(onSwipe);
  const nextRef = React.useRef(next);
  const prevRef = React.useRef(prev);
  React.useEffect(() => {
    onSwipeRef.current = onSwipe;
    nextRef.current = next;
    prevRef.current = prev;
  }, [onSwipe, next, prev]);

  React.useEffect(() => {
    if (!isTop || !swipeAreaRef.current) return;
    const el = swipeAreaRef.current;

    const onTouchStart = (e: TouchEvent) => {
      if (animatingRef.current) return;
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY };
      dragRef.current = { x: 0, y: 0, axis: "" };
      setDragVisual({ x: 0, y: 0, axis: "" });
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startRef.current || animatingRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      let axis = dragRef.current.axis;
      if (!axis && (absX > 10 || absY > 10)) {
        // Vertikal lassen wir den Browser native scrollen — JS-Handler steigt aus
        if (absY > absX) {
          axis = "y";
          dragRef.current = { x: 0, y: 0, axis };
          return; // kein preventDefault → Browser scrollt das Image-Stack
        }
        axis = "x";
      }

      if (axis === "x") {
        e.preventDefault();
        const nextDrag = { x: dx, y: 0, axis };
        dragRef.current = nextDrag;
        setDragVisual(nextDrag);
      }
      // axis === "y" → nichts tun, Browser scrollt
    };

    const onTouchEnd = () => {
      const { x, axis } = dragRef.current;
      const swipeWidth = window.innerWidth * 0.25;

      if (axis === "x" && Math.abs(x) > swipeWidth) {
        animatingRef.current = true;
        const flyTo = x > 0 ? window.innerWidth : -window.innerWidth;
        setDragVisual({ x: flyTo, y: 0, axis: "x" });
        setTimeout(() => {
          onSwipeRef.current?.(x > 0 ? "like" : "skip");
          animatingRef.current = false;
          dragRef.current = { x: 0, y: 0, axis: "" };
          setDragVisual({ x: 0, y: 0, axis: "" });
        }, 200);
      } else {
        // Snap back / vertical end → reset
        dragRef.current = { x: 0, y: 0, axis: "" };
        setDragVisual({ x: 0, y: 0, axis: "" });
      }
      startRef.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isTop]);

  const formatPrice = (n: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: data.currency || "EUR",
      maximumFractionDigits: 0,
    }).format(n);

  const roomsLabel =
    data.rooms === 0 ? "Studio" : data.rooms === 1 ? "1 Zi" : `${data.rooms ?? "?"} Zi`;

  // Drag-Visualisierung
  const rotation =
    dragVisual.axis === "x" ? Math.max(-12, Math.min(12, dragVisual.x * 0.04)) : 0;
  const opacityHorizontal =
    dragVisual.axis === "x" ? Math.min(1, Math.abs(dragVisual.x) / 200) : 0;
  const showLikeOverlay = dragVisual.axis === "x" && dragVisual.x > 30;
  const showSkipOverlay = dragVisual.axis === "x" && dragVisual.x < -30;
  const isAnimating = animatingRef.current;

  return (
    <article
      ref={cardRef}
      className={cn(
        "rounded-2xl overflow-hidden bg-[var(--card)] border shadow-sm relative select-none",
        // Card füllt den von außen vorgegebenen Raum (viewport-locked Layout);
        // keine fixe Höhe — Image-Area absorbiert per flex-1 was übrig bleibt.
        "h-full flex flex-col",
        // Smooth transition wenn snap-back oder fly-out, nicht während aktivem Drag
        dragVisual.axis === "" || isAnimating
          ? "transition-transform duration-200 ease-out"
          : ""
      )}
      style={{
        transform: `translate(${dragVisual.x}px, ${dragVisual.y * 0.3}px) rotate(${rotation}deg)`,
      }}
    >
      {/* Image-Area + vertikaler Thumb-Strip nebeneinander.
          flex-1 + min-h-0: nimmt den verbleibenden Platz, lässt Stack scrollen. */}
      <div className="flex flex-1 min-h-0">
      {/* Image-Area-Container: relativ, enthält Scroll-Stack + Overlay-Layer */}
      <div className="relative flex-1 bg-[var(--muted)] overflow-hidden">

        {/* Scroll-Stack: vertikal scrollbar mit Snap, Browser handhabt Momentum.
            Bei mehreren Bildern: Slides sind 85 % der Viewport-Höhe + Spacer
            oben/unten → ein Stück nächstes/voriges Bild peekt am Rand. */}
        <div
          ref={swipeAreaRef}
          className="absolute inset-0 overflow-y-auto snap-y snap-mandatory scrollbar-hidden"
          style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (total === 0) return;
            const slideH =
              total > 1 ? el.clientHeight * SLIDE_RATIO : el.clientHeight;
            const idx = Math.round(el.scrollTop / slideH);
            if (idx !== imgIdx && idx >= 0 && idx < total) {
              setImgIdx(idx);
            }
          }}
        >
          {total === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--muted-foreground)]">
              Kein Bild
            </div>
          ) : (
            <>
              {/* Top-Spacer ermöglicht snap-center für das erste Bild und
                  schafft den Peek-Bereich für das vorige Bild. */}
              {total > 1 && (
                <div aria-hidden className="h-[7.5%] shrink-0" />
              )}
              {images.map((src, i) => (
                <div
                  key={`${data.id}-img-${i}`}
                  data-slide-idx={i}
                  className={cn(
                    "relative w-full shrink-0 bg-[var(--muted)]",
                    // Stacked-Card-Look bei mehreren Bildern: starke Rundung,
                    // weicher Schatten, Ring → wirkt wie physische Karten.
                    // origin-center damit Scale-Down sauber aus der Mitte kommt.
                    total > 1
                      ? "h-[85%] snap-center rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/10 origin-center"
                      : "h-full snap-start"
                  )}
                  style={
                    // Initialer Wert; wird vom Scroll-Effekt sofort überschrieben.
                    total > 1 ? { transform: "scale(1)", opacity: 1 } : undefined
                  }
                >
                  {!brokenIdx.has(i) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={src}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      draggable={false}
                      loading={i === 0 ? "eager" : "lazy"}
                      onError={() =>
                        setBrokenIdx((prev) => {
                          const next = new Set(prev);
                          next.add(i);
                          return next;
                        })
                      }
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
                      Bild nicht ladbar
                    </div>
                  )}
                </div>
              ))}
              {total > 1 && (
                <div aria-hidden className="h-[7.5%] shrink-0" />
              )}
            </>
          )}
        </div>

        {/* Overlay-Layer: bleibt fix beim Scrollen. pointer-events-none auf
            Container, einzelne Buttons setzen sich auf auto. */}
        <div className="absolute inset-0 pointer-events-none">
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

          {/* Tap-Targets für Like/Skip — funktional gleichwertig zum Wischen.
              Größe 12 (48 px) entspricht Apple-HIG-Tap-Mindestgröße.
              Visuell semi-transparent, scaliert mit aktivem Drag. */}
          <button
            type="button"
            onClick={() => onSwipe?.("skip")}
            aria-label="Kein Interesse"
            className="absolute left-2 top-1/2 flex flex-col items-center gap-1 transition-all pointer-events-auto"
            style={{
              opacity: 0.45 + opacityHorizontal * 0.55,
              transform: `translateY(-50%) scale(${1 + (showSkipOverlay ? opacityHorizontal * 0.3 : 0)})`,
            }}
          >
            <span className="size-12 rounded-full bg-rose-600/85 backdrop-blur flex items-center justify-center text-white shadow">
              <ArrowLeft className="size-6" />
            </span>
            <span className="text-[10px] font-medium text-white bg-rose-600/85 backdrop-blur px-1.5 py-0.5 rounded">
              Kein Interesse
            </span>
          </button>
          <button
            type="button"
            onClick={() => onSwipe?.("like")}
            aria-label="Interesse"
            className="absolute right-2 top-1/2 flex flex-col items-center gap-1 transition-all pointer-events-auto"
            style={{
              opacity: 0.45 + opacityHorizontal * 0.55,
              transform: `translateY(-50%) scale(${1 + (showLikeOverlay ? opacityHorizontal * 0.3 : 0)})`,
            }}
          >
            <span className="size-12 rounded-full bg-emerald-600/85 backdrop-blur flex items-center justify-center text-white shadow">
              <ArrowRight className="size-6" />
            </span>
            <span className="text-[10px] font-medium text-white bg-emerald-600/85 backdrop-blur px-1.5 py-0.5 rounded">
              Interesse
            </span>
          </button>

          {/* Like-Overlay (Stempel beim Threshold-Drag) — grün */}
          {showLikeOverlay && (
            <div
              className="absolute inset-0 bg-emerald-500/40 flex items-center justify-center"
              style={{ opacity: opacityHorizontal }}
            >
              <div className="rounded-2xl border-4 border-white text-white px-6 py-3 -rotate-12 flex items-center gap-2 text-2xl font-bold tracking-wide">
                <Heart className="size-7 fill-white" /> INTERESSE
              </div>
            </div>
          )}
          {/* Skip-Overlay — rot */}
          {showSkipOverlay && (
            <div
              className="absolute inset-0 bg-rose-600/40 flex items-center justify-center"
              style={{ opacity: opacityHorizontal }}
            >
              <div className="rounded-2xl border-4 border-white text-white px-6 py-3 rotate-12 flex items-center gap-2 text-2xl font-bold tracking-wide">
                <XIcon className="size-7" /> KEIN INTERESSE
              </div>
            </div>
          )}

          {/* Info gradient overlay (Preis + Lage) */}
          <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-white">
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
      </div>

      {/* Vertikaler Thumb-Strip (rechts neben dem Bild) — eigener Scroll, keine
          Geste-Kollision mit Like/Skip. Auf Mobile ausgeblendet, da der Strip
          dort dem Bild zu viel Breite klaut und Vertikal-Swipe + Counter "1/n"
          die Navigation schon abdecken. */}
      {total > 1 && (
        <div
          ref={stripRef}
          className="hidden sm:block w-16 shrink-0 overflow-y-auto bg-[var(--card)] border-l border-[var(--border)] scrollbar-hidden"
          style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
        >
          <div className="p-1.5 space-y-1.5">
            {images.map((src, i) => (
              <button
                key={`${data.id}-thumb-${i}`}
                data-thumb-idx={i}
                onClick={() => setImgIdx(i)}
                className={cn(
                  "relative w-full aspect-square rounded-md overflow-hidden border-2 transition-all",
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
        </div>
      )}
      </div>{/* /flex image+thumbs */}

      {/* Inserat-ansehen-Link (deutlich sichtbar zwischen Bild und Facts) */}
      <Link
        href={`/listings/${data.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 flex items-center justify-center gap-2 border-t bg-slate-900 hover:bg-slate-800 text-white text-base font-semibold py-3 transition-colors"
      >
        <ExternalLink className="size-5" />
        Zum Inserat
      </Link>

      {/* Facts row */}
      <div className="shrink-0 px-4 py-2.5 grid grid-cols-3 gap-2 text-center text-sm">
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
