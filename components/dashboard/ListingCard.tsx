"use client";

import { useState } from "react";
import { Loader2, Trash2, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MediaUploader, type AttachedMedia } from "@/components/chat/MediaUploader";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type ListingForCard = {
  id: string;
  type: "rent" | "sale";
  status: string;
  location_city: string;
  location_district: string | null;
  price: number;
  currency: string;
  rooms: number | null;
  size_sqm: number | null;
  media: string[] | null;
};

export function ListingCard({ listing }: { listing: ListingForCard }) {
  const [media, setMedia] = useState<string[]>(listing.media ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function appendMedia(m: AttachedMedia) {
    setError(null);
    setBusy("append");
    const next = Array.from(new Set([...media, m.url]));
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from("listings")
      .update({ media: next })
      .eq("id", listing.id);
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setMedia(next);
  }

  async function removeMedia(url: string) {
    setError(null);
    setBusy(url);
    const next = media.filter((m) => m !== url);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from("listings")
      .update({ media: next })
      .eq("id", listing.id);
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setMedia(next);
  }

  const cover = media[0];
  const isCoverVideo = cover && /\.(mp4|mov|webm)$/i.test(cover);

  return (
    <Card>
      {cover && (
        <div className="relative aspect-[16/9] overflow-hidden rounded-t-lg bg-[var(--muted)]">
          {isCoverVideo ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={cover}
              className="h-full w-full object-cover"
              muted
              playsInline
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-full w-full object-cover" />
          )}
          {media.length > 1 && (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
              +{media.length - 1}
            </span>
          )}
        </div>
      )}

      <CardHeader>
        <CardTitle className="text-base">
          {listing.location_city}
          {listing.location_district ? ` · ${listing.location_district}` : ""}
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{listing.rooms ?? "?"} Zimmer</span>
          {listing.size_sqm ? <span>{listing.size_sqm} m²</span> : null}
          <span>
            {Number(listing.price).toLocaleString("de-DE")}{" "}
            {listing.currency || "EUR"}
            {listing.type === "rent" ? "/Monat" : ""}
          </span>
          <span className="uppercase tracking-wider text-[10px]">
            {listing.status}
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent>
        {media.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {media.map((url) => {
              const isVideo = /\.(mp4|mov|webm)$/i.test(url);
              return (
                <div
                  key={url}
                  className="relative aspect-square overflow-hidden rounded border bg-[var(--muted)]"
                >
                  {isVideo ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video
                      src={url}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeMedia(url)}
                    disabled={busy === url}
                    aria-label="Medium entfernen"
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
                    style={{ opacity: 1 }}
                  >
                    {busy === url ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {!showUploader ? (
          <button
            type="button"
            onClick={() => setShowUploader(true)}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            <Plus className="size-3" />
            {media.length === 0
              ? "Bilder oder Video hinzufügen"
              : "Weitere Bilder/Videos"}
          </button>
        ) : (
          <div className="space-y-2">
            <MediaUploader
              attached={[]}
              onAttached={appendMedia}
              onRemove={() => {
                /* Upload-Chips sind hier nicht persistiert, wir speichern sofort */
              }}
              disabled={busy !== null}
            />
            <button
              type="button"
              onClick={() => setShowUploader(false)}
              className="text-xs text-[var(--muted-foreground)] hover:underline"
            >
              Schließen
            </button>
          </div>
        )}

        {error && (
          <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
