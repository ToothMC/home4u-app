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

import { verdictFromScore } from "@/components/scam-shield/ScoreLight";
import { cn } from "@/lib/utils";
import type { MarketPosition } from "@/lib/repo/listings";

// Vertikaler Scroll-Indicator rechts vom Bild — die Bilder werden vertikal
// gewischt (snap-y), darum vertikale Pagination, nicht horizontal.
const MAX_DOTS = 7;

type DotInfo = { active: boolean; size: "lg" | "md" | "sm" };

function dotWindow(active: number, total: number, max: number): DotInfo[] {
  if (total <= max) {
    return Array.from({ length: total }, (_, i) => ({
      active: i === active,
      size: "lg" as const,
    }));
  }
  const half = Math.floor(max / 2);
  let start = Math.max(0, active - half);
  let end = start + max;
  if (end > total) {
    end = total;
    start = end - max;
  }
  const out: DotInfo[] = [];
  for (let i = start; i < end; i++) {
    const distFromEdge = Math.min(i - start, end - 1 - i);
    let size: DotInfo["size"] = "lg";
    if (distFromEdge === 0 && (i !== 0 && i !== total - 1)) size = "sm";
    else if (distFromEdge === 1 && (i !== 1 && i !== total - 2)) size = "md";
    out.push({ active: i === active, size });
  }
  return out;
}

const SCAM_PILL = {
  clean: { dot: "bg-emerald-500", border: "border-emerald-300", text: "text-emerald-700", label: "Kein Scam" },
  warn: { dot: "bg-orange-500", border: "border-orange-300", text: "text-orange-700", label: "Verdächtig" },
  high: { dot: "bg-red-500", border: "border-red-300", text: "text-red-700", label: "Scam-Verdacht" },
  none: { dot: "bg-black/30", border: "border-black/15", text: "text-[var(--muted-foreground)]", label: "Nicht geprüft" },
} as const;

const MARKET_PILL: Record<
  Exclude<MarketPosition, "unknown">,
  { bars: number; label: string; tone: "green" | "orange" }
> = {
  very_good: { bars: 5, label: "Sehr guter Preis", tone: "green" },
  good: { bars: 4, label: "Guter Preis", tone: "green" },
  fair: { bars: 3, label: "Fairer Preis", tone: "green" },
  above: { bars: 2, label: "Erhöhter Preis", tone: "orange" },
  expensive: { bars: 1, label: "Hoher Preis", tone: "orange" },
};

export type MatchCardData = {
  id: string;
  type: "rent" | "sale";
  /** Sophie-Check-Score (Indexer-Spec §6). Optional — wenn unset oder
   *  score=0 mit leerem flags-Array, wird "noch nicht geprüft" gerendert. */
  scamScore?: number | null;
  scamFlags?: string[] | null;
  marketPosition?: MarketPosition | null;
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number | null;
  size_sqm: number | null;
  media: string[] | null;
  score: number;
  /** Migration 0038: Anzahl Listings mit identischem Cover in derselben
   *  City/Type/Property-Type-Gruppe. Wenn ≥2 → Karte zeigt einen Hinweis
   *  „+N weitere ähnliche". Vermutete Re-Listings vom selben Broker. */
  clusterSize?: number;
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
    const target = imgIdx * el.clientHeight;
    if (Math.abs(el.scrollTop - target) > 2) {
      el.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [imgIdx, total]);

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

        {/* Scroll-Stack: jede Slide ist ein voller Viewport, snap-start. */}
        <div
          ref={swipeAreaRef}
          className="absolute inset-0 overflow-y-auto snap-y snap-mandatory scrollbar-hidden"
          style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
          onScroll={(e) => {
            const el = e.currentTarget;
            const idx = Math.round(el.scrollTop / el.clientHeight);
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
            images.map((src, i) => (
              <div
                key={`${data.id}-img-${i}`}
                className="relative h-full w-full snap-start shrink-0 bg-[var(--muted)]"
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
            ))
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

          {/* Cluster-Hinweis: identisches Cover-Bild kommt mehrfach vor —
              Re-Listing oder Broker-Branded-Default. UI macht's transparent. */}
          {data.clusterSize && data.clusterSize > 1 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500/90 backdrop-blur px-2.5 py-0.5 text-[10px] font-medium text-white shadow">
              +{data.clusterSize - 1} ähnliche
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

          {/* Info gradient overlay (Preis + Lage links, Badges rechts).
              Layout:
                Preis €                 [Preisbewertung]
                Ort                     [Sophie-Check Ampel]
              Preisbewertung wird ergänzt, sobald market_position in
              MatchCardData geplumbt ist. Bis dahin nur Scam-Check. */}
          <div className="absolute bottom-0 inset-x-0 p-4 pb-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-white">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
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
              <div className="shrink-0 flex flex-col items-end gap-1">
                <MarketPill position={data.marketPosition ?? null} />
                <ScamPill score={data.scamScore} flags={data.scamFlags} />
              </div>
            </div>
          </div>

          {/* Vertikaler Scroll-Indicator rechts oben — bewusst NICHT mittig,
              damit er nicht mit dem rechten Like-Pfeil (top-1/2) kollidiert.
              Sliding-Window für viele Bilder. */}
          {total > 1 && (
            <div className="absolute right-2 top-12 pointer-events-none">
              <div className="flex flex-col items-center gap-1.5 rounded-full bg-black/30 backdrop-blur px-1 py-1.5">
                {dotWindow(imgIdx, total, MAX_DOTS).map((d, i) => (
                  <span
                    key={`dot-${i}`}
                    className={cn(
                      "rounded-full transition-all",
                      d.size === "lg" ? "size-1.5" : d.size === "md" ? "size-[5px]" : "size-[3px]",
                      d.active ? "bg-white" : "bg-white/55",
                    )}
                  />
                ))}
              </div>
            </div>
          )}
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

/** Kompakte Pille für den Sophie-Scam-Check, weiß mit dünnem Verdict-Rahmen. */
function ScamPill({
  score,
  flags,
}: {
  score?: number | null;
  flags?: string[] | null;
}) {
  const checked =
    score != null && (score > 0 || (Array.isArray(flags) && flags.length > 0));
  const verdict: keyof typeof SCAM_PILL = !checked
    ? "none"
    : verdictFromScore(score ?? 0);
  const c = SCAM_PILL[verdict];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-white border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        c.border,
        c.text,
      )}
    >
      <span className={cn("inline-block size-1.5 rounded-full", c.dot)} aria-hidden />
      {c.label}
    </span>
  );
}

/** Kompakte Pille für die Preis-Einschätzung — bars + Kurz-Label. */
function MarketPill({ position }: { position: MarketPosition | null }) {
  if (!position || position === "unknown") return null;
  const cfg = MARKET_PILL[position];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-white border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        cfg.tone === "green"
          ? "border-emerald-300 text-emerald-700"
          : "border-amber-300 text-amber-700",
      )}
      aria-label={cfg.label}
    >
      <span
        className="inline-flex items-end gap-[1px]"
        aria-hidden
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn(
              "w-[2px] rounded-sm",
              i <= cfg.bars
                ? cfg.tone === "green"
                  ? "bg-emerald-500"
                  : "bg-amber-500"
                : "bg-black/15",
            )}
            style={{ height: `${4 + i * 1.5}px` }}
          />
        ))}
      </span>
      {cfg.label}
    </span>
  );
}
