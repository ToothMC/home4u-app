/**
 * Inline-Badge für Listing-Karten (klein, einzeiler).
 *
 * Variante der ScoreLight: nur der aktive Status, kein Drei-Kreis-Layout.
 *
 *   <ScamCheckBadge score={0.10} flags={["no_phone"]} />
 *   → 🟢 Sophie-Check: unauffällig
 *
 *   <ScamCheckBadge score={null} flags={null} />
 *   → ⚪ Noch nicht geprüft
 *
 * Wording bleibt konsistent zu ScoreLight.tsx (Spec §6.4 Ehrlichkeits-Klausel).
 */
import { cn } from "@/lib/utils";
import { verdictFromScore } from "./ScoreLight";

type BadgeProps = {
  score: number | null | undefined;
  flags?: string[] | null;
  /** Visual-Varianten — "compact" reduziert auf Punkt + Wort. "row" mit Border. */
  variant?: "compact" | "row";
  className?: string;
};

const COLORS = {
  clean: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50/60", border: "border-emerald-200" },
  warn: { dot: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50/60", border: "border-orange-200" },
  high: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50/60", border: "border-red-200" },
  none: { dot: "bg-black/20", text: "text-[var(--muted-foreground)]", bg: "bg-transparent", border: "border-[var(--border)]" },
} as const;

const LABELS = {
  clean: "Sophie-Check: unauffällig",
  warn: "Sophie-Check: prüfen",
  high: "Sophie-Check: hoher Verdacht",
  none: "Noch nicht geprüft",
} as const;

/**
 * Heuristik für "wirklich geprüft": Score > 0 ODER mindestens ein Flag.
 * Default-Zeile (score=0, flags=[]) bedeutet: Worker hat das Listing
 * noch nicht angefasst. Alle bestehenden 559 Listings sind via Bootstrap
 * geprüft, daher ist hier mind. ein Flag (`no_phone` oder ähnlich).
 */
function isActuallyChecked(score: number | null | undefined, flags?: string[] | null): boolean {
  if (score == null) return false;
  if (score > 0) return true;
  return Array.isArray(flags) && flags.length > 0;
}

export function ScamCheckBadge({ score, flags, variant = "compact", className }: BadgeProps) {
  const checked = isActuallyChecked(score, flags);
  const verdict = checked ? verdictFromScore(score) : "none";
  const c = COLORS[verdict];

  if (variant === "compact") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium",
          c.text,
          className,
        )}
      >
        <span className={cn("inline-block w-2 h-2 rounded-full", c.dot)} aria-hidden />
        {LABELS[verdict]}
      </span>
    );
  }

  // variant === "row"
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs font-medium",
        c.text,
        c.bg,
        c.border,
        className,
      )}
    >
      <span className={cn("inline-block w-2 h-2 rounded-full", c.dot)} aria-hidden />
      {LABELS[verdict]}
    </div>
  );
}
