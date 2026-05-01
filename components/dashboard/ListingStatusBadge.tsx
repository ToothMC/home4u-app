"use client";

import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/dict";

const KEYS: Record<string, { key: TKey; cls: string }> = {
  active: {
    key: "listingStatus.active",
    cls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  },
  stale: {
    key: "listingStatus.stale",
    cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  },
  reserved: {
    key: "listingStatus.reserved",
    cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  },
  rented: {
    key: "listingStatus.rented",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] font-semibold",
  },
  sold: {
    key: "listingStatus.sold",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] font-semibold",
  },
  opted_out: {
    key: "listingStatus.opted_out",
    cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  },
  archived: {
    key: "listingStatus.archived",
    cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  },
};

export function ListingStatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const m = KEYS[status];
  const label = m ? t(m.key) : status;
  const cls = m?.cls ?? "bg-[var(--muted)] text-[var(--muted-foreground)]";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}
