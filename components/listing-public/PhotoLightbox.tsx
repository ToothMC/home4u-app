"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListingPhoto } from "./types";
import { ROOM_LABEL, isVideoUrl } from "./types";

export function PhotoLightbox({
  photos,
  startIndex,
  roomLabel,
  onClose,
}: {
  photos: ListingPhoto[];
  startIndex: number;
  roomLabel: string;
  onClose: () => void;
}) {
  const [idx, setIdx] = React.useState(startIndex);
  const [touchStart, setTouchStart] = React.useState<number | null>(null);

  const total = photos.length;
  const next = React.useCallback(
    () => setIdx((i) => (i + 1) % total),
    [total]
  );
  const prev = React.useCallback(
    () => setIdx((i) => (i - 1 + total) % total),
    [total]
  );

  // Keyboard
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  // Body scroll lock — iOS-Safari-tauglich.
  // Reines overflow:hidden reicht auf iOS NICHT (Body bounct trotzdem).
  // Trick: Body auf position:fixed parken mit top=-scrollY, beim Schliessen
  // zurueckspringen, damit der User nicht oben landet.
  React.useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  if (total === 0) return null;
  const current = photos[idx];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white text-sm shrink-0">
        <div className="font-medium">
          {roomLabel} · {idx + 1} / {total}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="size-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
          aria-label="Schließen"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Image area */}
      <div
        className="relative flex-1 flex items-center justify-center px-4 sm:px-12"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchStart === null) return;
          const dx = e.changedTouches[0].clientX - touchStart;
          if (Math.abs(dx) > 50) (dx < 0 ? next : prev)();
          setTouchStart(null);
        }}
      >
        {isVideoUrl(current.url) ? (
          // <video> respektiert keine reinen max-Maße zum Hochskalieren —
          // ohne explizite height bleibt das Element bei der intrinsischen
          // Video-Groesse (smartphone-Hochformat-Clips wirken winzig).
          // Mit h-[78vh] + w-auto skaliert der Browser proportional mit.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={current.url}
            src={current.url}
            controls
            playsInline
            className="h-[78vh] w-auto max-w-[92vw] sm:max-w-5xl bg-black"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={current.url}
            alt={current.caption ?? ""}
            // Harte max-Maße auf Viewport-Anteile, damit JEDES Bild — egal ob
            // mit/ohne Caption oder welches Seitenverhältnis — denselben Rahmen
            // bekommt. Vorher: flex-1 + h-full liess das Bild mitwachsen, sobald
            // eine Caption fehlte, und die Thumbnails wurden rausgedrueckt.
            className="max-h-[78vh] max-w-[92vw] sm:max-w-5xl object-contain select-none"
            draggable={false}
          />
        )}

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              aria-label="Vorheriges Bild"
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 size-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              aria-label="Nächstes Bild"
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 size-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur"
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        )}
      </div>

      {/* Caption */}
      {current.caption && (
        <div className="px-4 pb-2 text-center text-white/80 text-sm shrink-0">
          {current.caption}
        </div>
      )}

      {/* Thumbnail strip */}
      {total > 1 && (
        <div
          className="px-2 py-3 overflow-x-auto scrollbar-hidden shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex gap-2 justify-start sm:justify-center min-w-min">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setIdx(i)}
                className={cn(
                  // flex-none + explizite h-/w-Werte: vermeidet, dass der Flex-
                  // Container Thumbnails ungleichmäßig zusammenstaucht.
                  "flex-none h-16 w-16 sm:h-20 sm:w-20 rounded-md overflow-hidden border-2 transition-all",
                  i === idx
                    ? "border-white opacity-100"
                    : "border-transparent opacity-60 hover:opacity-100"
                )}
                aria-label={`Bild ${i + 1}`}
              >
                {isVideoUrl(p.url) ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={p.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.url}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function roomDisplayLabel(roomKey: string): string {
  return ROOM_LABEL[roomKey] ?? roomKey;
}
