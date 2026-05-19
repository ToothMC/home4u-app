"use client";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import { propertyTypeGroup } from "@/lib/listing/property-type-group";

const NUMBER_LOCALE: Record<string, string> = {
  de: "de-DE",
  en: "en-GB",
  ru: "ru-RU",
  el: "el-GR",
  zh: "zh-CN",
};

export type MarketPosition =
  | "very_good"
  | "good"
  | "fair"
  | "above"
  | "expensive"
  | "unknown";

export type MarketData = {
  position: MarketPosition;
  price_per_sqm: number | null;
  median_eur_sqm: number | null;
  p25_eur_sqm: number | null;
  p75_eur_sqm: number | null;
  compset_size: number;
  city: string;
  district: string | null;
  rooms: number | null;
  /** Wenn gesetzt, adaptiert das UI Label und Vergleichsmenge-Text
   *  (z.B. "Grundstuecken" statt "Wohnungen"). Bleibt null wenn DB-Wert
   *  fehlt — UI fällt dann auf neutralen Wortlaut zurück. */
  property_type: string | null;
};

export const MARKET_POSITION_CONFIG: Record<
  Exclude<MarketPosition, "unknown">,
  { bars: number; key: TKey; tone: "green" | "orange" }
> = {
  very_good: { bars: 5, key: "matchCard.priceVeryGood", tone: "green" },
  good: { bars: 4, key: "matchCard.priceGood", tone: "green" },
  fair: { bars: 3, key: "matchCard.priceFair", tone: "green" },
  above: { bars: 2, key: "matchCard.priceElevated", tone: "orange" },
  expensive: { bars: 1, key: "matchCard.priceHigh", tone: "orange" },
};

const CONFIG = MARKET_POSITION_CONFIG;

export function MarketPriceBlock({ data }: { data: MarketData }) {
  const { t, lang } = useT();

  if (data.position === "unknown") {
    return (
      <section className="rounded-2xl border bg-[var(--card)] p-4 space-y-2">
        <h3 className="text-sm font-semibold">{t("marketPrice.heading")}</h3>
        <p className="text-xs text-[var(--muted-foreground)]">
          {t("marketPrice.notEnough")}
        </p>
      </section>
    );
  }

  const cfg = CONFIG[data.position];
  const fmt = (n: number) =>
    `${n.toLocaleString(NUMBER_LOCALE[lang] ?? "en-GB", { maximumFractionDigits: 0 })} €/m²`;

  const place = data.district ? `${data.district}, ${data.city}` : data.city;

  // property_type-spezifische Labels: muss synchron sein mit
  // _property_type_group() in der DB, sonst zeigt das UI eine andere
  // Gruppe an als die, die der Vergleichsmenge zugrunde liegt.
  const group = propertyTypeGroup(data.property_type);
  const thisLabel =
    group === "other"
      ? t("marketPrice.thisOne")
      : t((`marketPrice.this.${group}`) as TKey);

  // Rooms-Suffix nur fuer Residentials sinnvoll (Plot/Commercial/Room haben
  // keine bedeutsamen Zimmer). Studios bleiben Sonderfall mit eigenem Wort.
  const isResidential =
    group === "residential_apartment" || group === "residential_house";
  const roomsClause =
    isResidential && data.rooms != null
      ? data.rooms === 0
        ? `, ${t("marketPrice.studios")}`
        : tFormat(t("marketPrice.roomsCount"), { n: data.rooms })
      : "";

  return (
    <section className="rounded-2xl border bg-[var(--card)] p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{t("marketPrice.heading")}</h3>
        <p className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider mt-0.5">
          {t("marketPrice.subheading")}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <MarketBars bars={cfg.bars} tone={cfg.tone} t={t} />
        <div
          className={cn(
            "text-sm font-semibold",
            cfg.tone === "green" ? "text-emerald-700" : "text-amber-700"
          )}
        >
          {t(cfg.key)}
        </div>
      </div>

      {data.price_per_sqm != null && (
        <div className="text-xs grid grid-cols-3 gap-2 pt-1">
          <Stat label={thisLabel} value={fmt(data.price_per_sqm)} highlight />
          {data.median_eur_sqm != null && (
            <Stat label={t("marketHint.median")} value={fmt(data.median_eur_sqm)} />
          )}
          {data.p25_eur_sqm != null && data.p75_eur_sqm != null && (
            <Stat
              label={t("marketPrice.range50")}
              value={`${fmt(data.p25_eur_sqm)} – ${fmt(data.p75_eur_sqm)}`}
            />
          )}
        </div>
      )}

      <p className="text-[11px] text-[var(--muted-foreground)] border-t pt-2">
        {group === "other"
          ? tFormat(t("marketPrice.basedOn"), {
              n: data.compset_size,
              place,
              rooms: roomsClause,
            })
          : tFormat(t("marketPrice.basedOnKind"), {
              n: data.compset_size,
              kind: t((`marketPrice.kind.${group}`) as TKey),
              place,
              rooms: roomsClause,
            })}
      </p>
    </section>
  );
}

export function MarketBars({
  bars,
  tone,
  t,
}: {
  bars: number;
  tone: "green" | "orange";
  t?: T;
}) {
  const aria = t ? tFormat(t("marketPrice.bars5"), { bars }) : `${bars} / 5`;
  return (
    <div className="flex items-end gap-1" role="img" aria-label={aria}>
      {[1, 2, 3, 4, 5].map((i) => {
        const active = i <= bars;
        const height = 8 + i * 4;
        return (
          <span
            key={i}
            className={cn(
              "w-2.5 rounded-sm transition-colors",
              active
                ? tone === "green"
                  ? "bg-emerald-600"
                  : "bg-amber-500"
                : tone === "green"
                  ? "bg-emerald-200"
                  : "bg-amber-200"
            )}
            style={{ height }}
          />
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider">
        {label}
      </div>
      <div className={cn("font-medium", highlight && "text-[var(--foreground)]")}>
        {value}
      </div>
    </div>
  );
}
