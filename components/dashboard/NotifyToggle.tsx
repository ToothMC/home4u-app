"use client";

import * as React from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

/**
 * Schalter „Benachrichtigung bei neuen Treffern" pro Suchprofil.
 * Optimistic toggle, ruft PATCH /api/searches/[id]. Bei Fehler revertiert
 * der UI-Zustand und ein Mini-Hint erscheint kurz.
 */
export function NotifyToggle({
  searchId,
  initial,
}: {
  searchId: string;
  initial: boolean;
}) {
  const [enabled, setEnabled] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !enabled;
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/searches/${searchId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notify_new_matches: next }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setEnabled(!next);
        setError(detail.detail ?? "Konnte nicht speichern");
        return;
      }
    } catch {
      setEnabled(!next);
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-[var(--card)] p-4">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="flex w-full items-start gap-3 text-left"
        aria-pressed={enabled}
      >
        <div
          className={
            "shrink-0 size-9 rounded-full flex items-center justify-center " +
            (enabled
              ? "bg-emerald-100 text-emerald-700"
              : "bg-[var(--muted)] text-[var(--muted-foreground)]")
          }
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : enabled ? (
            <Bell className="size-4" />
          ) : (
            <BellOff className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {enabled
              ? "Benachrichtigungen aktiv"
              : "Benachrichtigungen aus"}
          </div>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5 leading-snug">
            {enabled
              ? "Du bekommst eine E-Mail, sobald neue Treffer zu dieser Suche reinkommen — maximal einmal pro Tag."
              : "Wir schicken keine E-Mail, auch wenn neue Treffer reinkommen."}
          </p>
          {error && (
            <p className="text-xs text-rose-700 mt-1">{error}</p>
          )}
        </div>
        <div
          className={
            "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors " +
            (enabled ? "bg-emerald-600" : "bg-[var(--muted)]")
          }
        >
          <span
            className={
              "inline-block size-5 rounded-full bg-white shadow transform transition-transform mt-0.5 " +
              (enabled ? "translate-x-5" : "translate-x-0.5")
            }
          />
        </div>
      </button>
    </div>
  );
}
