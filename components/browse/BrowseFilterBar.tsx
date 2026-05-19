"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { Filter, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { tFormat, type T, type TKey } from "@/lib/i18n/dict";
import { CYPRUS_REGIONS } from "@/lib/geo/cyprus-regions";
import {
  EMPTY_FILTERS,
  ENERGY_OPTIONS,
  FEATURE_OPTIONS,
  FURNISHING_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  ROOMS_PLUS_THRESHOLD,
  ROOM_OPTIONS,
  countActiveFilters,
  countAdvancedFilters,
  featureKey,
  propertyTypeKey,
  serializeFilters,
  type BrowseFilters,
  type EnergyOption,
  type FeatureOption,
  type PropertyTypeOption,
} from "@/lib/browse/filters";
import { cn } from "@/lib/utils";

type Props = {
  initial: BrowseFilters;
};

export function BrowseFilterBar({ initial }: Props) {
  const router = useRouter();
  const { t } = useT();
  const [moreOpen, setMoreOpen] = React.useState(false);

  // Single source of truth = URL/SSR initial. Patches gehen direkt in
  // router.push, der Server-Re-Render bringt das nächste `initial` zurück.
  // So bleibt Back/Forward konsistent und wir vermeiden setState-in-effect.
  const filters = initial;
  const totalActive = countActiveFilters(filters);
  const advancedActive = countAdvancedFilters(filters);

  function applyFilters(next: BrowseFilters) {
    const params = serializeFilters(next);
    const qs = params.toString();
    router.push(qs ? `/stoebern?${qs}` : "/stoebern", { scroll: false });
  }

  function patch(partial: Partial<BrowseFilters>) {
    applyFilters({ ...filters, ...partial });
  }

  function resetAll() {
    applyFilters(EMPTY_FILTERS);
  }

  return (
    <div className="sticky top-[61px] z-20 bg-[var(--warm-cream)]/95 backdrop-blur border-b border-[var(--border)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2">
        {/* 1. Type */}
        <PillToggle
          label={t("filter.type.all")}
          active={filters.type === null}
          onClick={() => patch({ type: null })}
        />
        <PillToggle
          label={t("filter.type.rent")}
          active={filters.type === "rent"}
          onClick={() => patch({ type: "rent" })}
        />
        <PillToggle
          label={t("filter.type.sale")}
          active={filters.type === "sale"}
          onClick={() => patch({ type: "sale" })}
        />

        <Separator />

        {/* 2. Region */}
        <NativeSelect
          aria-label={t("filter.region.label")}
          value={filters.region ?? ""}
          onChange={(e) =>
            patch({
              region:
                (e.target.value || null) as BrowseFilters["region"],
            })
          }
        >
          <option value="">{t("filter.region.all")}</option>
          {CYPRUS_REGIONS.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.label}
            </option>
          ))}
        </NativeSelect>

        {/* 3. Art (multi-select via popover) */}
        <PropertyTypePicker
          value={filters.propertyTypes}
          onChange={(v) => patch({ propertyTypes: v })}
          t={t}
        />

        {/* 4. Zimmer (multi chip) */}
        <RoomsPicker
          value={filters.rooms}
          onChange={(v) => patch({ rooms: v })}
          t={t}
        />

        {/* 5. Preis */}
        <RangeInputs
          label={t("filter.price.label")}
          fromLabel={t("filter.price.from")}
          toLabel={t("filter.price.to")}
          min={filters.priceMin}
          max={filters.priceMax}
          step={100}
          onChange={(min, max) => patch({ priceMin: min, priceMax: max })}
          width="w-24"
        />

        <Separator />

        {/* Mehr Filter */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => setMoreOpen(true)}
        >
          <Filter className="size-3.5" />
          {t("filter.more")}
          {advancedActive > 0 && (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-[var(--brand-gold)] px-1.5 min-w-5 text-[10px] font-semibold text-white">
              {advancedActive}
            </span>
          )}
        </Button>

        {totalActive > 0 && (
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1 text-xs text-[var(--warm-bark)] hover:text-[var(--brand-navy)] ml-auto"
          >
            <RotateCcw className="size-3" />
            {t("filter.reset")}
            <span className="text-[var(--muted-foreground)]">
              ({tFormat(t("filter.activeBadge"), { n: totalActive })})
            </span>
          </button>
        )}
      </div>

      <AdvancedDialog
        open={moreOpen}
        onOpenChange={setMoreOpen}
        filters={filters}
        onApply={(next) => {
          applyFilters(next);
          setMoreOpen(false);
        }}
        onReset={() => {
          // Nur Advanced-Felder zurücksetzen, primäre Filter behalten.
          applyFilters({
            ...filters,
            bathroomsMin: null,
            sizeMin: null,
            sizeMax: null,
            furnishing: null,
            features: [],
            energyMin: null,
            yearMin: null,
            petsAllowed: false,
          });
          setMoreOpen(false);
        }}
        t={t}
      />
    </div>
  );
}

// === Primitives =============================================================

function Separator() {
  return <span className="hidden sm:block h-5 w-px bg-[var(--border)]" aria-hidden />;
}

function PillToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--brand-navy)] border-[var(--brand-navy)] text-white"
          : "bg-white border-[var(--border)] text-[var(--brand-navy)] hover:border-[var(--brand-gold-300)]",
      )}
    >
      {label}
    </button>
  );
}

const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-8 rounded-full border border-[var(--border)] bg-white px-3 text-xs text-[var(--brand-navy)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = "NativeSelect";

function ChipMulti<T extends string | number>({
  options,
  value,
  onChange,
  renderLabel,
}: {
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
  renderLabel: (opt: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={String(opt)}
            type="button"
            aria-pressed={active}
            onClick={() => {
              const next = active ? value.filter((v) => v !== opt) : [...value, opt];
              onChange(next);
            }}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors",
              active
                ? "bg-[var(--brand-navy)] border-[var(--brand-navy)] text-white"
                : "bg-white border-[var(--border)] text-[var(--brand-navy)] hover:border-[var(--brand-gold-300)]",
            )}
          >
            {renderLabel(opt)}
          </button>
        );
      })}
    </div>
  );
}

// === Property-Type-Picker (Popover) ========================================

function PropertyTypePicker({
  value,
  onChange,
  t,
}: {
  value: PropertyTypeOption[];
  onChange: (v: PropertyTypeOption[]) => void;
  t: T;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const label =
    value.length === 0
      ? t("filter.propertyType.all")
      : value.length === 1
        ? t(propertyTypeKey(value[0]))
        : `${value.length} · ${t("filter.propertyType.label")}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs transition-colors",
          value.length > 0
            ? "bg-[var(--brand-navy)] border-[var(--brand-navy)] text-white"
            : "bg-white border-[var(--border)] text-[var(--brand-navy)] hover:border-[var(--brand-gold-300)]",
        )}
      >
        {label}
        <svg
          className="size-3"
          viewBox="0 0 12 12"
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-xl border border-[var(--border)] bg-white p-3 shadow-lg">
          <ChipMulti<PropertyTypeOption>
            options={PROPERTY_TYPE_OPTIONS}
            value={value}
            onChange={onChange}
            renderLabel={(pt) => t(propertyTypeKey(pt))}
          />
        </div>
      )}
    </div>
  );
}

// === Rooms-Picker (Popover) =================================================

function RoomsPicker({
  value,
  onChange,
  t,
}: {
  value: number[];
  onChange: (v: number[]) => void;
  t: T;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const label =
    value.length === 0
      ? `${t("filter.rooms.label")}: ${t("filter.rooms.any")}`
      : `${t("filter.rooms.label")}: ${value
          .map((r) =>
            r === ROOMS_PLUS_THRESHOLD ? tFormat(t("filter.rooms.plus"), { n: r }) : String(r),
          )
          .join(", ")}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs transition-colors",
          value.length > 0
            ? "bg-[var(--brand-navy)] border-[var(--brand-navy)] text-white"
            : "bg-white border-[var(--border)] text-[var(--brand-navy)] hover:border-[var(--brand-gold-300)]",
        )}
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 rounded-xl border border-[var(--border)] bg-white p-3 shadow-lg">
          <ChipMulti<number>
            options={ROOM_OPTIONS}
            value={value}
            onChange={onChange}
            renderLabel={(r) =>
              r === ROOMS_PLUS_THRESHOLD ? tFormat(t("filter.rooms.plus"), { n: r }) : String(r)
            }
          />
        </div>
      )}
    </div>
  );
}

// === Preis / Größe Range-Inputs =============================================

function RangeInputs(props: {
  label: string;
  fromLabel: string;
  toLabel: string;
  min: number | null;
  max: number | null;
  step?: number;
  width?: string;
  onChange: (min: number | null, max: number | null) => void;
}) {
  // Re-mount per key wenn die kontrollierten Werte sich von außen ändern
  // (z.B. Reset-Button oder Back-Navigation). Vermeidet useEffect+setState.
  return (
    <RangeInputsInner
      key={`${props.min ?? ""}-${props.max ?? ""}`}
      {...props}
    />
  );
}

function RangeInputsInner({
  label,
  fromLabel,
  toLabel,
  min,
  max,
  step = 1,
  width = "w-24",
  onChange,
}: {
  label: string;
  fromLabel: string;
  toLabel: string;
  min: number | null;
  max: number | null;
  step?: number;
  width?: string;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [localMin, setLocalMin] = React.useState(min?.toString() ?? "");
  const [localMax, setLocalMax] = React.useState(max?.toString() ?? "");

  function parse(v: string): number | null {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function commit(nextMin: string, nextMax: string) {
    const parsedMin = parse(nextMin);
    const parsedMax = parse(nextMax);
    if (parsedMin != null && parsedMax != null && parsedMin > parsedMax) {
      onChange(parsedMax, parsedMin);
    } else {
      onChange(parsedMin, parsedMax);
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-[var(--warm-bark)]">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={step}
        placeholder={fromLabel}
        value={localMin}
        aria-label={`${label} ${fromLabel}`}
        onChange={(e) => setLocalMin(e.target.value)}
        onBlur={() => commit(localMin, localMax)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "h-8 rounded-full border border-[var(--border)] bg-white px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]",
          width,
        )}
      />
      <span className="text-[var(--muted-foreground)]">–</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={step}
        placeholder={toLabel}
        value={localMax}
        aria-label={`${label} ${toLabel}`}
        onChange={(e) => setLocalMax(e.target.value)}
        onBlur={() => commit(localMin, localMax)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "h-8 rounded-full border border-[var(--border)] bg-white px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]",
          width,
        )}
      />
    </div>
  );
}

// === Advanced "Mehr"-Dialog =================================================

function AdvancedDialog({
  open,
  onOpenChange,
  filters,
  onApply,
  onReset,
  t,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filters: BrowseFilters;
  onApply: (next: BrowseFilters) => void;
  onReset: () => void;
  t: T;
}) {
  // Dialog.Content muss immer gerendert sein, damit Radix die open/close-
  // Transition korrekt steuert. Den Draft-State packen wir in einen Inner,
  // der per `key` remountet wenn frisch geöffnet wird — so wird er mit dem
  // aktuellen Filter-Snapshot frisch initialisiert (kein setState-in-effect).
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl bg-[var(--background)] p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <Dialog.Close
            aria-label="close"
            className="absolute right-3 top-3 p-1 hover:bg-[var(--accent)] rounded-md"
          >
            <X className="size-4" />
          </Dialog.Close>
          <Dialog.Title className="text-lg font-semibold mb-4">
            {t("filter.advanced.title")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("filter.advanced.title")}
          </Dialog.Description>

          {open ? (
            <AdvancedDialogForm
              key={JSON.stringify(filters)}
              initialDraft={filters}
              onApply={onApply}
              onReset={onReset}
              t={t}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AdvancedDialogForm({
  initialDraft,
  onApply,
  onReset,
  t,
}: {
  initialDraft: BrowseFilters;
  onApply: (next: BrowseFilters) => void;
  onReset: () => void;
  t: T;
}) {
  const [draft, setDraft] = React.useState<BrowseFilters>(initialDraft);

  function patch(p: Partial<BrowseFilters>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  return (
    <>
          <div className="space-y-5">
            {/* Bäder */}
            <Section label={t("filter.bathrooms.label")}>
              <ChipMulti<number>
                options={[1, 2, 3, 4]}
                value={draft.bathroomsMin != null ? [draft.bathroomsMin] : []}
                onChange={(v) =>
                  patch({ bathroomsMin: v[v.length - 1] ?? null })
                }
                renderLabel={(r) => `${r}+`}
              />
            </Section>

            {/* Größe */}
            <Section label={t("filter.size.label")}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder={t("filter.size.from")}
                  value={draft.sizeMin ?? ""}
                  onChange={(e) =>
                    patch({
                      sizeMin: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="h-9 w-28"
                />
                <span className="text-[var(--muted-foreground)]">–</span>
                <Input
                  type="number"
                  min={0}
                  placeholder={t("filter.size.to")}
                  value={draft.sizeMax ?? ""}
                  onChange={(e) =>
                    patch({
                      sizeMax: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="h-9 w-28"
                />
              </div>
            </Section>

            {/* Möblierung */}
            <Section label={t("filter.furnishing.label")}>
              <div className="flex flex-wrap gap-1.5">
                <FurnishingChip
                  label={t("filter.furnishing.any")}
                  active={draft.furnishing === null}
                  onClick={() => patch({ furnishing: null })}
                />
                {FURNISHING_OPTIONS.map((f) => (
                  <FurnishingChip
                    key={f}
                    label={t(`filter.furnishing.${f}` as TKey)}
                    active={draft.furnishing === f}
                    onClick={() => patch({ furnishing: f })}
                  />
                ))}
              </div>
            </Section>

            {/* Features */}
            <Section label={t("filter.features.label")}>
              <ChipMulti<FeatureOption>
                options={FEATURE_OPTIONS}
                value={draft.features}
                onChange={(v) => patch({ features: v })}
                renderLabel={(f) => t(featureKey(f))}
              />
            </Section>

            {/* Energieklasse */}
            <Section label={t("filter.energy.label")}>
              <ChipMulti<EnergyOption>
                options={ENERGY_OPTIONS}
                value={draft.energyMin ? [draft.energyMin] : []}
                onChange={(v) =>
                  patch({ energyMin: v[v.length - 1] ?? null })
                }
                renderLabel={(e) => e}
              />
            </Section>

            {/* Baujahr ab */}
            <Section label={t("filter.year.label")}>
              <Input
                type="number"
                min={1900}
                max={new Date().getFullYear() + 5}
                placeholder="2010"
                value={draft.yearMin ?? ""}
                onChange={(e) =>
                  patch({ yearMin: e.target.value ? Number(e.target.value) : null })
                }
                className="h-9 w-28"
              />
            </Section>

            {/* Haustiere */}
            <Section label={t("filter.pets.label")}>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.petsAllowed}
                  onChange={(e) => patch({ petsAllowed: e.target.checked })}
                  className="size-4"
                />
                <span>{t("filter.pets.label")}</span>
              </label>
            </Section>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onReset}
              className="text-sm text-[var(--warm-bark)] hover:text-[var(--brand-navy)]"
            >
              {t("filter.reset")}
            </button>
            <Button type="button" onClick={() => onApply(draft)}>
              {t("filter.apply")}
            </Button>
          </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-[var(--brand-navy)] mb-2">{label}</div>
      {children}
    </div>
  );
}

function FurnishingChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors",
        active
          ? "bg-[var(--brand-navy)] border-[var(--brand-navy)] text-white"
          : "bg-white border-[var(--border)] text-[var(--brand-navy)] hover:border-[var(--brand-gold-300)]",
      )}
    >
      {label}
    </button>
  );
}
