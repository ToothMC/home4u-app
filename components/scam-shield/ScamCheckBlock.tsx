/**
 * Read-only Sophie-Check-Block für Listing-Detail-Seiten — DEZENT-Variante.
 *
 * User-Feedback: kein "Roboter-Fresse"-Emoji, klein, unaufdringlich.
 * Default-State zeigt nur eine Zeile (Verdict-Badge + geprüft-Datum).
 * Klick-to-expand für die Flag-Liste + Disclaimer-Link.
 *
 * Spec-§6.4-Ehrlichkeit (Risiko-Indikator, kein Urteil) bleibt erhalten —
 * der Disclaimer-Text ist nur einen Klick weg, nicht vom Bildschirm
 * verschwunden.
 */
import { Card, CardContent } from "@/components/ui/card";

import { ScamCheckBadge } from "./ScamCheckBadge";

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

  // Datum klein formatieren
  const dateStr = scamCheckedAt
    ? new Date(scamCheckedAt).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      })
    : null;

  return (
    <Card className="border-[var(--border)]">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <ScamCheckBadge
            score={checked ? scamScore : null}
            flags={checked ? flags : null}
            variant="compact"
          />
          {dateStr && checked && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              geprüft {dateStr}
            </span>
          )}
        </div>

        {checked && flags.length > 0 && (
          <details className="mt-2 text-xs">
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
