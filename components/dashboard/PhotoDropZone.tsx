"use client";

import * as React from "react";
import { AlertCircle, Check, Loader2, Upload, Wand2, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/upload/compress";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { tFormat, type T } from "@/lib/i18n/dict";

const BUCKET = "listing-media";
const MAX_IMAGE_INPUT_BYTES = 50 * 1024 * 1024; // 50 MB Original (vor Compression)
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB pro Video
const MAX_PARALLEL = 4;

type FileStatus = "queued" | "compressing" | "uploading" | "done" | "error";

type Track = {
  id: string;
  name: string;
  size: number;
  isVideo: boolean;
  status: FileStatus;
  error?: string;
  url?: string;
  finalSize?: number;
};

export function PhotoDropZone({
  onUploaded,
  disabled,
}: {
  /** Wird einmal pro erfolgreich hochgeladenem File aufgerufen */
  onUploaded: (m: { url: string; name: string; isVideo: boolean }) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [tracks, setTracks] = React.useState<Track[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [globalError, setGlobalError] = React.useState<string | null>(null);

  const inFlight = tracks.filter((t) => t.status === "uploading" || t.status === "queued").length;

  function pickFiles() {
    inputRef.current?.click();
  }

  async function handleFileList(list: FileList | File[] | null) {
    if (!list) return;
    const files = Array.from(list as FileList | File[]);
    if (files.length === 0) return;
    setGlobalError(null);

    let supabase;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      setGlobalError(t("photo.notConfigured"));
      return;
    }
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) {
      setGlobalError(t("photo.signinFirst"));
      return;
    }

    // Tracks anlegen + sofort sichtbar
    const newTracks: Track[] = files.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      size: f.size,
      isVideo: f.type.startsWith("video/"),
      status: "queued",
    }));

    // Map zur File-Lookup
    const trackById = new Map<string, File>();
    newTracks.forEach((t, i) => trackById.set(t.id, files[i]));

    setTracks((prev) => [...prev, ...newTracks]);

    // Parallel-Pool mit Limit
    const queue = [...newTracks];
    const workers: Promise<void>[] = [];
    const upload = async (track: Track) => {
      const original = trackById.get(track.id);
      if (!original) return;

      // 1) Validate input size
      const maxInput = track.isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_INPUT_BYTES;
      if (original.size > maxInput) {
        updateTrack(track.id, {
          status: "error",
          error: `Zu groß (${Math.round(original.size / 1024 / 1024)} MB, max ${Math.round(maxInput / 1024 / 1024)} MB)`,
        });
        return;
      }

      // 2) Compression (nur Bilder)
      let toUpload: File = original;
      if (!track.isVideo) {
        updateTrack(track.id, { status: "compressing" });
        try {
          const result = await compressImage(original);
          toUpload = result.file;
          updateTrack(track.id, { finalSize: result.newSize });
        } catch (err) {
          console.warn("[compress] failed for", original.name, err);
          // Original durchreichen
        }
      }

      // 3) Upload
      updateTrack(track.id, { status: "uploading" });

      const safeName = toUpload.name
        .toLowerCase()
        .replace(/[^a-z0-9.\-_]/g, "_")
        .slice(0, 80);
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

      try {
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, toUpload, { upsert: false });
        if (upErr) {
          updateTrack(track.id, { status: "error", error: upErr.message });
          return;
        }
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        updateTrack(track.id, { status: "done", url: pub.publicUrl });
        onUploaded({
          url: pub.publicUrl,
          name: toUpload.name,
          isVideo: track.isVideo,
        });
      } catch (err) {
        updateTrack(track.id, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    while (queue.length > 0) {
      while (workers.length < MAX_PARALLEL && queue.length > 0) {
        const t = queue.shift()!;
        const p = upload(t).then(() => {
          workers.splice(workers.indexOf(p), 1);
        });
        workers.push(p);
      }
      if (workers.length > 0) await Promise.race(workers);
    }
    await Promise.all(workers);

    if (inputRef.current) inputRef.current.value = "";
  }

  function updateTrack(id: string, patch: Partial<Track>) {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function dismissTrack(id: string) {
    setTracks((prev) => prev.filter((t) => t.id !== id));
  }

  function clearDone() {
    setTracks((prev) => prev.filter((t) => t.status !== "done"));
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={pickFiles}
        disabled={disabled}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled) return;
          handleFileList(e.dataTransfer.files);
        }}
        className={cn(
          "w-full rounded-xl border-2 border-dashed p-6 sm:p-8 transition-colors",
          "flex flex-col items-center justify-center gap-2 text-center",
          dragOver
            ? "border-[var(--primary)] bg-[var(--accent)]"
            : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)]",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <Upload className="size-7 text-[var(--muted-foreground)]" />
        <div className="text-sm font-medium">{t("photo.dropHere")}</div>
        <div className="text-xs text-[var(--muted-foreground)]">{t("photo.subline")}</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => handleFileList(e.target.files)}
        />
      </button>

      {globalError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle className="size-3 mt-0.5 shrink-0" />
          {globalError}
        </div>
      )}

      {tracks.length > 0 && (
        <div className="rounded-md border bg-[var(--card)] divide-y">
          <div className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="text-[var(--muted-foreground)]">
              {inFlight > 0
                ? tFormat(t("photo.running"), {
                    a: inFlight,
                    b: tracks.filter((tr) => tr.status === "done").length,
                  })
                : `${tFormat(t("photo.doneCount"), { n: tracks.filter((tr) => tr.status === "done").length })}${
                    tracks.filter((tr) => tr.status === "error").length
                      ? ` · ${tFormat(t("photo.errorsCount"), { n: tracks.filter((tr) => tr.status === "error").length })}`
                      : ""
                  }`}
            </span>
            {inFlight === 0 && tracks.some((tr) => tr.status === "done") && (
              <button
                type="button"
                onClick={clearDone}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {t("photo.clearList")}
              </button>
            )}
          </div>
          {tracks.slice(-12).map((tr) => (
            <TrackRow key={tr.id} track={tr} onDismiss={() => dismissTrack(tr.id)} t={t} />
          ))}
          {tracks.length > 12 && (
            <div className="px-3 py-2 text-[10px] text-[var(--muted-foreground)]">
              {tFormat(t("photo.more"), { n: tracks.length - 12 })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrackRow({ track, onDismiss, t }: { track: Track; onDismiss: () => void; t: T }) {
  const formatSize = (b: number) =>
    b >= 1024 * 1024
      ? `${(b / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(b / 1024)} KB`;
  const compressed = track.finalSize != null && track.finalSize < track.size * 0.9;
  const savedPct =
    compressed && track.finalSize
      ? Math.round((1 - track.finalSize / track.size) * 100)
      : 0;

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      {track.status === "queued" && (
        <span className="size-3 rounded-full border-2 border-[var(--muted-foreground)]/40" />
      )}
      {track.status === "compressing" && (
        <Wand2 className="size-3 text-purple-700 animate-pulse" />
      )}
      {track.status === "uploading" && (
        <Loader2 className="size-3 animate-spin text-[var(--muted-foreground)]" />
      )}
      {track.status === "done" && <Check className="size-3 text-emerald-700" />}
      {track.status === "error" && <AlertCircle className="size-3 text-red-700" />}

      <span className="truncate flex-1">{track.name}</span>

      {track.status === "error" ? (
        <span className="text-red-700 truncate max-w-[200px]" title={track.error}>
          {track.error}
        </span>
      ) : track.status === "compressing" ? (
        <span className="text-purple-700">{t("photo.compressing")}</span>
      ) : compressed && track.finalSize ? (
        <span className="text-[var(--muted-foreground)] tabular-nums">
          {formatSize(track.size)} →{" "}
          <span className="text-emerald-700">{formatSize(track.finalSize)}</span>
          <span className="ml-1 text-[10px]">−{savedPct} %</span>
        </span>
      ) : (
        <span className="text-[var(--muted-foreground)] tabular-nums">
          {formatSize(track.size)}
        </span>
      )}

      {(track.status === "done" || track.status === "error") && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label={t("photo.removeAria")}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
