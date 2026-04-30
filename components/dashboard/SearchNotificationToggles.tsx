"use client";

import * as React from "react";
import { Loader2, Bell, BellOff } from "lucide-react";

export type SearchNotificationItem = {
  id: string;
  location: string;
  type: "rent" | "sale";
  rooms: number | null;
  budget_max: number | null;
  notify_new_matches: boolean;
};

export function SearchNotificationToggles({
  initial,
}: {
  initial: SearchNotificationItem[];
}) {
  const [items, setItems] = React.useState(initial);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [errorId, setErrorId] = React.useState<string | null>(null);

  async function toggle(id: string, next: boolean) {
    const prev = items;
    setItems((p) => p.map((it) => (it.id === id ? { ...it, notify_new_matches: next } : it)));
    setBusyId(id);
    setErrorId(null);
    try {
      const res = await fetch(`/api/searches/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notify_new_matches: next }),
      });
      if (!res.ok) {
        setItems(prev);
        setErrorId(id);
      }
    } catch {
      setItems(prev);
      setErrorId(id);
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Du hast aktuell keine aktive Suche. Sobald Du im Chat eine Suche
        startest, kannst Du hier den E-Mail-Versand pro Suche steuern.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const label = [
          it.type === "rent" ? "Miete" : "Kauf",
          it.location,
          it.rooms != null ? `${it.rooms} Zi.` : null,
          it.budget_max ? `≤ ${formatPrice(it.budget_max)} €` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const isOn = it.notify_new_matches;
        const busy = busyId === it.id;
        return (
          <li
            key={it.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{label}</div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
                {isOn
                  ? "Tägliche E-Mail bei neuen Treffern aktiv"
                  : "Keine E-Mail-Benachrichtigung"}
              </div>
              {errorId === it.id && (
                <div className="text-xs text-rose-700 mt-1">
                  Konnte nicht speichern — versuch es nochmal.
                </div>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isOn}
              aria-label={isOn ? "Benachrichtigungen aus" : "Benachrichtigungen an"}
              disabled={busy}
              onClick={() => toggle(it.id, !isOn)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                isOn ? "bg-[var(--brand-navy)]" : "bg-neutral-300"
              } ${busy ? "opacity-60" : ""}`}
            >
              <span
                className={`absolute left-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${
                  isOn ? "translate-x-5" : "translate-x-0"
                }`}
              >
                {busy ? (
                  <Loader2 className="size-3 animate-spin text-neutral-500" />
                ) : isOn ? (
                  <Bell className="size-3 text-[var(--brand-navy)]" />
                ) : (
                  <BellOff className="size-3 text-neutral-500" />
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(n);
}
