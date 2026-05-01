/**
 * Sophie-Check-Anzeige in drei Größen-Varianten.
 *
 *   <ScoreLight size="lg" verdict="warn" score={0.55} labels={...} />   — Detail-Page
 *   <ScoreLight size="md" verdict="clean" score={0.10} labels={...} /> — Result-Card auf /scam-check
 *
 * Wording-Convention (Spec §6.4 Ehrlichkeits-Klausel):
 *   • Score = Risiko-Indikator, nie Urteil
 *   • clean = "Sophie-Check: unauffällig"
 *   • warn  = "Sophie-Check: prüfen"
 *   • high  = "Sophie-Check: hoher Verdacht"
 *
 * KEIN "use client" — pure Render-Logik. Wird sowohl aus Server Components
 * (ScamCheckBlock) als auch aus Client Components (ScamCheckClient) genutzt.
 * Daher kommt die Übersetzung als optionale `labels`-Prop rein, statt direkt
 * an `t()` zu hängen.
 */

import { cn } from "@/lib/utils";

export type Verdict3 = "clean" | "warn" | "high";

export type ScoreLightSize = "lg" | "md" | "sm";

export type ScoreLightLabels = {
  clean: string;
  warn: string;
  high: string;
  /** Template mit {score} */
  scoreLine: string;
};

const DEFAULT_LABELS: ScoreLightLabels = {
  clean: "Kein Scam",
  warn: "Nicht sicher",
  high: "Hoher Verdacht",
  scoreLine: "Score: {score} / 1.00 — Risiko-Indikator, kein Urteil.",
};

export function verdictFromScore(score: number | null | undefined): Verdict3 {
  if (score == null) return "clean";
  if (score >= 0.7) return "high";
  if (score >= 0.5) return "warn";
  return "clean";
}

const STAGES: Array<{
  key: Verdict3;
  activeColor: string;
  activeRing: string;
}> = [
  { key: "clean", activeColor: "bg-emerald-500", activeRing: "ring-emerald-200" },
  { key: "warn", activeColor: "bg-orange-500", activeRing: "ring-orange-200" },
  { key: "high", activeColor: "bg-red-500", activeRing: "ring-red-200" },
];

const SIZES = {
  lg: { circle: "w-14 h-14", ring: "ring-8", label: "text-xs", gap: "gap-1.5" },
  md: { circle: "w-10 h-10", ring: "ring-4", label: "text-[11px]", gap: "gap-1" },
  sm: { circle: "w-6 h-6", ring: "ring-2", label: "text-[10px]", gap: "gap-0.5" },
} as const;

export function ScoreLight({
  verdict,
  score,
  size = "lg",
  showScoreLine = true,
  labels,
}: {
  verdict: Verdict3;
  score: number;
  size?: ScoreLightSize;
  showScoreLine?: boolean;
  labels?: ScoreLightLabels;
}) {
  const sz = SIZES[size];
  const L = labels ?? DEFAULT_LABELS;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-around gap-2">
        {STAGES.map((stage) => {
          const isActive = stage.key === verdict;
          return (
            <div
              key={stage.key}
              className={cn("flex flex-col items-center flex-1 min-w-0", sz.gap)}
            >
              <div
                className={cn(
                  "rounded-full transition-all",
                  sz.circle,
                  isActive
                    ? cn(stage.activeColor, sz.ring, stage.activeRing, "shadow-md")
                    : "bg-black/10",
                )}
              />
              <span
                className={cn(
                  "font-semibold text-center",
                  sz.label,
                  isActive ? "opacity-100" : "opacity-40",
                )}
              >
                {L[stage.key]}
              </span>
            </div>
          );
        })}
      </div>
      {showScoreLine && (
        <p className="text-center text-xs opacity-60">
          {L.scoreLine.replace("{score}", score.toFixed(2))}
        </p>
      )}
    </div>
  );
}
