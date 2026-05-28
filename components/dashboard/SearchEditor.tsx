"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Check, Filter, Globe, Loader2, Lock, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeleteRecordButton } from "@/components/dashboard/DeleteRecordButton";
import { emitMatchesUpdated } from "@/lib/events/match-events";
import {
  ENERGY_OPTIONS,
  FEATURE_OPTIONS,
  FURNISHING_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  featureKey,
  propertyTypeKey,
  type EnergyOption,
  type FeatureOption,
  type FurnishingOption,
  type PropertyTypeOption,
} from "@/lib/browse/filters";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/dict";

export type EditableSearchProfile = {
  id: string;
  location: string;
  type: "rent" | "sale";
  budget_min: number | null;
  budget_max: number | null;
  rooms: number | null;
  move_in_date: string | null;
  household: string | null;
  lifestyle_tags: string[] | null;
  pets: boolean | null;
  free_text: string | null;
  active: boolean;
  notify_new_matches: boolean;
  published_as_wanted: boolean;
  // stoebern-Parität
  property_types: PropertyTypeOption[];
  bathrooms_min: number | null;
  size_min: number | null;
  size_max: number | null;
  furnishing: FurnishingOption | null;
  features_required: FeatureOption[];
  energy_min: EnergyOption | null;
  year_min: number | null;
  include_shares: boolean;
};

const HOUSEHOLD: Array<{ value: string; key: TKey }> = [
  { value: "single", key: "household.single" },
  { value: "couple", key: "household.couple" },
  { value: "family", key: "household.family" },
  { value: "shared", key: "household.shared" },
];

const LIFESTYLE_OPTIONS: Array<{ value: string; key: TKey }> = [
  { value: "ruhig", key: "lifestyle.quiet" },
  { value: "zentrale Lage", key: "lifestyle.central" },
  { value: "nah am Strand", key: "lifestyle.beach" },
  { value: "Familienviertel", key: "lifestyle.familyArea" },
  { value: "Homeoffice", key: "lifestyle.homeoffice" },
  { value: "Schulen", key: "lifestyle.schools" },
  { value: "Restaurants", key: "lifestyle.restaurants" },
  { value: "Pool", key: "lifestyle.pool" },
  { value: "Community-Pool", key: "lifestyle.communityPool" },
  { value: "Garage", key: "lifestyle.garage" },
  { value: "Parkplatz", key: "lifestyle.parking" },
];

// Toggle-Felder werden direkt beim Click gespeichert (Instant-Save), nicht
// batched mit dem Speichern-Button am Ende. UX-Erwartung wie OS-Preferences:
// Toggle umlegen = sofort persistiert, kein „save erst am Ende".
const INSTANT_SAVE_FIELDS = new Set<keyof EditableSearchProfile>([
  "notify_new_matches",
  "published_as_wanted",
  "active",
]);

export function SearchEditor({ initial }: { initial: EditableSearchProfile }) {
  const router = useRouter();
  const { t } = useT();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [form, setForm] = React.useState<Partial<EditableSearchProfile>>({});
  // Instant-saved toggles werden hier persistiert, damit das UI nach dem
  // Server-Roundtrip den neuen Stand anzeigt ohne auf router.refresh() warten
  // zu müssen (initial-prop bleibt eingefroren, server-state ändert sich).
  const [instant, setInstant] = React.useState<Partial<EditableSearchProfile>>({});
  const [busy, setBusy] = React.useState<"save" | keyof EditableSearchProfile | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [matchCount, setMatchCount] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const set = <K extends keyof EditableSearchProfile>(
    key: K,
    value: EditableSearchProfile[K]
  ) => {
    if (INSTANT_SAVE_FIELDS.has(key)) {
      void saveInstant(key, value);
      return;
    }
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const get = <K extends keyof EditableSearchProfile>(
    key: K
  ): EditableSearchProfile[K] => {
    if (key in form) return form[key] as EditableSearchProfile[K];
    if (key in instant) return instant[key] as EditableSearchProfile[K];
    return initial[key];
  };

  async function saveInstant<K extends keyof EditableSearchProfile>(
    key: K,
    value: EditableSearchProfile[K]
  ): Promise<void> {
    const previous = get(key);
    setInstant((prev) => ({ ...prev, [key]: value }));
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/searches/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        setInstant((prev) => ({ ...prev, [key]: previous }));
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
      setInstant((prev) => ({ ...prev, [key]: previous }));
    } finally {
      setBusy(null);
    }
  }

  const tags = (get("lifestyle_tags") ?? []) as string[];
  const toggleTag = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag];
    set("lifestyle_tags", next);
  };

  async function save() {
    if (Object.keys(form).length === 0) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/searches/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        return;
      }
      const json = await res.json().catch(() => ({} as { match_count?: number }));
      setForm({});
      setSavedAt(Date.now());
      setMatchCount(
        typeof json.match_count === "number" ? json.match_count : null
      );
      emitMatchesUpdated();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
    } finally {
      setBusy(null);
    }
  }

  const dirty = Object.keys(form).length > 0;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => set("notify_new_matches", !(get("notify_new_matches") as boolean))}
        disabled={busy === "notify_new_matches"}
        className={cn(
          "w-full flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors disabled:opacity-60",
          get("notify_new_matches")
            ? "border-emerald-300 bg-emerald-500/10 text-emerald-800"
            : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]"
        )}
        aria-pressed={get("notify_new_matches") as boolean}
        aria-busy={busy === "notify_new_matches"}
      >
        <span className="flex items-center gap-2">
          {get("notify_new_matches") ? (
            <Bell className="size-4" />
          ) : (
            <BellOff className="size-4" />
          )}
          <span>
            {get("notify_new_matches")
              ? t("searchEditor.notify.on")
              : t("searchEditor.notify.off")}
          </span>
        </span>
        <span
          className={cn(
            "relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors",
            get("notify_new_matches") ? "bg-emerald-500" : "bg-neutral-300"
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
              get("notify_new_matches") ? "translate-x-5" : "translate-x-0"
            )}
          />
        </span>
      </button>

      <button
        type="button"
        onClick={() => set("published_as_wanted", !(get("published_as_wanted") as boolean))}
        disabled={busy === "published_as_wanted"}
        className={cn(
          "w-full flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors disabled:opacity-60",
          get("published_as_wanted")
            ? "border-sky-300 bg-sky-500/10 text-sky-900"
            : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]"
        )}
        aria-pressed={get("published_as_wanted") as boolean}
        aria-busy={busy === "published_as_wanted"}
      >
        <span className="flex items-start gap-2 text-left">
          {get("published_as_wanted") ? (
            <Globe className="size-4 mt-0.5" />
          ) : (
            <Lock className="size-4 mt-0.5" />
          )}
          <span className="flex flex-col gap-0.5">
            <span>
              {get("published_as_wanted")
                ? t("searchEditor.publish.on")
                : t("searchEditor.publish.off")}
            </span>
            <span className="text-xs opacity-80">
              {get("published_as_wanted")
                ? t("searchEditor.publish.onSub")
                : t("searchEditor.publish.offSub")}
            </span>
          </span>
        </span>
        <span
          className={cn(
            "relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors mt-0.5",
            get("published_as_wanted") ? "bg-sky-500" : "bg-neutral-300"
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
              get("published_as_wanted") ? "translate-x-5" : "translate-x-0"
            )}
          />
        </span>
      </button>

      <Field label={t("searchEditor.location")}>
        <Input
          value={(get("location") as string) ?? ""}
          onChange={(e) => set("location", e.target.value)}
          placeholder={t("searchEditor.locationPlaceholder")}
          className="bg-white"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("searchEditor.type")}>
          <select
            value={get("type") as string}
            onChange={(e) => set("type", e.target.value as "rent" | "sale")}
            className="h-10 w-full rounded-md border bg-white px-3 text-sm"
          >
            <option value="rent">{t("searchEditor.type.rent")}</option>
            <option value="sale">{t("searchEditor.type.sale")}</option>
          </select>
        </Field>
        <Field label={t("searchEditor.statusLabel")}>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => set("active", true)}
              disabled={busy === "active"}
              className={cn(
                "rounded-full border px-3 py-1 text-xs flex-1 disabled:opacity-60",
                get("active")
                  ? "bg-emerald-500/15 text-emerald-700 border-emerald-300"
                  : "bg-[var(--background)]"
              )}
            >
              {t("searchRow.active")}
            </button>
            <button
              type="button"
              onClick={() => set("active", false)}
              disabled={busy === "active"}
              className={cn(
                "rounded-full border px-3 py-1 text-xs flex-1 disabled:opacity-60",
                !get("active")
                  ? "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  : "bg-[var(--background)]"
              )}
            >
              {t("searchRow.paused")}
            </button>
          </div>
        </Field>
      </div>

      <Field label={t("filter.propertyType.label")}>
        <div className="flex flex-wrap gap-2">
          {PROPERTY_TYPE_OPTIONS.map((pt) => {
            const current = (get("property_types") as PropertyTypeOption[] | null) ?? [];
            const active = current.includes(pt);
            return (
              <button
                key={pt}
                type="button"
                onClick={() => {
                  const next = active
                    ? current.filter((x) => x !== pt)
                    : [...current, pt];
                  set("property_types", next);
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  active
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                    : "bg-[var(--background)] hover:bg-[var(--accent)]"
                )}
              >
                {t(propertyTypeKey(pt))}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("searchEditor.budgetMin")}>
          <Input
            type="number"
            value={(get("budget_min") as number | null) ?? ""}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              set("budget_min", Number.isFinite(n) ? n : null);
            }}
            min={0}
            className="bg-white"
          />
        </Field>
        <Field
          label={
            get("type") === "sale"
              ? t("searchEditor.budgetMaxSale")
              : t("searchEditor.budgetMaxRent")
          }
        >
          <Input
            type="number"
            value={(get("budget_max") as number | null) ?? ""}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              set("budget_max", Number.isFinite(n) ? n : null);
            }}
            min={0}
            className="bg-white"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("searchEditor.rooms")}>
          <Input
            type="number"
            value={(get("rooms") as number | null) ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set("rooms", Number.isFinite(n) ? n : null);
            }}
            min={0}
            max={20}
            className="bg-white"
          />
        </Field>
        <Field label={t("searchEditor.moveIn")}>
          <Input
            type="date"
            value={((get("move_in_date") as string) ?? "").slice(0, 10)}
            onChange={(e) => set("move_in_date", e.target.value || null)}
            className="bg-white"
          />
        </Field>
      </div>

      <Field label={t("searchEditor.household")}>
        <div className="flex gap-2 flex-wrap">
          {HOUSEHOLD.map((h) => {
            const active = get("household") === h.value;
            return (
              <button
                key={h.value}
                type="button"
                onClick={() =>
                  set(
                    "household",
                    (active ? null : h.value) as EditableSearchProfile["household"]
                  )
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  active
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                    : "bg-[var(--background)] hover:bg-[var(--accent)]"
                )}
              >
                {t(h.key)}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t("searchEditor.pets")}>
        <div className="flex gap-2">
          {[
            { v: true, l: t("searchEditor.pets.yes") },
            { v: false, l: t("searchEditor.pets.no") },
            { v: null, l: t("searchEditor.pets.dontCare") },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => set("pets", o.v as boolean | null)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                get("pets") === o.v
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                  : "bg-[var(--background)]"
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("searchEditor.lifestyle")}>
        <div className="flex flex-wrap gap-2">
          {LIFESTYLE_OPTIONS.map((opt) => {
            const active = tags.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleTag(opt.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  active
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                    : "bg-[var(--background)] hover:bg-[var(--accent)]"
                )}
              >
                {active && <Check className="inline size-3 mr-0.5" />}
                {t(opt.key)}
              </button>
            );
          })}
        </div>
      </Field>

      <div>
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs",
            "bg-[var(--background)] hover:bg-[var(--accent)]"
          )}
        >
          <Filter className="size-3.5" />
          {t("filter.more")}
          {countAdvancedFromProfile(get) > 0 && (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-[var(--brand-gold)] px-1.5 min-w-5 text-[10px] font-semibold text-white">
              {countAdvancedFromProfile(get)}
            </span>
          )}
        </button>
      </div>

      <AdvancedFilterDialog
        open={moreOpen}
        onOpenChange={setMoreOpen}
        get={get}
        set={set}
        t={t}
      />

      <Field label={t("searchEditor.freeText")}>
        <Textarea
          value={(get("free_text") as string) ?? ""}
          onChange={(e) => set("free_text", e.target.value || null)}
          placeholder={t("searchEditor.freeTextPlaceholder")}
          rows={4}
          maxLength={2000}
          className="bg-white"
        />
      </Field>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800 flex items-start gap-2">
          <X className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="border-t pt-4 flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
        <DeleteRecordButton
          endpoint={`/api/searches/${initial.id}`}
          redirectTo="/dashboard?view=seeker"
          what={t("searchEditor.deleteWhat")}
        />
        <div className="flex items-center gap-2">
          {savedAt && !dirty && (
            <span className="text-xs text-emerald-700 flex items-center gap-1">
              <Check className="size-3" /> {t("searchEditor.saved")}
              {matchCount !== null && (
                <Link
                  href="/matches"
                  className="ml-1 underline hover:no-underline"
                >
                  · {matchCount} {t("searchEditor.matches")}
                </Link>
              )}
            </span>
          )}
          <Button onClick={save} disabled={!dirty || busy === "save"}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {dirty ? t("searchEditor.save") : t("searchEditor.noChanges")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

type Getter = <K extends keyof EditableSearchProfile>(key: K) => EditableSearchProfile[K];
type Setter = <K extends keyof EditableSearchProfile>(key: K, value: EditableSearchProfile[K]) => void;

function countAdvancedFromProfile(get: Getter): number {
  let n = 0;
  if (get("bathrooms_min") != null) n++;
  if (get("size_min") != null || get("size_max") != null) n++;
  if (get("furnishing") != null) n++;
  if (((get("features_required") as FeatureOption[] | null) ?? []).length > 0) n++;
  if (get("energy_min") != null) n++;
  if (get("year_min") != null) n++;
  if (get("include_shares") === true) n++;
  return n;
}

function AdvancedFilterDialog({
  open,
  onOpenChange,
  get,
  set,
  t,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  get: Getter;
  set: Setter;
  t: ReturnType<typeof useT>["t"];
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl bg-[var(--background)] p-6 shadow-lg focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
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

          <div className="space-y-5">
            <Section label={t("filter.bathrooms.label")}>
              <ChipMulti<number>
                options={[1, 2, 3, 4]}
                value={
                  get("bathrooms_min") != null ? [get("bathrooms_min") as number] : []
                }
                onChange={(v) => set("bathrooms_min", v[v.length - 1] ?? null)}
                renderLabel={(r) => `${r}+`}
              />
            </Section>

            <Section label={t("filter.size.label")}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder={t("filter.size.from")}
                  value={(get("size_min") as number | null) ?? ""}
                  onChange={(e) =>
                    set("size_min", e.target.value ? Number(e.target.value) : null)
                  }
                  className="h-9 w-28"
                />
                <span className="text-[var(--muted-foreground)]">–</span>
                <Input
                  type="number"
                  min={0}
                  placeholder={t("filter.size.to")}
                  value={(get("size_max") as number | null) ?? ""}
                  onChange={(e) =>
                    set("size_max", e.target.value ? Number(e.target.value) : null)
                  }
                  className="h-9 w-28"
                />
              </div>
            </Section>

            <Section label={t("filter.furnishing.label")}>
              <div className="flex flex-wrap gap-1.5">
                <FurnishingChip
                  label={t("filter.furnishing.any")}
                  active={get("furnishing") == null}
                  onClick={() => set("furnishing", null)}
                />
                {FURNISHING_OPTIONS.map((f) => (
                  <FurnishingChip
                    key={f}
                    label={t(`filter.furnishing.${f}` as TKey)}
                    active={get("furnishing") === f}
                    onClick={() => set("furnishing", f)}
                  />
                ))}
              </div>
            </Section>

            <Section label={t("filter.features.label")}>
              <ChipMulti<FeatureOption>
                options={FEATURE_OPTIONS}
                value={(get("features_required") as FeatureOption[] | null) ?? []}
                onChange={(v) => set("features_required", v)}
                renderLabel={(f) => t(featureKey(f))}
              />
            </Section>

            <Section label={t("filter.energy.label")}>
              <ChipMulti<EnergyOption>
                options={ENERGY_OPTIONS}
                value={get("energy_min") ? [get("energy_min") as EnergyOption] : []}
                onChange={(v) => set("energy_min", v[v.length - 1] ?? null)}
                renderLabel={(e) => e}
              />
            </Section>

            <Section label={t("filter.year.label")}>
              <Input
                type="number"
                min={1900}
                max={new Date().getFullYear() + 5}
                placeholder="2010"
                value={(get("year_min") as number | null) ?? ""}
                onChange={(e) =>
                  set("year_min", e.target.value ? Number(e.target.value) : null)
                }
                className="h-9 w-28"
              />
            </Section>

            <Section label={t("filter.shares.label")}>
              <label className="inline-flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={get("include_shares") === true}
                  onChange={(e) => set("include_shares", e.target.checked)}
                  className="size-4 mt-0.5"
                />
                <span className="text-[var(--warm-bark)] leading-snug">
                  {t("filter.shares.includeHint")}
                </span>
              </label>
            </Section>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t("filter.apply")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
            onClick={() => {
              const next = active ? value.filter((v) => v !== opt) : [...value, opt];
              onChange(next);
            }}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors",
              active
                ? "bg-[var(--brand-navy)] border-[var(--brand-navy)] text-white"
                : "bg-white border-[var(--border)] text-[var(--brand-navy)] hover:border-[var(--brand-gold-300)]"
            )}
          >
            {renderLabel(opt)}
          </button>
        );
      })}
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
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-xs",
        active
          ? "bg-[var(--brand-navy)] border-[var(--brand-navy)] text-white"
          : "bg-white border-[var(--border)] text-[var(--brand-navy)] hover:border-[var(--brand-gold-300)]"
      )}
    >
      {label}
    </button>
  );
}
