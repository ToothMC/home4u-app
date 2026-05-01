"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { emitMatchesUpdated } from "@/lib/events/match-events";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/dict";

const NON_INQUIRABLE_KEYS: Record<string, { key: TKey; cls: string }> = {
  reserved: {
    key: "status.reserved",
    cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40",
  },
  rented: {
    key: "status.rented",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] border border-[var(--destructive)]/30 font-semibold",
  },
  sold: {
    key: "status.sold",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] border border-[var(--destructive)]/30 font-semibold",
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

export function RequestVisitButton({
  listingId,
  full,
  listingStatus,
}: {
  listingId: string;
  full?: boolean;
  listingStatus?: string;
}) {
  const router = useRouter();
  const { t } = useT();
  const [state, setState] = React.useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [matchId, setMatchId] = React.useState<string | null>(null);

  async function go() {
    setState("submitting");
    setError(null);
    try {
      const res = await fetch("/api/matches/like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listing_id: listingId }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const reason = detail.detail ?? detail.error ?? `Error ${res.status}`;
        if (reason === "no_active_profile") {
          setError(t("request.error.noProfile"));
        } else {
          setError(reason);
        }
        setState("error");
        return;
      }
      const json = await res.json();
      setMatchId(json.match_id);
      setState("done");
      emitMatchesUpdated();
      setTimeout(() => router.push(`/matches/${json.match_id}`), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
      setState("error");
    }
  }

  if (state === "done" && matchId) {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 flex items-center gap-2">
        <Check className="size-4" /> {t("request.sentRedirecting")}
      </div>
    );
  }

  if (listingStatus && NON_INQUIRABLE_KEYS[listingStatus]) {
    const s = NON_INQUIRABLE_KEYS[listingStatus];
    return (
      <button
        type="button"
        disabled
        className={
          "flex items-center justify-center gap-2 rounded-full uppercase tracking-wider text-sm cursor-not-allowed " +
          (full ? "w-full h-12" : "h-11 px-5") +
          " " +
          s.cls
        }
      >
        {t(s.key)}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={go}
        disabled={state === "submitting"}
        className={
          "flex items-center justify-center gap-2 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white font-medium " +
          (full ? "w-full h-12" : "h-11 px-5")
        }
      >
        {state === "submitting" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ArrowRight className="size-4" />
        )}
        {t("btn.requestVisit")}
      </button>
      {error && (
        <p className="text-xs text-red-700 px-1">{error}</p>
      )}
      {state !== "submitting" && state !== "error" && (
        <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1 justify-center">
          <Check className="size-3 text-emerald-700" />
          {t("request.fastFree")}
        </p>
      )}
    </div>
  );
}
