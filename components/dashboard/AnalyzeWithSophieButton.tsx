"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export function AnalyzeWithSophieButton({
  listingId,
  hasMedia,
  alreadyAnalyzed,
}: {
  listingId: string;
  hasMedia: boolean;
  alreadyAnalyzed: boolean;
}) {
  const router = useRouter();
  const { t } = useT();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        return;
      }
      setDone(true);
      router.refresh();
      setTimeout(() => setDone(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-rose-50 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="shrink-0 size-9 rounded-full bg-purple-200 flex items-center justify-center">
          <Sparkles className="size-4 text-purple-800" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            {alreadyAnalyzed ? t("analyze.alreadyAnalyzed") : t("analyze.willAnalyze")}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {alreadyAnalyzed ? t("analyze.alreadySub") : t("analyze.willSub")}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-md p-2">
          <AlertCircle className="size-3 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {done && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 rounded-md p-2">
          <Check className="size-3" />
          {t("analyze.done")}
        </div>
      )}

      <Button
        type="button"
        onClick={run}
        disabled={busy || !hasMedia}
        className="w-full bg-purple-700 hover:bg-purple-800 text-white"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> {t("analyze.busy")}
          </>
        ) : (
          <>
            <Sparkles className="size-4" />
            {alreadyAnalyzed ? t("analyze.again") : t("analyze.start")}
          </>
        )}
      </Button>

      {!hasMedia && (
        <div className="text-[11px] text-[var(--muted-foreground)] text-center">
          {t("analyze.noMedia")}
        </div>
      )}
    </div>
  );
}
