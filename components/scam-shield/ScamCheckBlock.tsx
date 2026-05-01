/**
 * Read-only Sophie-Check-Block für Listing-Detail-Seiten — DEZENT-Variante.
 *
 * Spec-§6.4-Ehrlichkeit (Risiko-Indikator, kein Urteil) bleibt erhalten —
 * der Disclaimer-Link ist nur einen Klick weg, nicht vom Bildschirm
 * verschwunden.
 */
import { Card, CardContent } from "@/components/ui/card";

import { ScoreLight, verdictFromScore } from "./ScoreLight";
import { getT } from "@/lib/i18n/server";
import type { TKey } from "@/lib/i18n/dict";

const FLAG_KEYS: Record<string, TKey> = {
  price_anomaly_low: "scamFlag.price_anomaly_low",
  price_implausible: "scamFlag.price_implausible",
  no_phone: "scamFlag.no_phone",
  known_scam_phone: "scamFlag.known_scam_phone",
  duplicate_images: "scamFlag.duplicate_images",
  text_scam_markers: "scamFlag.text_scam_markers",
  low_evidence: "scamFlag.low_evidence",
};

const DATE_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
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

export async function ScamCheckBlock({ scamScore, scamFlags, scamCheckedAt }: Props) {
  const { t, lang } = await getT();
  const checked = isActuallyChecked(scamScore, scamFlags);
  const flags = Array.isArray(scamFlags) ? scamFlags : [];

  const dateStr = scamCheckedAt
    ? new Date(scamCheckedAt).toLocaleDateString(DATE_LOCALE[lang] ?? "en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      })
    : null;

  if (!checked) {
    return (
      <Card className="border-[var(--border)]">
        <CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-semibold">{t("scamBlock.title")}</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("scamBlock.notChecked")}
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
          <h3 className="text-sm font-semibold">{t("scamBlock.title")}</h3>
          {dateStr && (
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {t("scamBlock.checkedAt")} {dateStr}
            </span>
          )}
        </div>

        <ScoreLight
          verdict={verdict}
          score={score}
          size="sm"
          showScoreLine={false}
          labels={{
            clean: t("scoreLight.clean"),
            warn: t("scoreLight.warn"),
            high: t("scoreLight.high"),
            scoreLine: t("scoreLight.line"),
          }}
        />

        {flags.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)] select-none">
              {flags.length}{" "}
              {flags.length === 1 ? t("scamBlock.flags.one") : t("scamBlock.flags.many")}{" "}
              {t("scamBlock.flagsShow")}
            </summary>
            <ul className="mt-1.5 ml-1 space-y-0.5 text-[var(--muted-foreground)]">
              {flags.map((f) => (
                <li key={f}>· {FLAG_KEYS[f] ? t(FLAG_KEYS[f]) : f}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] opacity-70">
              <a href="/datenschutz#scam-shield" className="underline">
                {t("scamBlock.moreInfo")}
              </a>
            </p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
