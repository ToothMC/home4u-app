const MAP: Record<string, { label: string; cls: string }> = {
  active: {
    label: "online",
    cls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  },
  stale: {
    label: "fraglich",
    cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  },
  reserved: {
    label: "reserviert",
    cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  },
  rented: {
    label: "vermietet",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] font-semibold",
  },
  sold: {
    label: "verkauft",
    cls: "bg-[var(--destructive)]/15 text-[var(--destructive)] font-semibold",
  },
  opted_out: {
    label: "deaktiviert",
    cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  },
  archived: {
    label: "archiviert",
    cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  },
};

export function ListingStatusBadge({ status }: { status: string }) {
  const m =
    MAP[status] ?? {
      label: status,
      cls: "bg-[var(--muted)] text-[var(--muted-foreground)]",
    };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
