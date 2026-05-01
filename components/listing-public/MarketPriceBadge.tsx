"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { tFormat } from "@/lib/i18n/dict";

import {
  MARKET_POSITION_CONFIG,
  MarketBars,
  MarketPriceBlock,
  type MarketData,
} from "./MarketPriceBlock";

export function MarketPriceBadge({ data }: { data: MarketData }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  if (data.position === "unknown") return null;

  const cfg = MARKET_POSITION_CONFIG[data.position];
  const label = t(cfg.key);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
          "hover:bg-[var(--brand-gold-50)]",
          "border border-transparent hover:border-[var(--border)]",
        )}
        aria-label={tFormat(t("marketPrice.detailsAria"), { label })}
      >
        <MarketBars bars={cfg.bars} tone={cfg.tone} t={t} />
        <span
          className={cn(
            "text-xs font-semibold",
            cfg.tone === "green" ? "text-emerald-700" : "text-amber-700",
          )}
        >
          {label}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[var(--card)] rounded-lg shadow-xl max-w-md w-full p-2 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <MarketPriceBlock data={data} />
            <div className="px-2 pb-2 pt-1 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline hover:no-underline px-2 py-1"
              >
                {t("marketPrice.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
