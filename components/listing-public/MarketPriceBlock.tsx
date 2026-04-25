import { cn } from "@/lib/utils";

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
};

const CONFIG: Record<
  Exclude<MarketPosition, "unknown">,
  { bars: number; label: string; tone: "green" | "orange" }
> = {
  very_good: { bars: 5, label: "Sehr guter Preis", tone: "green" },
  good: { bars: 4, label: "Guter Preis", tone: "green" },
  fair: { bars: 3, label: "Fairer Preis", tone: "green" },
  above: { bars: 2, label: "Erhöhter Preis", tone: "orange" },
  expensive: { bars: 1, label: "Hoher Preis", tone: "orange" },
};

export function MarketPriceBlock({ data }: { data: MarketData }) {
  if (data.position === "unknown") {
    return (
      <section className="rounded-2xl border bg-[var(--card)] p-4 space-y-2">
        <h3 className="text-sm font-semibold">Preis-Einschätzung</h3>
        <p className="text-xs text-[var(--muted-foreground)]">
          Noch zu wenig vergleichbare Inserate für eine faire Einschätzung
          {data.compset_size > 0 ? ` (${data.compset_size} gefunden)` : ""}.
          Wir aktualisieren das automatisch sobald genug Daten da sind.
        </p>
      </section>
    );
  }

  const cfg = CONFIG[data.position];
  const fmt = (n: number) =>
    `${n.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €/m²`;

  return (
    <section className="rounded-2xl border bg-[var(--card)] p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Preis-Einschätzung</h3>
        <p className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider mt-0.5">
          €/m² verglichen mit ähnlichen Inseraten
        </p>
      </div>

      <div className="flex items-center gap-3">
        <MarketBars bars={cfg.bars} tone={cfg.tone} />
        <div
          className={cn(
            "text-sm font-semibold",
            cfg.tone === "green" ? "text-emerald-700" : "text-amber-700"
          )}
        >
          {cfg.label}
        </div>
      </div>

      {data.price_per_sqm != null && (
        <div className="text-xs grid grid-cols-3 gap-2 pt-1">
          <Stat label="Diese Wohnung" value={fmt(data.price_per_sqm)} highlight />
          {data.median_eur_sqm != null && (
            <Stat label="Markt-Median" value={fmt(data.median_eur_sqm)} />
          )}
          {data.p25_eur_sqm != null && data.p75_eur_sqm != null && (
            <Stat
              label="Markt-Spanne (50 %)"
              value={`${fmt(data.p25_eur_sqm)} – ${fmt(data.p75_eur_sqm)}`}
            />
          )}
        </div>
      )}

      <p className="text-[11px] text-[var(--muted-foreground)] border-t pt-2">
        Basierend auf <strong>{data.compset_size}</strong> aktiven Inseraten
        {" in "}
        {data.district ? `${data.district}, ${data.city}` : data.city}
        {data.rooms != null
          ? `, ${data.rooms === 0 ? "Studios" : `${data.rooms}-Zi-Wohnungen`}`
          : ""}
        . Statistische Einschätzung — kein endgültiges Urteil.
      </p>
    </section>
  );
}

function MarketBars({ bars, tone }: { bars: number; tone: "green" | "orange" }) {
  return (
    <div className="flex items-end gap-1" role="img" aria-label={`${bars} von 5 Balken`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const active = i <= bars;
        const height = 8 + i * 4; // 12, 16, 20, 24, 28 px
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
