"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

type State = "idle" | "confirm" | "submitting" | "error";

export function WithdrawRequestButton({ matchId }: { matchId: string }) {
  const router = useRouter();
  const { t } = useT();
  const [state, setState] = React.useState<State>("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function withdraw() {
    setState("submitting");
    setError(null);
    try {
      const res = await fetch("/api/matches/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ match_id: matchId }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        setState("error");
        return;
      }
      router.replace("/dashboard?view=seeker");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
      setState("error");
    }
  }

  if (state === "confirm" || state === "submitting") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 space-y-2">
        <p className="text-sm">{t("withdraw.confirmText")}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setState("idle")}
            disabled={state === "submitting"}
          >
            {t("withdraw.dismiss")}
          </Button>
          <Button
            size="sm"
            onClick={withdraw}
            disabled={state === "submitting"}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {state === "submitting" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            {t("withdraw.confirmYes")}
          </Button>
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={() => setState("confirm")}
      className="text-amber-700 hover:bg-amber-50 hover:text-amber-800 border-amber-300"
    >
      <Trash2 className="size-4" /> {t("withdraw.outerCta")}
    </Button>
  );
}
