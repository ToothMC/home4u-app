"use client";

import * as React from "react";
import { AlertCircle, Check, Loader2, Upload, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const BUCKET = "listing-media";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB pro Bild
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB pro Video
const MAX_PARALLEL = 4; // gleichzeitig laufende Uploads

type FileStatus = "queued" | "uploading" | "done" | "error";

type Track = {
  id: string;
  name: string;
  size: number;
  isVideo: boolean;
  status: FileStatus;
  error?: string;
  url?: string;
};

export function PhotoDropZone({
  onUploaded,
  disabled,
}: {
  /** Wird einmal pro erfolgreich hochgeladenem File aufgerufen */
  onUploaded: (m: { url: string; name: string; isVideo: boolean }) => void;
  disabled?: boolean;
}) {
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
      setGlobalError("Supabase nicht konfiguriert.");
      return;
    }
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) {
      setGlobalError("Bitte zuerst anmelden, um Bilder hochzuladen.");
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
      const file = trackById.get(track.id);
      if (!file) return;

      const max = track.isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (file.size > max) {
        updateTrack(track.id, {
          status: "error",
          error: `Zu groß (${Math.round(file.size / 1024 / 1024)} MB, max ${Math.round(max / 1024 / 1024)} MB)`,
        });
        return;
      }

      updateTrack(track.id, { status: "uploading" });

      const safeName = file.name
        .toLowerCase()
        .replace(/[^a-z0-9.\-_]/g, "_")
        .slice(0, 80);
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

      try {
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: false });
        if (upErr) {
          updateTrack(track.id, { status: "error", error: upErr.message });
          return;
        }
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        updateTrack(track.id, { status: "done", url: pub.publicUrl });
        onUploaded({
          url: pub.publicUrl,
          name: file.name,
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
        <div className="text-sm font-medium">
          Bilder oder Videos hier ablegen — oder klicken
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">
          Mehrere gleichzeitig möglich · max 10 MB pro Bild · max 100 MB pro Video
        </div>
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
                ? `${inFlight} laufen · ${tracks.filter((t) => t.status === "done").length} fertig`
                : `${tracks.filter((t) => t.status === "done").length} fertig${
                    tracks.filter((t) => t.status === "error").length
                      ? ` · ${tracks.filter((t) => t.status === "error").length} Fehler`
                      : ""
                  }`}
            </span>
            {inFlight === 0 && tracks.some((t) => t.status === "done") && (
              <button
                type="button"
                onClick={clearDone}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                Liste leeren
              </button>
            )}
          </div>
          {tracks.slice(-12).map((t) => (
            <TrackRow key={t.id} track={t} onDismiss={() => dismissTrack(t.id)} />
          ))}
          {tracks.length > 12 && (
            <div className="px-3 py-2 text-[10px] text-[var(--muted-foreground)]">
              +{tracks.length - 12} weitere
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrackRow({ track, onDismiss }: { track: Track; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      {track.status === "queued" && (
        <span className="size-3 rounded-full border-2 border-[var(--muted-foreground)]/40" />
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
      ) : (
        <span className="text-[var(--muted-foreground)] tabular-nums">
          {Math.round(track.size / 1024)} KB
        </span>
      )}

      {(track.status === "done" || track.status === "error") && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label="Eintrag entfernen"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
