"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhotoLightbox } from "./PhotoLightbox";
import type { ListingPhoto } from "./types";
import { isVideoUrl } from "./types";

export function HeroGallery({ images }: { images: string[] }) {
  const [idx, setIdx] = React.useState(0);
  const [touchStart, setTouchStart] = React.useState<number | null>(null);
  const [broken, setBroken] = React.useState<Set<number>>(new Set());
  const [lightboxStart, setLightboxStart] = React.useState<number | null>(null);

  const total = images.length;
  if (total === 0) {
    return (
      <div className="aspect-[16/9] sm:aspect-[2/1] bg-[var(--muted)] rounded-2xl flex items-center justify-center text-sm text-[var(--muted-foreground)]">
        Keine Bilder
      </div>
    );
  }

  const next = () => setIdx((i) => (i + 1) % total);
  const prev = () => setIdx((i) => (i - 1 + total) % total);
  const sideThumbs = images.slice(0, 5).map((_, i) => i);

  // Lightbox-Photos im richtigen Format
  const lightboxPhotos: ListingPhoto[] = images.map((url, i) => ({
    id: `hero-${i}`,
    url,
    room_type: null,
    caption: null,
    position: i,
  }));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
      {/* Hero */}
      <div className="relative aspect-[16/10] sm:aspect-[5/3] overflow-hidden rounded-2xl bg-[var(--muted)]">
        {!broken.has(idx) ? (
          isVideoUrl(images[idx]) ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={images[idx]}
              src={images[idx]}
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover cursor-zoom-in"
              onClick={() => setLightboxStart(idx)}
              onError={() =>
                setBroken((p) => {
                  const n = new Set(p);
                  n.add(idx);
                  return n;
                })
              }
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={images[idx]}
              alt=""
              className="absolute inset-0 h-full w-full object-cover cursor-zoom-in"
              draggable={false}
              onClick={() => setLightboxStart(idx)}
              onError={() =>
                setBroken((p) => {
                  const n = new Set(p);
                  n.add(idx);
                  return n;
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
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted-foreground)]">
            Bild nicht ladbar
          </div>
        )}

        {total > 1 && (
          <>
            <button
              onClick={prev}
              aria-label="Vorheriges"
              className="absolute left-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-white/90 hover:bg-white text-[var(--foreground)] shadow flex items-center justify-center"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              onClick={next}
              aria-label="Nächstes"
              className="absolute right-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-white/90 hover:bg-white text-[var(--foreground)] shadow flex items-center justify-center"
            >
              <ChevronRight className="size-5" />
            </button>
            <div className="absolute bottom-3 left-3 rounded-full bg-black/60 backdrop-blur px-3 py-1 text-xs font-medium text-white">
              {idx + 1} / {total}
            </div>
            <button
              type="button"
              onClick={() => setLightboxStart(idx)}
              className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/90 hover:bg-white text-[var(--foreground)] shadow px-3 py-1 text-xs font-medium"
              aria-label="Alle Bilder anzeigen"
            >
              <Expand className="size-3" /> Alle Bilder
            </button>
          </>
        )}
      </div>

      {/* Side thumbs (desktop) */}
      <div className="hidden sm:grid grid-rows-5 gap-2">
        {sideThumbs.map((i) => (
          <button
            key={i}
            onClick={() => {
              if (i === 4 && total > 5) {
                setLightboxStart(0);
              } else {
                setIdx(i);
              }
            }}
            className={cn(
              "relative aspect-[5/3] overflow-hidden rounded-xl border-2 transition-all",
              i === idx ? "border-[var(--primary)]" : "border-transparent opacity-80 hover:opacity-100"
            )}
            aria-label={i === 4 && total > 5 ? "Alle Bilder anzeigen" : `Bild ${i + 1}`}
          >
            {!broken.has(i) ? (
              isVideoUrl(images[i]) ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={images[i]}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                  onError={() =>
                    setBroken((p) => {
                      const n = new Set(p);
                      n.add(i);
                      return n;
                    })
                  }
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={images[i]}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() =>
                    setBroken((p) => {
                      const n = new Set(p);
                      n.add(i);
                      return n;
                    })
                  }
                />
              )
            ) : (
              <div className="h-full w-full bg-[var(--muted)]" />
            )}
            {i === 4 && total > 5 && (
              <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-sm font-medium">
                +{total - 5}
              </div>
            )}
          </button>
        ))}
      </div>

      {lightboxStart != null && (
        <PhotoLightbox
          photos={lightboxPhotos}
          startIndex={lightboxStart}
          roomLabel="Alle Bilder"
          onClose={() => setLightboxStart(null)}
        />
      )}
    </div>
  );
}
