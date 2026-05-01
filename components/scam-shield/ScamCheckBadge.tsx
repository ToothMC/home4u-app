"use client";

import { cn } from "@/lib/utils";
import { verdictFromScore } from "./ScoreLight";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/dict";

type BadgeProps = {
  score: number | null | undefined;
  flags?: string[] | null;
  variant?: "compact" | "row";
  className?: string;
};

const COLORS = {
  clean: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50/60", border: "border-emerald-200" },
  warn: { dot: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50/60", border: "border-orange-200" },
  high: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50/60", border: "border-red-200" },
  none: { dot: "bg-black/20", text: "text-[var(--muted-foreground)]", bg: "bg-transparent", border: "border-[var(--border)]" },
} as const;

const KEYS: Record<keyof typeof COLORS, TKey> = {
  clean: "scamBadge.clean",
  warn: "scamBadge.warn",
  high: "scamBadge.high",
  none: "scamBadge.none",
};

function isActuallyChecked(score: number | null | undefined, flags?: string[] | null): boolean {
  if (score == null) return false;
  if (score > 0) return true;
  return Array.isArray(flags) && flags.length > 0;
}

export function ScamCheckBadge({ score, flags, variant = "compact", className }: BadgeProps) {
  const { t } = useT();
  const checked = isActuallyChecked(score, flags);
  const verdict = checked ? verdictFromScore(score) : "none";
  const c = COLORS[verdict];
  const label = t(KEYS[verdict]);

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
        {label}
      </span>
    );
  }

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
      {label}
    </div>
  );
}
