"use client";

import { useRef, useState } from "react";
import { Paperclip, X, Loader2, Film, ImageIcon } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type AttachedMedia = {
  url: string;
  kind: "image" | "video";
  name: string;
};

const BUCKET = "listing-media";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function MediaUploader({
  attached,
  onAttached,
  onRemove,
  disabled,
}: {
  attached: AttachedMedia[];
  onAttached: (m: AttachedMedia) => void;
  onRemove: (url: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setError("Supabase ist nicht konfiguriert.");
      return;
    }

    const { data: userResp } = await supabase.auth.getUser();
    const user = userResp.user;
    if (!user) {
      setError("Bitte zuerst anmelden, um Medien hochzuladen.");
      return;
    }

    setBusy(true);
    for (const file of Array.from(files)) {
      try {
        const isVideo = file.type.startsWith("video/");
        const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (file.size > max) {
          setError(
            `${file.name}: zu groß (${Math.round(file.size / 1024 / 1024)} MB, max ${Math.round(max / 1024 / 1024)} MB)`
          );
          continue;
        }

        const safeName = file.name
          .toLowerCase()
          .replace(/[^a-z0-9.\-_]/g, "_")
          .slice(0, 80);
        const path = `${user.id}/${Date.now()}-${safeName}`;

        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: false });
        if (upErr) {
          setError(`Upload fehlgeschlagen: ${upErr.message}`);
          continue;
        }
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        onAttached({
          url: pub.publicUrl,
          kind: isVideo ? "video" : "image",
          name: file.name,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      {attached.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attached.map((m) => (
            <div
              key={m.url}
              className="relative flex items-center gap-2 rounded-md border px-2 py-1 text-xs bg-[var(--accent)]"
            >
              {m.kind === "video" ? (
                <Film className="size-3" />
              ) : (
                <ImageIcon className="size-3" />
              )}
              <span className="max-w-[140px] truncate">{m.name}</span>
              <button
                type="button"
                onClick={() => onRemove(m.url)}
                aria-label="Entfernen"
                className="ml-1 opacity-60 hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          aria-label="Bild oder Video anhängen"
          className="flex h-10 w-10 items-center justify-center rounded-md border hover:bg-[var(--accent)] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {error && (
          <span className="text-xs text-[var(--destructive)] truncate flex-1">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
