/**
 * Sophie-Check-Anzeige in drei Größen-Varianten.
 *
 *   <ScoreLight size="lg" verdict="warn" score={0.55} />   — Detail-Page
 *   <ScoreLight size="md" verdict="clean" score={0.10} /> — Result-Card auf /scam-check
 *   <ScamCheckBadge score={0.10} flags={[]} />            — Listing-Karte (separater Component)
 *
 * Wording-Convention (Spec §6.4 Ehrlichkeits-Klausel):
 *   • Score = Risiko-Indikator, nie Urteil
 *   • clean = "Sophie-Check: unauffällig"
 *   • warn  = "Sophie-Check: prüfen"
 *   • high  = "Sophie-Check: hoher Verdacht"
 *
 * Edge-Case: scam_checked_at IS NULL → noch nicht geprüft
 *   (Aktuell sind alle 559 indexierten Listings via SQL-Bootstrap geprüft;
 *   relevant für künftig neu-gecrawlte vor dem nächsten Worker-Lauf.)
 */
"use client";

import { cn } from "@/lib/utils";

export type Verdict3 = "clean" | "warn" | "high";

export type ScoreLightSize = "lg" | "md" | "sm";

export function verdictFromScore(score: number | null | undefined): Verdict3 {
  if (score == null) return "clean";
  if (score >= 0.7) return "high";
  if (score >= 0.5) return "warn";
  return "clean";
}

const STAGES: Array<{
  key: Verdict3;
  label: string;
  activeColor: string;
  activeRing: string;
}> = [
  {
    key: "clean",
    label: "Kein Scam",
    activeColor: "bg-emerald-500",
    activeRing: "ring-emerald-200",
  },
  {
    key: "warn",
    label: "Nicht sicher",
    activeColor: "bg-orange-500",
    activeRing: "ring-orange-200",
  },
  {
    key: "high",
    label: "Hoher Verdacht",
    activeColor: "bg-red-500",
    activeRing: "ring-red-200",
  },
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
}: {
  verdict: Verdict3;
  score: number;
  size?: ScoreLightSize;
  showScoreLine?: boolean;
}) {
  const sz = SIZES[size];

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
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
      {showScoreLine && (
        <p className="text-center text-xs opacity-60">
          Score: {score.toFixed(2)} / 1.00 — Risiko-Indikator, kein Urteil.
        </p>
      )}
    </div>
  );
}
