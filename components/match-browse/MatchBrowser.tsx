"use client";

import * as React from "react";
import Link from "next/link";
import {
  Heart,
  X,
  MessageCircle,
  Loader2,
  Check,
  Sparkles,
  Hand,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MatchCard, type MatchCardData, type SwipeDirection } from "./MatchCard";

type Status = "browsing" | "submitting" | "done";
type ToastState = {
  matchId: string;
  listingId: string;
  expiresAt: number;
} | null;

const SKIP_KEY = "home4u_skipped_listings";
const HINT_SEEN_KEY = "home4u_swipe_hint_seen";

function loadSkipped(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SKIP_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistSkipped(s: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SKIP_KEY, JSON.stringify(Array.from(s)));
  } catch {}
}

export function MatchBrowser({ matches }: { matches: MatchCardData[] }) {
  const [skipped, setSkipped] = React.useState<Set<string>>(() => new Set());
  const [skipReady, setSkipReady] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const [status, setStatus] = React.useState<Status>("browsing");
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<ToastState>(null);
  const [hintVisible, setHintVisible] = React.useState(false);

  // Skipped + hint-state aus localStorage
  React.useEffect(() => {
    setSkipped(loadSkipped());
    setSkipReady(true);
    if (typeof window !== "undefined") {
      const seen = window.localStorage.getItem(HINT_SEEN_KEY);
      if (!seen) setHintVisible(true);
    }
  }, []);

  // Toast auto-dismiss nach 5 Sek
  React.useEffect(() => {
    if (!toast) return;
    const remaining = toast.expiresAt - Date.now();
    if (remaining <= 0) {
      setToast(null);
      return;
    }
    const t = setTimeout(() => setToast(null), remaining);
    return () => clearTimeout(t);
  }, [toast]);

  const queue = React.useMemo(
    () => (skipReady ? matches.filter((m) => !skipped.has(m.id)) : matches),
    [matches, skipped, skipReady]
  );

  const current = queue[idx];

  function dismissHint() {
    setHintVisible(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HINT_SEEN_KEY, "1");
    }
  }

  // Keyboard: ← skip, → like
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (status !== "browsing" || !current) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        like();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        skip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, status]);

  function skip() {
    if (!current) return;
    if (hintVisible) dismissHint();
    const next = new Set(skipped);
    next.add(current.id);
    setSkipped(next);
    persistSkipped(next);
    setIdx(0);
    setError(null);
  }

  async function like() {
    if (!current) return;
    if (hintVisible) dismissHint();
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/matches/like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listing_id: current.id }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `Fehler ${res.status}`);
        setStatus("browsing");
        return;
      }
      const json = await res.json();
      const next = new Set(skipped);
      next.add(current.id);
      setSkipped(next);
      persistSkipped(next);
      setStatus("browsing");
      setIdx(0);
      if (json.match_id) {
        setToast({
          matchId: json.match_id,
          listingId: current.id,
          expiresAt: Date.now() + 5000,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Netzwerkfehler");
      setStatus("browsing");
    }
  }

  async function undoLast() {
    if (!toast) return;
    const matchId = toast.matchId;
    const listingId = toast.listingId;
    setToast(null);
    try {
      await fetch("/api/matches/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ match_id: matchId }),
      });
    } catch {
      // Best-Effort
    }
    // Listing aus skipped entfernen, damit es wieder erscheint
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(listingId);
      persistSkipped(next);
      return next;
    });
  }

  function handleSwipe(dir: SwipeDirection) {
    if (dir === "like") like();
    else skip();
  }

  if (!skipReady) {
    return <Loading />;
  }

  if (!current) {
    return <FinishedState />;
  }

  return (
    <div className="space-y-3 relative">
      <div className="text-xs text-[var(--muted-foreground)] flex items-center justify-between">
        <span>
          {idx + 1} / {queue.length} Treffer
        </span>
        {status === "submitting" && (
          <span className="text-[var(--muted-foreground)] flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> wird gesendet…
          </span>
        )}
      </div>

      <div className="relative">
        <MatchCard data={current} onSwipe={handleSwipe} isTop />
        {hintVisible && <SwipeHintOverlay onDismiss={dismissHint} />}
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          size="lg"
          onClick={skip}
          disabled={status !== "browsing"}
          className="h-14 rounded-full border-2"
          aria-label="Kein Interesse"
        >
          <X className="size-5" />
          Kein Interesse
        </Button>
        <Button
          size="lg"
          onClick={like}
          disabled={status !== "browsing"}
          className={cn(
            "h-14 rounded-full bg-rose-500 hover:bg-rose-600 text-white",
            "disabled:opacity-70"
          )}
          aria-label="Interesse"
        >
          {status === "submitting" ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Heart className="size-5 fill-white" />
          )}
          Interesse
        </Button>
      </div>

      <p className="text-[10px] text-center text-[var(--muted-foreground)]">
        Mobile: ← → wischen · ↕ alle Bilder · Tap auf Symbol oben rechts =
        Inserat öffnen
      </p>

      {toast && (
        <Toast
          listingId={toast.listingId}
          onUndo={undoLast}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

function SwipeHintOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="absolute inset-0 z-10 rounded-2xl bg-black/65 backdrop-blur-sm text-white p-6 flex flex-col items-center justify-center gap-4 text-center"
      aria-label="Hinweise schließen"
    >
      <Hand className="size-10" />
      <div className="space-y-3 text-sm max-w-xs">
        <div className="flex items-center gap-3 justify-center">
          <span className="text-2xl">→</span>
          <span>Wischen rechts = <strong>Interesse</strong></span>
        </div>
        <div className="flex items-center gap-3 justify-center">
          <span className="text-2xl">←</span>
          <span>Wischen links = Kein Interesse</span>
        </div>
        <div className="flex items-center gap-3 justify-center">
          <ChevronUp className="size-5" />
          <ChevronDown className="size-5" />
          <span>Hoch/Runter = alle Bilder</span>
        </div>
        <div className="text-xs opacity-80 pt-2">Tap zum Schließen</div>
      </div>
    </button>
  );
}

function Toast({
  listingId,
  onUndo,
  onDismiss,
}: {
  listingId: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 max-w-xs rounded-xl shadow-lg bg-emerald-700 text-white p-3 flex items-start gap-2 animate-in fade-in slide-in-from-top-4">
      <Check className="size-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-medium">Anfrage raus</div>
        <div className="text-xs opacity-90 flex items-center gap-2 mt-0.5">
          <Link
            href={`/listings/${listingId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
          >
            Inserat ansehen
          </Link>
          <span>·</span>
          <button
            type="button"
            onClick={onUndo}
            className="underline hover:no-underline"
          >
            rückgängig
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Schließen"
        className="opacity-80 hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-[var(--muted-foreground)]">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

function FinishedState() {
  return (
    <div className="rounded-2xl border p-8 text-center space-y-4">
      <div className="mx-auto size-12 rounded-full bg-emerald-100 flex items-center justify-center">
        <Sparkles className="size-6 text-emerald-700" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Alle Treffer durch</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Du hast alle vorgeschlagenen Inserate gesehen. Sophie sucht weiter —
          schau später nochmal vorbei.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Button asChild>
          <Link href="/dashboard">Zum Dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/chat">
            <MessageCircle className="size-4" /> Mit Sophie chatten
          </Link>
        </Button>
      </div>
    </div>
  );
}
