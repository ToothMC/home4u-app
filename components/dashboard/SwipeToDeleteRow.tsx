"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

const OPEN_OFFSET = 88;
const CONFIRM_OFFSET = 176;
const OPEN_THRESHOLD = 36;

type Props = {
  endpoint: string;
  what: string;
  children: React.ReactNode;
};

export function SwipeToDeleteRow({ endpoint, what, children }: Props) {
  const router = useRouter();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const startXRef = React.useRef<number | null>(null);
  const startOffsetRef = React.useRef(0);
  const draggingRef = React.useRef(false);

  const [offset, setOffset] = React.useState(0);
  const [transition, setTransition] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const open = offset < -4;

  const close = React.useCallback(() => {
    setTransition(true);
    setOffset(0);
    setConfirming(false);
    setError(null);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    function onDocPointer(ev: PointerEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(ev.target as Node)) return;
      close();
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open, close]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Nur Touch zieht — Maus-Drag würde sonst Text-Selektion stören.
    if (e.pointerType !== "touch") return;
    startXRef.current = e.clientX;
    startOffsetRef.current = offset;
    draggingRef.current = false;
    setTransition(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (startXRef.current == null) return;
    const dx = e.clientX - startXRef.current;
    if (!draggingRef.current && Math.abs(dx) > 6) {
      draggingRef.current = true;
    }
    if (!draggingRef.current) return;
    let next = startOffsetRef.current + dx;
    if (next > 0) next = next * 0.2;
    if (next < -OPEN_OFFSET) next = -OPEN_OFFSET - (next + OPEN_OFFSET) * 0.3;
    setOffset(next);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (startXRef.current == null) return;
    const dragged = draggingRef.current;
    startXRef.current = null;
    setTransition(true);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!dragged) return;
    const shouldOpen = offset <= -OPEN_THRESHOLD;
    setOffset(shouldOpen ? -OPEN_OFFSET : 0);
    if (!shouldOpen) setConfirming(false);
  }

  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (draggingRef.current) {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = false;
    }
  }

  async function doDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `Fehler ${res.status}`);
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Netzwerkfehler");
      setSubmitting(false);
    }
  }

  function openTrash() {
    setTransition(true);
    setOffset(-OPEN_OFFSET);
    setConfirming(false);
  }

  function expandConfirm() {
    setTransition(true);
    setOffset(-CONFIRM_OFFSET);
    setConfirming(true);
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-lg"
    >
      <div className="absolute inset-y-0 right-0 flex items-stretch z-0">
        {confirming ? (
          <button
            type="button"
            onClick={doDelete}
            disabled={submitting}
            className="flex w-[176px] items-center justify-center gap-1.5 bg-red-700 text-sm font-medium text-white px-3 disabled:opacity-70"
            aria-label={`${what} wirklich löschen`}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Wirklich löschen?
          </button>
        ) : (
          <button
            type="button"
            onClick={expandConfirm}
            className="flex w-[88px] items-center justify-center bg-red-600 text-white"
            aria-label={`${what} löschen`}
          >
            <Trash2 className="size-5" />
          </button>
        )}
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        style={{
          transform: `translateX(${offset}px)`,
          transition: transition ? "transform 180ms ease" : "none",
          touchAction: "pan-y",
        }}
        className="relative z-10 bg-[var(--card)] flex"
      >
        <div className="flex-1 min-w-0">{children}</div>
        {/* Desktop-Affordance: immer sichtbarer Trash-Button rechts.
            Auf Touch funktioniert zusätzlich der Swipe nach links. */}
        <button
          type="button"
          onClick={open ? close : openTrash}
          aria-label={open ? "Schließen" : `${what} löschen`}
          className="shrink-0 px-2 self-center text-[var(--muted-foreground)] hover:text-red-600"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {error && (
        <p className="mt-1 px-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}
