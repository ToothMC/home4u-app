"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export function RespondMatchButtons({ matchId }: { matchId: string }) {
  const router = useRouter();
  const { t } = useT();
  const [busy, setBusy] = React.useState<"accept" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function respond(accept: boolean) {
    setBusy(accept ? "accept" : "reject");
    setError(null);
    try {
      const res = await fetch("/api/matches/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ match_id: matchId, accept }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        setBusy(null);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          size="lg"
          onClick={() => respond(false)}
          disabled={busy !== null}
          className="h-14 rounded-full border-2"
        >
          {busy === "reject" ? <Loader2 className="size-5 animate-spin" /> : <X className="size-5" />}
          {t("ownerInbox.reject")}
        </Button>
        <Button
          size="lg"
          onClick={() => respond(true)}
          disabled={busy !== null}
          className="h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {busy === "accept" ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          {t("ownerInbox.accept")}
        </Button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
