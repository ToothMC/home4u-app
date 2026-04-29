"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { emitMatchesUpdated } from "@/lib/events/match-events";

export function RequestVisitButton({
  listingId,
  full,
}: {
  listingId: string;
  full?: boolean;
}) {
  const router = useRouter();
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
        const reason = detail.detail ?? detail.error ?? `Fehler ${res.status}`;
        if (reason === "no_active_profile") {
          setError(
            "Bitte erstelle erst eine Suche bei Sophie — dann kannst du anfragen."
          );
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
      setError(err instanceof Error ? err.message : "Netzwerkfehler");
      setState("error");
    }
  }

  if (state === "done" && matchId) {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 flex items-center gap-2">
        <Check className="size-4" /> Anfrage raus — wir leiten dich weiter…
      </div>
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
        Besichtigung anfragen
      </button>
      {error && (
        <p className="text-xs text-red-700 px-1">{error}</p>
      )}
      {state !== "submitting" && state !== "error" && (
        <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1 justify-center">
          <Check className="size-3 text-emerald-700" />
          Schnell, unverbindlich & kostenlos
        </p>
      )}
    </div>
  );
}
