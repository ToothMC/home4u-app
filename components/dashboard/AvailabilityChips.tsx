"use client";

import { useState } from "react";
import { Check, Loader2, PhoneOff, Ban } from "lucide-react";
import { useT } from "@/lib/i18n/client";

type Kind = "responded" | "rented" | "no_answer";

/**
 * Drei Mini-Chips unter einer Anfrage: Seeker meldet zurück was passiert ist.
 *
 *   ✅ Antwort bekommen     → touch last_checked_at, kein Status-Wechsel
 *   🚫 Schon vermietet/weg  → 1 Klick = stale, 2+ verschiedene Seeker = rented/sold
 *   📵 Niemand erreichbar   → soft signal, 5+ Klicks = stale
 *
 * Speichert lokal welche Kinds für diesen Match schon gesendet wurden, damit
 * Doppelklicks nicht spamfeuern. Beim Server gewinnt eh die Vertrauenslogik
 * von apply_listing_report (Distinct Reporter).
 */
export function AvailabilityChips({
  matchId,
  listingId,
}: {
  matchId: string;
  listingId: string;
}) {
  const { t } = useT();
  const [sent, setSent] = useState<Set<Kind>>(new Set());
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function report(kind: Kind, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (sent.has(kind) || busy) return;
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, listing_id: listingId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
      } else {
        setSent((s) => new Set(s).add(kind));
      }
    } catch {
      setError(t("btn.networkError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      <Chip
        kind="responded"
        label={t("availability.gotReply")}
        thanks={t("availability.thanks")}
        Icon={Check}
        sent={sent.has("responded")}
        busy={busy === "responded"}
        onClick={(e) => report("responded", e)}
      />
      <Chip
        kind="rented"
        label={t("availability.alreadyGone")}
        thanks={t("availability.thanks")}
        Icon={Ban}
        sent={sent.has("rented")}
        busy={busy === "rented"}
        onClick={(e) => report("rented", e)}
        intent="negative"
      />
      <Chip
        kind="no_answer"
        label={t("availability.nobody")}
        thanks={t("availability.thanks")}
        Icon={PhoneOff}
        sent={sent.has("no_answer")}
        busy={busy === "no_answer"}
        onClick={(e) => report("no_answer", e)}
      />
      {error && <span className="text-[10px] text-[var(--destructive)]">{error}</span>}
    </div>
  );
}

function Chip({
  label,
  thanks,
  Icon,
  sent,
  busy,
  onClick,
  intent,
}: {
  kind: Kind;
  label: string;
  thanks: string;
  Icon: typeof Check;
  sent: boolean;
  busy: boolean;
  onClick: (e: React.MouseEvent) => void;
  intent?: "negative";
}) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors";
  const idle =
    intent === "negative"
      ? "border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] hover:border-[var(--destructive)]"
      : "border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]";
  const sentCls =
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 cursor-default";
  const cls = `${base} ${sent ? sentCls : idle}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sent || busy}
      className={cls}
      title={sent ? thanks : label}
    >
      {busy ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Icon className="size-3" />
      )}
      {label}
    </button>
  );
}
