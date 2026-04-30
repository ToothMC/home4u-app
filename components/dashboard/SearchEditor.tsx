"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Check, Loader2, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeleteRecordButton } from "@/components/dashboard/DeleteRecordButton";
import { emitMatchesUpdated } from "@/lib/events/match-events";
import { cn } from "@/lib/utils";

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
};

const HOUSEHOLD = [
  { value: "single", label: "Einzelperson" },
  { value: "couple", label: "Paar" },
  { value: "family", label: "Familie" },
  { value: "shared", label: "WG" },
];

const LIFESTYLE_OPTIONS = [
  "ruhig", "zentrale Lage", "nah am Strand", "Familienviertel",
  "Homeoffice", "Schulen", "Restaurants",
  "Pool", "Community-Pool", "Garage", "Parkplatz",
];

export function SearchEditor({ initial }: { initial: EditableSearchProfile }) {
  const router = useRouter();
  const [form, setForm] = React.useState<Partial<EditableSearchProfile>>({});
  const [busy, setBusy] = React.useState<"save" | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [matchCount, setMatchCount] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const set = <K extends keyof EditableSearchProfile>(
    key: K,
    value: EditableSearchProfile[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const get = <K extends keyof EditableSearchProfile>(
    key: K
  ): EditableSearchProfile[K] => {
    if (key in form) return form[key] as EditableSearchProfile[K];
    return initial[key];
  };

  const tags = (get("lifestyle_tags") ?? []) as string[];
  const toggleTag = (t: string) => {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
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
        setError(detail.detail ?? detail.error ?? `Fehler ${res.status}`);
        return;
      }
      const json = await res.json().catch(() => ({} as { match_count?: number }));
      setForm({});
      setSavedAt(Date.now());
      setMatchCount(
        typeof json.match_count === "number" ? json.match_count : null
      );
      // Andere geöffnete Listen (z.B. /matches) sofort refreshen lassen.
      emitMatchesUpdated();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Netzwerkfehler");
    } finally {
      setBusy(null);
    }
  }

  const dirty = Object.keys(form).length > 0;

  return (
    <div className="space-y-5">
      <Field label="Wo suchst du?">
        <Input
          value={(get("location") as string) ?? ""}
          onChange={(e) => set("location", e.target.value)}
          placeholder="z. B. Paphos Kato oder Limassol Tourist Area"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Typ">
          <select
            value={get("type") as string}
            onChange={(e) => set("type", e.target.value as "rent" | "sale")}
            className="h-10 w-full rounded-md border bg-[var(--background)] px-3 text-sm"
          >
            <option value="rent">Miete</option>
            <option value="sale">Kauf</option>
          </select>
        </Field>
        <Field label="Status">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => set("active", true)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs flex-1",
                get("active")
                  ? "bg-emerald-500/15 text-emerald-700 border-emerald-300"
                  : "bg-[var(--background)]"
              )}
            >
              aktiv
            </button>
            <button
              type="button"
              onClick={() => set("active", false)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs flex-1",
                !get("active")
                  ? "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  : "bg-[var(--background)]"
              )}
            >
              pausiert
            </button>
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget min (€)">
          <Input
            type="number"
            value={(get("budget_min") as number | null) ?? ""}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              set("budget_min", Number.isFinite(n) ? n : null);
            }}
            min={0}
          />
        </Field>
        <Field label={get("type") === "sale" ? "Budget max (€)" : "Budget max pro Monat (€)"}>
          <Input
            type="number"
            value={(get("budget_max") as number | null) ?? ""}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              set("budget_max", Number.isFinite(n) ? n : null);
            }}
            min={0}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Zimmer">
          <Input
            type="number"
            value={(get("rooms") as number | null) ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set("rooms", Number.isFinite(n) ? n : null);
            }}
            min={0}
            max={20}
          />
        </Field>
        <Field label="Einzug ab">
          <Input
            type="date"
            value={((get("move_in_date") as string) ?? "").slice(0, 10)}
            onChange={(e) => set("move_in_date", e.target.value || null)}
          />
        </Field>
      </div>

      <Field label="Haushalt">
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
                {h.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Haustiere">
        <div className="flex gap-2">
          {[
            { v: true, l: "Ja" },
            { v: false, l: "Nein" },
            { v: null, l: "—" },
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

      <Field label="Lifestyle / was wichtig ist">
        <div className="flex flex-wrap gap-2">
          {LIFESTYLE_OPTIONS.map((t) => {
            const active = tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  active
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                    : "bg-[var(--background)] hover:bg-[var(--accent)]"
                )}
              >
                {active && <Check className="inline size-3 mr-0.5" />}
                {t}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="E-Mail-Benachrichtigung bei neuen Treffern">
        <button
          type="button"
          onClick={() => set("notify_new_matches", !(get("notify_new_matches") as boolean))}
          className={cn(
            "w-full flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors",
            get("notify_new_matches")
              ? "border-emerald-300 bg-emerald-500/10 text-emerald-800"
              : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]"
          )}
          aria-pressed={get("notify_new_matches") as boolean}
        >
          <span className="flex items-center gap-2">
            {get("notify_new_matches") ? (
              <Bell className="size-4" />
            ) : (
              <BellOff className="size-4" />
            )}
            <span>
              {get("notify_new_matches")
                ? "Tägliche E-Mail bei neuen Treffern aktiv"
                : "Keine E-Mail-Benachrichtigung"}
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
      </Field>

      <Field label="Was Sophie sonst noch wissen sollte">
        <Textarea
          value={(get("free_text") as string) ?? ""}
          onChange={(e) => set("free_text", e.target.value || null)}
          placeholder="z. B. 'arbeite remote, brauche schnelles Internet und Balkon für Pflanzen'"
          rows={4}
          maxLength={2000}
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
          what="Diese Suche"
        />
        <div className="flex items-center gap-2">
          {savedAt && !dirty && (
            <span className="text-xs text-emerald-700 flex items-center gap-1">
              <Check className="size-3" /> Gespeichert
              {matchCount !== null && (
                <Link
                  href="/matches"
                  className="ml-1 underline hover:no-underline"
                >
                  · {matchCount} {matchCount === 1 ? "Treffer" : "Treffer"}
                </Link>
              )}
            </span>
          )}
          <Button onClick={save} disabled={!dirty || busy === "save"}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {dirty ? "Änderungen speichern" : "Keine Änderungen"}
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
