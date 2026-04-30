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
 * - matchStatus="none"      → "Anfragen" (Primary, immer aktiv)
 * - matchStatus="pending"   → "Wartet auf Anbieter"
 * - matchStatus="connected" → Link "Verbunden →"
 * - matchStatus="rejected"  → "Abgelehnt"
 *
 * Seit Migration 20260430110000 ist search_profile_id auf matches optional —
 * orphan-Bookmarks (ohne Profil-Anker) sind voll anfragbar.
 */
// Status-Werte, bei denen keine neuen Anfragen mehr Sinn machen — Inserat ist
// entweder weg oder pausiert. "stale" bleibt anfragbar, weil eine Anfrage genau
// der Trigger ist, mit dem der Provider die Verfügbarkeit klärt.
// Farb-Kodierung deckt sich mit ListingStatusBadge, damit der User den Status
// im Button auf einen Blick wiedererkennt.
const NON_INQUIRABLE: Record<string, { label: string; cls: string }> = {
  reserved: {
    label: "Reserviert",
    cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40",
  },
  rented: {
    label: "Vermietet",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] border-[var(--destructive)]/30 font-semibold",
  },
  sold: {
    label: "Verkauft",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] border-[var(--destructive)]/30 font-semibold",
  },
  opted_out: {
    label: "Nicht verfügbar",
    cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  },
  archived: {
    label: "Archiviert",
    cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  },
};

export function InquireButton({
  bookmarkId,
  matchStatus,
  matchId,
  listingStatus,
}: {
  bookmarkId: string;
  matchStatus: MatchStatus;
  matchId: string | null;
  listingStatus?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verbundene Anfrage darf der User immer sehen — der Status-Block kommt
  // erst danach. Sonst verliert man den Match-Link, sobald das Inserat
  // reserviert/vermietet ist.
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

  // Inserat-Status sticht über Match-Status, sobald Anfrage erstmal nicht
  // mehr sinnvoll ist (reserviert/vermietet/verkauft/deaktiviert/archiviert).
  if (listingStatus && NON_INQUIRABLE[listingStatus]) {
    const s = NON_INQUIRABLE[listingStatus];
    return (
      <Button
        size="sm"
        variant="outline"
        className={`w-full uppercase tracking-wider text-[11px] ${s.cls}`}
        disabled
      >
        {s.label}
      </Button>
    );
  }

  // matchStatus === "none" → "Anfragen" (immer aktiv, profil-unabhängig)

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
