"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isVideoUrl, type ListingPhoto } from "./types";
import { PhotoLightbox } from "./PhotoLightbox";
import { useT } from "@/lib/i18n/client";
import { tFormat, type TKey } from "@/lib/i18n/dict";

const ROOM_KEY: Record<string, TKey> = {
  living: "room.living",
  kitchen: "room.kitchen",
  bedroom: "room.bedroom",
  bathroom: "room.bathroom",
  balcony: "room.balcony",
  terrace: "room.terrace",
  exterior: "room.exterior",
  view: "room.view",
  garden: "room.garden",
  pool: "room.pool",
  parking: "room.parking",
  hallway: "room.hallway",
  utility: "room.utility",
  other: "room.other",
};

export function RoomGalleryGrid({ photos }: { photos: ListingPhoto[] }) {
  const { t } = useT();
  const grouped = React.useMemo(() => {
    const map = new Map<string, ListingPhoto[]>();
    for (const p of photos) {
      const key = p.room_type ?? "other";
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [photos]);

  const groups = React.useMemo(
    () =>
      Array.from(grouped.entries())
        .filter(([, arr]) => arr.length > 0)
        .sort((a, b) => b[1].length - a[1].length),
    [grouped]
  );

  const [openRoom, setOpenRoom] = React.useState<string | null>(null);
  const [openIndex, setOpenIndex] = React.useState(0);
  const openPhotos = openRoom ? grouped.get(openRoom) ?? [] : [];

  if (groups.length === 0) return null;

  function roomLabel(key: string): string {
    const tk = ROOM_KEY[key];
    return tk ? t(tk) : key;
  }

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("rooms.heading")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {groups.map(([room, list]) => (
            <button
              key={room}
              type="button"
              onClick={() => {
                setOpenRoom(room);
                setOpenIndex(0);
              }}
              className={cn(
                "group relative aspect-[4/3] overflow-hidden rounded-xl border bg-[var(--muted)] text-left",
                "focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              )}
            >
              {isVideoUrl(list[0].url) ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={list[0].url}
                  muted
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={list[0].url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
                  draggable={false}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-3 text-white flex items-end justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{roomLabel(room)}</div>
                  <div className="text-[10px] opacity-90">
                    {tFormat(list.length === 1 ? t("rooms.image") : t("rooms.images"), {
                      n: list.length,
                    })}
                  </div>
                </div>
                <ArrowRight className="size-5 opacity-90 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          ))}
        </div>
      </section>

      {openRoom && openPhotos.length > 0 && (
        <PhotoLightbox
          photos={openPhotos}
          startIndex={openIndex}
          roomLabel={roomLabel(openRoom)}
          onClose={() => setOpenRoom(null)}
        />
      )}
    </>
  );
}
