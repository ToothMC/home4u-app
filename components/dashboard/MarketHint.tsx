"use client";

import { TrendingUp, TrendingDown, CheckCircle2, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { tFormat } from "@/lib/i18n/dict";

type Position =
  | "very_good"
  | "good"
  | "fair"
  | "above"
  | "expensive"
  | "unknown"
  | null;

const NUMBER_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

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
  const { t, lang } = useT();
  const fmt = (n: number) =>
    `${n.toLocaleString(NUMBER_LOCALE[lang], { maximumFractionDigits: 0 })} €/m²`;

  if (!position || position === "unknown" || pricePerSqm == null || median == null) {
    return (
      <div className="rounded-md border border-dashed bg-[var(--accent)]/40 p-3 text-xs text-[var(--muted-foreground)] flex items-start gap-2">
        <MinusCircle className="size-3 mt-0.5 shrink-0" />
        <span>{tFormat(t("marketHint.notEnoughDataset"), { n: compsetSize })}</span>
      </div>
    );
  }

  const deltaPct = Math.round(((pricePerSqm - median) / median) * 100);
  const isGood = position === "very_good" || position === "good";
  const isFair = position === "fair";
  const isHigh = position === "above" || position === "expensive";

  const tone = isGood ? "emerald" : isFair ? "blue" : "amber";
  const Icon = isGood ? CheckCircle2 : isHigh ? TrendingUp : TrendingDown;

  const message = (() => {
    if (position === "very_good") return t("marketHint.veryLow");
    if (position === "good") return t("marketHint.low");
    if (position === "fair") return t("marketHint.fair");
    if (position === "above")
      return tFormat(t("marketHint.aboveMarket"), { p75: fmt(p75 ?? median) });
    return tFormat(t("marketHint.farAbove"), { median: fmt(median) });
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
          {t("marketHint.yourPrice")}: <strong>{fmt(pricePerSqm)}</strong>
          {" · "}
          {t("marketHint.median")}: <strong>{fmt(median)}</strong>
          {" · "}
          {deltaPct > 0 ? `+${deltaPct}` : deltaPct} %
        </div>
        <div className="opacity-90">{message}</div>
        <div className="text-[10px] opacity-75">
          {t("marketHint.compset")}: {compsetSize} {t("marketHint.activeListings")}
          {p25 != null && p75 != null
            ? ` · ${t("marketHint.range")} ${fmt(p25)} – ${fmt(p75)}`
            : ""}
        </div>
      </div>
    </div>
  );
}
