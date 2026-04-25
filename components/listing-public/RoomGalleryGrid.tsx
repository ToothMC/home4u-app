"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROOM_LABEL, type ListingPhoto } from "./types";

export function RoomGalleryGrid({ photos }: { photos: ListingPhoto[] }) {
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

  const groups = Array.from(grouped.entries())
    .filter(([, arr]) => arr.length > 0)
    .sort((a, b) => b[1].length - a[1].length);

  if (groups.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Raum für Raum entdecken</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {groups.map(([room, list]) => (
          <button
            key={room}
            type="button"
            className={cn(
              "group relative aspect-[4/3] overflow-hidden rounded-xl border bg-[var(--muted)]",
              "text-left"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={list[0].url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <div className="absolute bottom-0 inset-x-0 p-3 text-white flex items-end justify-between gap-2">
              <div>
                <div className="font-medium text-sm">
                  {ROOM_LABEL[room] ?? room}
                </div>
                <div className="text-[10px] opacity-90">
                  {list.length} {list.length === 1 ? "Bild" : "Bilder"}
                </div>
              </div>
              <ArrowRight className="size-5 opacity-90 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
