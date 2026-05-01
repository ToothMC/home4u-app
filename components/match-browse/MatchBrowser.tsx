"use client";

import * as React from "react";
import Link from "next/link";
import {
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
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";
import { MatchCard, type MatchCardData, type SwipeDirection } from "./MatchCard";
import { useT } from "@/lib/i18n/client";
import { tFormat, type T } from "@/lib/i18n/dict";

type Status = "browsing" | "submitting" | "done";
type ToastState = {
  listingId: string;
  expiresAt: number;
} | null;

// Skip-Liste pro Suchprofil scopen — sonst persistieren Skips über neue
// Suchen hinweg und der User sieht "alle gesehen" sofort nach Anlage einer
// neuen Suche. Fallback "global" für Legacy-Sessions ohne profile_id (sollte
// in Production nicht vorkommen, aber robust).
const SKIP_KEY_PREFIX = "home4u_skipped_listings:";
const SKIP_KEY_LEGACY = "home4u_skipped_listings"; // pre-2026-04-28
const HINT_SEEN_KEY = "home4u_swipe_hint_seen";

function skipKey(profileId: string | null | undefined): string {
  return profileId ? `${SKIP_KEY_PREFIX}${profileId}` : SKIP_KEY_LEGACY;
}

function loadSkipped(profileId: string | null | undefined): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(skipKey(profileId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistSkipped(profileId: string | null | undefined, s: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(skipKey(profileId), JSON.stringify(Array.from(s)));
  } catch {}
}

export function MatchBrowser({
  matches,
  searchProfileId,
}: {
  matches: MatchCardData[];
  /** UUID des aktiven Suchprofils. Skip-Liste wird damit gescoped — eine
   *  neue Suche bedeutet automatisch frische Skip-Liste. null bei Legacy/
   *  Fallback (kein aktives Profil gefunden), nutzt dann globalen Key. */
  searchProfileId?: string | null;
}) {
  const { t } = useT();
  const [skipped, setSkipped] = React.useState<Set<string>>(() => new Set());
  const [skipReady, setSkipReady] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const [status, setStatus] = React.useState<Status>("browsing");
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<ToastState>(null);
  const [hintVisible, setHintVisible] = React.useState(false);

  // Skipped + hint-state aus localStorage. Reagiert auf Profile-ID-Wechsel:
  // neue Suche → frische Skip-Liste, ohne dass alte Suchen ihre Skips verlieren.
  React.useEffect(() => {
    setSkipped(loadSkipped(searchProfileId));
    setSkipReady(true);
    setIdx(0); // Reset auch den Karten-Cursor bei Profil-Wechsel
    if (typeof window !== "undefined") {
      const seen = window.localStorage.getItem(HINT_SEEN_KEY);
      if (!seen) setHintVisible(true);
    }
  }, [searchProfileId]);

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
    persistSkipped(searchProfileId, next);
    setIdx(0);
    setError(null);
  }

  async function like() {
    if (!current) return;
    if (hintVisible) dismissHint();
    setStatus("submitting");
    setError(null);
    try {
      // CRM-Pipeline: Swipe-Right = Stufe 2 (Favorit), kein direkter Match.
      // Anfrage entsteht erst per bewusstem Klick aus den Favoriten heraus.
      const res = await fetch(`/api/bookmarks/${current.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "swipe-browse",
          searchProfileId: searchProfileId ?? null,
        }),
      });
      if (res.status === 401) {
        setError(t("matchBrowse.signInForFavs"));
        setStatus("browsing");
        return;
      }
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        setStatus("browsing");
        return;
      }
      const json = await res.json();
      const next = new Set(skipped);
      next.add(current.id);
      setSkipped(next);
      persistSkipped(searchProfileId, next);
      setStatus("browsing");
      setIdx(0);
      // saved=false hieße: war schon gebookmarkt und wurde getoggelt — sollte
      // im Browse-Flow nicht passieren (Skip-Liste hält bereits gesehene weg),
      // aber wir zeigen den Toast nur bei tatsächlichem saved=true.
      if (json.saved !== false) {
        setToast({
          listingId: current.id,
          expiresAt: Date.now() + 5000,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
      setStatus("browsing");
    }
  }

  async function undoLast() {
    if (!toast) return;
    const listingId = toast.listingId;
    setToast(null);
    try {
      // Toggle: zweiter POST entfernt das Bookmark wieder.
      await fetch(`/api/bookmarks/${listingId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "swipe-undo" }),
      });
    } catch {
      // Best-Effort
    }
    // Listing aus skipped entfernen, damit es wieder erscheint
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(listingId);
      persistSkipped(searchProfileId, next);
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
    // flex-col mit Card als flex-1 — Card+Buttons füllen exakt einen Viewport,
    // kein Page-Scroll. min-h-0 ist nötig, damit flex-1 Kinder schrumpfen dürfen.
    <div className="flex flex-col flex-1 min-h-0 gap-2 relative">
      <div className="shrink-0 text-xs text-[var(--muted-foreground)] flex items-center justify-between">
        <span>{tFormat(t("matchBrowse.counter"), { i: idx + 1, n: queue.length })}</span>
        {status === "submitting" && (
          <span className="text-[var(--muted-foreground)] flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> {t("matchBrowse.sending")}
          </span>
        )}
      </div>

      <div className="relative flex-1 min-h-0">
        {/* key={data.id} → bei jedem Listing-Wechsel frische Instanz, damit
            kein dragVisual aus einem unvollendeten Wisch hängen bleibt */}
        <MatchCard
          key={current.id}
          data={current}
          onSwipe={handleSwipe}
          isTop
        />
        {hintVisible && <SwipeHintOverlay onDismiss={dismissHint} t={t} />}
      </div>

      {error && (
        <div className="shrink-0 text-xs text-red-700 bg-red-50 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Bottom-Buttons + Hint-Text entfernt: die Tap-Targets links/rechts auf
          der Card (rote/grüne Pfeile) übernehmen die Funktion, der Card-Stack
          mit Peek-of-Next/Prev macht das Vertikal-Wischen selbsterklärend. */}

      {toast && (
        <Toast
          listingId={toast.listingId}
          onUndo={undoLast}
          onDismiss={() => setToast(null)}
          t={t}
        />
      )}
    </div>
  );
}

function SwipeHintOverlay({ onDismiss, t }: { onDismiss: () => void; t: T }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="absolute inset-0 z-10 rounded-2xl bg-black/65 backdrop-blur-sm text-white p-6 flex flex-col items-center justify-center gap-4 text-center"
      aria-label={t("matchBrowse.hintAriaClose")}
    >
      <Hand className="size-10" />
      <div className="space-y-3 text-sm max-w-xs">
        <div className="flex items-center gap-3 justify-center">
          <span className="text-2xl">→</span>
          <span>
            {t("matchBrowse.hintRight")}<strong>{t("matchBrowse.hintInterest")}</strong>
          </span>
        </div>
        <div className="flex items-center gap-3 justify-center">
          <span className="text-2xl">←</span>
          <span>{t("matchBrowse.hintLeft")}</span>
        </div>
        <div className="flex items-center gap-3 justify-center">
          <ChevronUp className="size-5" />
          <ChevronDown className="size-5" />
          <span>{t("matchBrowse.hintUpDown")}</span>
        </div>
        <div className="text-xs opacity-80 pt-2">{t("matchBrowse.hintTapClose")}</div>
      </div>
    </button>
  );
}

function Toast({
  listingId,
  onUndo,
  onDismiss,
  t,
}: {
  listingId: string;
  onUndo: () => void;
  onDismiss: () => void;
  t: T;
}) {
  const isDesktop = useIsDesktop();
  return (
    <div className="fixed top-4 right-4 z-50 max-w-xs rounded-xl shadow-lg bg-emerald-700 text-white p-3 flex items-start gap-2 animate-in fade-in slide-in-from-top-4">
      <Check className="size-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-medium">{t("matchBrowse.toast.added")}</div>
        <div className="text-xs opacity-90 flex items-center gap-2 mt-0.5">
          <Link
            href="/dashboard/bookmarks"
            className="underline hover:no-underline"
          >
            {t("matchBrowse.toast.favsLink")}
          </Link>
          <span>·</span>
          <Link
            href={`/listings/${listingId}`}
            {...(isDesktop ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="underline hover:no-underline"
          >
            {t("matchBrowse.toast.listing")}
          </Link>
          <span>·</span>
          <button
            type="button"
            onClick={onUndo}
            className="underline hover:no-underline"
          >
            {t("matchBrowse.toast.undo")}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("matchBrowse.toast.close")}
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
  const { t } = useT();
  return (
    <div className="rounded-2xl border p-8 text-center space-y-4">
      <div className="mx-auto size-12 rounded-full bg-emerald-100 flex items-center justify-center">
        <Sparkles className="size-6 text-emerald-700" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{t("matchBrowse.finished")}</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          {t("matchBrowse.finishedSub")}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Button asChild>
          <Link href="/dashboard">{t("matchBrowse.toDashboard")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/chat">
            <MessageCircle className="size-4" /> {t("matches.cta")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
