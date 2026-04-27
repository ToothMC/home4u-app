/**
 * Read-only Sophie-Check-Block für Listing-Detail-Seiten — DEZENT-Variante.
 *
 * User-Feedback (zwei Iterationen):
 * 1. "ohne die Roboter-Fresse, ganz klein und dezent" → Emoji raus, klein
 * 2. "Scam-Check sollte schon dastehen" → 'Sophie-Check'-Label mit dabei
 * 3. "und die ampel" → Ampel ist mit drin, klein (size sm)
 *
 * Spec-§6.4-Ehrlichkeit (Risiko-Indikator, kein Urteil) bleibt erhalten —
 * der Disclaimer-Link ist nur einen Klick weg, nicht vom Bildschirm
 * verschwunden.
 */
import { Card, CardContent } from "@/components/ui/card";

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
  const flags = Array.isArray(scamFlags) ? scamFlags : [];

  const dateStr = scamCheckedAt
    ? new Date(scamCheckedAt).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      })
    : null;

  if (!checked) {
    return (
      <Card className="border-[var(--border)]">
        <CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-semibold">Sophies Scam-Check</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Dieses Inserat wurde noch nicht von Sophie geprüft.
          </p>
        </CardContent>
      </Card>
    );
  }

  const score = Number(scamScore ?? 0);
  const verdict = verdictFromScore(score);

  return (
    <Card className="border-[var(--border)]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Sophies Scam-Check</h3>
          {dateStr && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              geprüft {dateStr}
            </span>
          )}
        </div>

        <ScoreLight verdict={verdict} score={score} size="sm" />

        {flags.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)] select-none">
              {flags.length} {flags.length === 1 ? "Hinweis" : "Hinweise"} anzeigen
            </summary>
            <ul className="mt-1.5 ml-1 space-y-0.5 text-[var(--muted-foreground)]">
              {flags.map((f) => (
                <li key={f}>· {FLAG_LABELS[f] ?? f}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] opacity-70">
              <a href="/datenschutz#scam-shield" className="underline">
                Mehr über Sophies Prüfung
              </a>
            </p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
