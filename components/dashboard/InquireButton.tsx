"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Send, Hourglass, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MatchStatus } from "@/lib/repo/bookmarks";
import { emitMatchesUpdated } from "@/lib/events/match-events";

/**
 * Pipeline-Aktion auf einer BookmarkCard.
 * - matchStatus="none" + searchProfileId vorhanden → "Anfragen" (Primary)
 * - matchStatus="none" + kein searchProfileId       → Hinweis (alt-bookmarked)
 * - matchStatus="pending"                            → "Wartet auf Anbieter"
 * - matchStatus="connected"                          → Link "Verbunden →"
 * - matchStatus="rejected"                           → "Abgelehnt"
 */
export function InquireButton({
  bookmarkId,
  matchStatus,
  matchId,
  hasSearchProfile,
}: {
  bookmarkId: string;
  matchStatus: MatchStatus;
  matchId: string | null;
  hasSearchProfile: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (matchStatus === "connected" && matchId) {
    return (
      <Button asChild size="sm" variant="outline" className="w-full">
        <Link href={`/matches/${matchId}`}>
          <Handshake className="size-3.5" /> Verbunden
        </Link>
      </Button>
    );
  }
  if (matchStatus === "pending") {
    return (
      <Button size="sm" variant="outline" className="w-full" disabled>
        <Hourglass className="size-3.5" /> Wartet auf Anbieter
      </Button>
    );
  }
  if (matchStatus === "rejected") {
    return (
      <Button size="sm" variant="ghost" className="w-full text-[var(--muted-foreground)]" disabled>
        Abgelehnt
      </Button>
    );
  }

  // matchStatus === "none"
  if (!hasSearchProfile) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled
        title="Dieser Favorit wurde ohne Bezug zu einer Suche gespeichert. Speichere das Inserat erneut aus einer Suche, um anfragen zu können."
      >
        Bitte aus Suche speichern
      </Button>
    );
  }

  async function inquire(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookmarks/${bookmarkId}/inquire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `Fehler ${res.status}`);
        setSubmitting(false);
        return;
      }
      // Erfolg: Page neu laden (Server-Component) + Client-Event für die
      // Anfragen-Liste, damit MatchSections sofort re-fetched (sonst sieht
      // der User die Anfrage erst nach manuellem Refresh).
      emitMatchesUpdated();
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Netzwerkfehler");
      setSubmitting(false);
    }
  }

  const busy = submitting || isPending;
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        className="w-full"
        onClick={inquire}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
        Anfragen
      </Button>
      {error && <p className="text-[10px] text-[var(--destructive)]">{error}</p>}
    </div>
  );
}
