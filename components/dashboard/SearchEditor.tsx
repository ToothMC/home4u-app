"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Check, Globe, Loader2, Lock, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeleteRecordButton } from "@/components/dashboard/DeleteRecordButton";
import { emitMatchesUpdated } from "@/lib/events/match-events";
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
