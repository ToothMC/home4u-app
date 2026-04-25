"use client";

import * as React from "react";
import Link from "next/link";
import { Heart, X, MessageCircle, Loader2, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MatchCard, type MatchCardData } from "./MatchCard";

type Status = "browsing" | "submitting" | "done";

const SKIP_KEY = "home4u_skipped_listings";

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
  const [recentLiked, setRecentLiked] = React.useState<MatchCardData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Skipped aus localStorage laden (nur clientseitig nach Mount, vermeidet
  // Hydration-Mismatch und react-hooks/set-state-in-effect Lint)
  React.useEffect(() => {
    setSkipped(loadSkipped());
    setSkipReady(true);
  }, []);

  // Filter Listings, die schon geliked oder geskippt wurden
  const queue = React.useMemo(
    () =>
      skipReady
        ? matches.filter((m) => !skipped.has(m.id))
        : matches,
    [matches, skipped, skipReady]
  );

  const current = queue[idx];

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
    const next = new Set(skipped);
    next.add(current.id);
    setSkipped(next);
    persistSkipped(next);
    setIdx(0); // queue verschiebt sich, idx 0 ist der nächste
    setRecentLiked(null);
    setError(null);
  }

  async function like() {
    if (!current) return;
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
      // Liked listing markieren als "weg" (gleicher Mechanismus wie skip,
      // damit es nicht nochmal auftaucht — die Anfrage liegt jetzt in der
      // Outbox / im Dashboard)
      const next = new Set(skipped);
      next.add(current.id);
      setSkipped(next);
      persistSkipped(next);
      setRecentLiked(current);
      setStatus("browsing");
      setIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Netzwerkfehler");
      setStatus("browsing");
    }
  }

  if (!skipReady) {
    return <Loading />;
  }

  if (!current) {
    return <FinishedState recentLiked={recentLiked} />;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-[var(--muted-foreground)] flex items-center justify-between">
        <span>
          {idx + 1} / {queue.length} Treffer
        </span>
        {recentLiked && (
          <span className="text-emerald-700 flex items-center gap-1">
            <Check className="size-3" /> Anfrage raus
          </span>
        )}
      </div>

      <MatchCard data={current} />

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
          aria-label="Weiter"
        >
          <X className="size-5" />
          Weiter
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
        ← Tastatur weiter · → Tastatur Interesse
      </p>
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

function FinishedState({ recentLiked }: { recentLiked: MatchCardData | null }) {
  return (
    <div className="rounded-2xl border p-8 text-center space-y-4">
      <div className="mx-auto size-12 rounded-full bg-emerald-100 flex items-center justify-center">
        <Sparkles className="size-6 text-emerald-700" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Alle Treffer durch</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          {recentLiked
            ? "Deine Anfragen liegen jetzt im Dashboard. Sobald ein Anbieter zusagt, schalten wir den Kontakt frei."
            : "Du hast alle vorgeschlagenen Inserate gesehen. Sophie sucht weiter — schau später nochmal vorbei."}
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
