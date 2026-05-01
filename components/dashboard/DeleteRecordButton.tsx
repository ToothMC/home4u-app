"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { tFormat } from "@/lib/i18n/dict";

type Props = {
  endpoint: string;
  redirectTo: string;
  what: string;
};

export function DeleteRecordButton({ endpoint, redirectTo, what }: Props) {
  const router = useRouter();
  const { t } = useT();
  const [state, setState] = React.useState<"idle" | "confirm" | "submitting">("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function doDelete() {
    setState("submitting");
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        setState("confirm");
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
      setState("confirm");
    }
  }

  if (state === "confirm" || state === "submitting") {
    return (
      <div className="rounded-md border border-red-200 bg-red-50/70 p-3 space-y-2">
        <p className="text-sm">
          {tFormat(t("delete.confirmIrrev"), { what })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setState("idle")}
            disabled={state === "submitting"}
          >
            {t("delete.dismiss")}
          </Button>
          <Button
            size="sm"
            onClick={doDelete}
            disabled={state === "submitting"}
            className="bg-red-600 hover:bg-red-700"
          >
            {state === "submitting" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            {t("delete.confirmYes")}
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
      className="text-red-700 hover:bg-red-50 hover:text-red-800 border-red-300"
    >
      <Trash2 className="size-4" /> {t("delete.cta")}
    </Button>
  );
}
