"use client";

import { TrendingUp, TrendingDown, CheckCircle2, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Position =
  | "very_good"
  | "good"
  | "fair"
  | "above"
  | "expensive"
  | "unknown"
  | null;

export function MarketHint({
  position,
  pricePerSqm,
  median,
  p25,
  p75,
  compsetSize,
}: {
  position: Position;
  pricePerSqm: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  compsetSize: number;
}) {
  if (!position || position === "unknown" || pricePerSqm == null || median == null) {
    return (
      <div className="rounded-md border border-dashed bg-[var(--accent)]/40 p-3 text-xs text-[var(--muted-foreground)] flex items-start gap-2">
        <MinusCircle className="size-3 mt-0.5 shrink-0" />
        <span>
          Noch zu wenig vergleichbare Inserate für eine Preis-Einschätzung
          ({compsetSize} im Datensatz). Wir aktualisieren das automatisch.
        </span>
      </div>
    );
  }

  const deltaPct = Math.round(((pricePerSqm - median) / median) * 100);
  const isGood = position === "very_good" || position === "good";
  const isFair = position === "fair";
  const isHigh = position === "above" || position === "expensive";

  const tone = isGood ? "emerald" : isFair ? "blue" : "amber";
  const Icon = isGood ? CheckCircle2 : isHigh ? TrendingUp : TrendingDown;

  const fmt = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €/m²`;

  const message = (() => {
    if (position === "very_good") return "Sehr günstig — top für Suchende, schnelle Anfragen wahrscheinlich.";
    if (position === "good") return "Günstig — wird viele Anfragen bekommen.";
    if (position === "fair") return "Fairer Preis — entspricht dem lokalen Markt.";
    if (position === "above") return `Etwas über Markt — überlege ob ${fmt(p75 ?? median)} oder weniger realistischer ist.`;
    return `Deutlich über Markt — bekommt voraussichtlich wenig Anfragen. Median liegt bei ${fmt(median)}.`;
  })();

  return (
    <div
      className={cn(
        "rounded-md border p-3 text-xs flex items-start gap-2",
        tone === "emerald" && "bg-emerald-50 border-emerald-200 text-emerald-900",
        tone === "blue" && "bg-blue-50 border-blue-200 text-blue-900",
        tone === "amber" && "bg-amber-50 border-amber-200 text-amber-900"
      )}
    >
      <Icon className="size-4 mt-0.5 shrink-0" />
      <div className="space-y-1 min-w-0">
        <div>
          Dein Preis: <strong>{fmt(pricePerSqm)}</strong>
          {" · "}Markt-Median: <strong>{fmt(median)}</strong>
          {" · "}
          {deltaPct > 0 ? `+${deltaPct}` : deltaPct} %
        </div>
        <div className="opacity-90">{message}</div>
        <div className="text-[10px] opacity-75">
          Vergleich: {compsetSize} aktive Inserate
          {p25 != null && p75 != null
            ? ` · Markt-Spanne ${fmt(p25)} – ${fmt(p75)}`
            : ""}
        </div>
      </div>
    </div>
  );
}
