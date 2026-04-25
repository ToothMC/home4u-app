import { Check, Minus } from "lucide-react";
import type { HonestAssessment } from "./types";

export function HonestAssessmentBlock({
  assessment,
}: {
  assessment: HonestAssessment | null;
}) {
  if (!assessment || (assessment.pros.length === 0 && assessment.cons.length === 0)) {
    return null;
  }
  return (
    <section className="rounded-2xl border bg-[var(--card)] p-4">
      <h3 className="text-sm font-semibold mb-3">Ehrlich gesagt</h3>
      <ul className="space-y-3">
        {assessment.pros.map((p, i) => (
          <li key={`pro-${i}`} className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 size-5 rounded-full bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
              <Check className="size-3" />
            </span>
            <div>
              <div className="text-sm font-medium">{p.title}</div>
              <div className="text-xs text-[var(--muted-foreground)]">{p.reason}</div>
            </div>
          </li>
        ))}
        {assessment.cons.map((c, i) => (
          <li key={`con-${i}`} className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 size-5 rounded-full bg-amber-500/15 text-amber-700 flex items-center justify-center">
              <Minus className="size-3" />
            </span>
            <div>
              <div className="text-sm font-medium">{c.title}</div>
              <div className="text-xs text-[var(--muted-foreground)]">{c.reason}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
