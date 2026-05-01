"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Send, Hourglass, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MatchStatus } from "@/lib/repo/bookmarks";
import { emitMatchesUpdated } from "@/lib/events/match-events";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/dict";

const NON_INQUIRABLE: Record<string, { key: TKey; cls: string }> = {
  reserved: {
    key: "status.reserved",
    cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40",
  },
  rented: {
    key: "status.rented",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] border-[var(--destructive)]/30 font-semibold",
  },
  sold: {
    key: "status.sold",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] border-[var(--destructive)]/30 font-semibold",
  },
  opted_out: {
    key: "status.notAvailable",
    cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  },
  archived: {
    key: "status.archived",
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
  const { t } = useT();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (matchStatus === "connected" && matchId) {
    return (
      <Button asChild size="sm" variant="outline" className="w-full">
        <Link href={`/matches/${matchId}`}>
          <Handshake className="size-3.5" /> {t("inquire.connected")}
        </Link>
      </Button>
    );
  }
  if (matchStatus === "pending") {
    return (
      <Button size="sm" variant="outline" className="w-full" disabled>
        <Hourglass className="size-3.5" /> {t("inquire.waiting")}
      </Button>
    );
  }
  if (matchStatus === "rejected") {
    return (
      <Button size="sm" variant="ghost" className="w-full text-[var(--muted-foreground)]" disabled>
        {t("inquire.rejected")}
      </Button>
    );
  }

  if (listingStatus && NON_INQUIRABLE[listingStatus]) {
    const s = NON_INQUIRABLE[listingStatus];
    return (
      <Button
        size="sm"
        variant="outline"
        className={`w-full uppercase tracking-wider text-[11px] ${s.cls}`}
        disabled
      >
        {t(s.key)}
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
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        setSubmitting(false);
        return;
      }
      emitMatchesUpdated();
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
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
        {t("inquire.cta")}
      </Button>
      {error && <p className="text-[10px] text-[var(--destructive)]">{error}</p>}
    </div>
  );
}
