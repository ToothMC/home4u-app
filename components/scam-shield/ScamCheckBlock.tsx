/**
 * Read-only Sophie-Check-Block für Listing-Detail-Seiten.
 *
 * Spiegelt die Result-Card aus /scam-check (ohne Form/Modal/Funnel-CTA),
 * damit jedes Inserat im Index transparent zeigt: Score, Flags, Erklärung.
 *
 * Spec-§6.4-Ehrlichkeit: Risiko-Indikator, kein Urteil. Bei warn/high
 * wird das deutlich kommuniziert; bei clean ist die Botschaft "unauffällig",
 * NICHT "garantiert sicher".
 *
 * Wenn das Listing noch nie gescort wurde (scam_checked_at IS NULL UND
 * Score=0 ohne Flags), zeigen wir einen neutralen "noch nicht geprüft"-
 * Block — nicht falsches Grün.
 */
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { ScoreLight, verdictFromScore } from "./ScoreLight";

const FLAG_LABELS: Record<string, string> = {
  price_anomaly_low: "Preis ungewöhnlich niedrig",
  price_implausible: "Preis unplausibel",
  no_phone: "Keine Telefonnummer",
  known_scam_phone: "Bekannte Scam-Nummer",
  duplicate_images: "Bilder mehrfach verwendet",
  text_scam_markers: "Verdächtige Formulierungen",
  low_evidence: "Wenig Vergleichsdaten",
};

type Props = {
  scamScore: number | null | undefined;
  scamFlags?: string[] | null;
  scamCheckedAt?: string | Date | null;
};

function isActuallyChecked(score: number | null | undefined, flags?: string[] | null): boolean {
  if (score == null) return false;
  if (score > 0) return true;
  return Array.isArray(flags) && flags.length > 0;
}

export function ScamCheckBlock({ scamScore, scamFlags, scamCheckedAt }: Props) {
  const checked = isActuallyChecked(scamScore, scamFlags);

  if (!checked) {
    return (
      <Card className="border-[var(--border)]">
        <CardContent className="p-5 space-y-2">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <span className="text-xl">🤖</span>
            Sophies Scam-Check
          </h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            Dieses Inserat wurde noch nicht von Sophie geprüft. Sobald der Score-Worker das
            nächste Mal läuft, erscheint hier die Bewertung.
          </p>
        </CardContent>
      </Card>
    );
  }

  const score = Number(scamScore ?? 0);
  const verdict = verdictFromScore(score);
  const flags = Array.isArray(scamFlags) ? scamFlags : [];
  const cardColor =
    verdict === "high"
      ? "border-red-300 bg-red-50/40"
      : verdict === "warn"
      ? "border-orange-300 bg-orange-50/40"
      : "border-emerald-300 bg-emerald-50/40";

  return (
    <Card className={cn("border-2", cardColor)}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <span className="text-xl">🤖</span>
            Sophies Scam-Check
          </h3>
          {scamCheckedAt && (
            <span className="text-[11px] text-[var(--muted-foreground)] mt-1">
              geprüft {new Date(scamCheckedAt).toLocaleDateString("de-DE")}
            </span>
          )}
        </div>

        <ScoreLight verdict={verdict} score={score} size="md" />

        {flags.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {flags.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <span className="opacity-60 mt-0.5">•</span>
                <span>{FLAG_LABELS[f] ?? f}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-emerald-800">
            Sophie hat keine Auffälligkeiten gefunden.
          </p>
        )}

        <p className="text-xs text-[var(--muted-foreground)] pt-2 border-t border-current/10">
          Sophie prüft jedes Inserat auf sechs Scam-Indikatoren — Preis-Anomalien,
          bekannte Scam-Nummern, doppelt verwendete Bilder, verdächtige Formulierungen.{" "}
          <a href="/datenschutz#scam-shield" className="underline">Mehr über die Prüfung</a>
        </p>
      </CardContent>
    </Card>
  );
}
