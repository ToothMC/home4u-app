"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Trash2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Eye,
  ArrowLeft,
  ArrowRight,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeleteRecordButton } from "@/components/dashboard/DeleteRecordButton";
import { AnalyzeWithSophieButton } from "@/components/dashboard/AnalyzeWithSophieButton";
import { PhotoDropZone } from "@/components/dashboard/PhotoDropZone";
import { MarketHint } from "@/components/dashboard/MarketHint";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type UtilityArrangement =
  | "included"
  | "tenant_pays"
  | "landlord_pays"
  | "estimated"
  | "not_provided";

export type Utilities = {
  water?: UtilityArrangement | null;
  electricity?: UtilityArrangement | null;
  internet?: UtilityArrangement | null;
  garbage?: UtilityArrangement | null;
  bills_in_tenant_name?: boolean | null;
  estimated_monthly_total?: number | null;
  notes?: string | null;
};

export type EditableListing = {
  id: string;
  title: string | null;
  description: string | null;
  type: "rent" | "sale";
  status: string;
  location_city: string;
  location_district: string | null;
  location_address: string | null;
  lat: number | null;
  lng: number | null;
  price: number;
  price_warm: number | null;
  price_cold: number | null;
  deposit: number | null;
  service_charge_monthly: number | null;
  utilities: Utilities | null;
  currency: string;
  rooms: number | null;
  bathrooms: number | null;
  size_sqm: number | null;
  plot_sqm: number | null;
  property_type: string | null;
  floor: string | null;
  year_built: number | null;
  energy_class: string | null;
  furnishing: string | null;
  features: string[] | null;
  pets_allowed: boolean | null;
  available_from: string | null;
  contact_channel: string | null;
  language: string | null;
  media: string[] | null;
  floorplan_url: string | null;
  tour_3d_url: string | null;
  video_url: string | null;
  contract_min_months: number | null;
  contract_notes: string | null;
  ai_analyzed_at: string | null;
  price_per_sqm: number | null;
  market_position:
    | "very_good"
    | "good"
    | "fair"
    | "above"
    | "expensive"
    | "unknown"
    | null;
  market_compset_size: number;
  market_p25_eur_sqm: number | null;
  market_median_eur_sqm: number | null;
  market_p75_eur_sqm: number | null;
};

const PROPERTY_TYPES = [
  "apartment", "house", "villa", "maisonette", "studio",
  "townhouse", "penthouse", "bungalow", "land", "commercial",
];

const FURNISHING = [
  { value: "furnished", label: "Möbliert" },
  { value: "semi_furnished", label: "Teilmöbliert" },
  { value: "unfurnished", label: "Unmöbliert" },
];

const ENERGY_CLASSES = ["A+", "A", "B", "C", "D", "E", "F", "G"];

const FEATURE_OPTIONS: { value: string; label: string }[] = [
  { value: "parking", label: "Parkplatz" },
  { value: "covered_parking", label: "Garage" },
  { value: "pool", label: "Pool" },
  { value: "garden", label: "Garten" },
  { value: "balcony", label: "Balkon" },
  { value: "terrace", label: "Terrasse" },
  { value: "elevator", label: "Aufzug" },
  { value: "air_conditioning", label: "Klimaanlage" },
  { value: "solar", label: "Solar" },
  { value: "sea_view", label: "Meerblick" },
  { value: "mountain_view", label: "Bergblick" },
  { value: "storage", label: "Abstellraum" },
  { value: "fireplace", label: "Kamin" },
  { value: "jacuzzi", label: "Jacuzzi" },
  { value: "gym", label: "Fitnessraum" },
  { value: "smart_home", label: "Smart Home" },
  { value: "accessible", label: "Barrierefrei" },
];

type FormState = Partial<EditableListing>;

export function ListingEditor({ initial }: { initial: EditableListing }) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>({});
  const [media, setMedia] = React.useState<string[]>(initial.media ?? []);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  // Hilfs-Setter: nur Diff zum Original speichern, NULL erlaubt
  const set = <K extends keyof EditableListing>(
    key: K,
    value: EditableListing[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const get = <K extends keyof EditableListing>(key: K): EditableListing[K] => {
    if (key in form) return form[key] as EditableListing[K];
    return initial[key];
  };

  const features = (get("features") ?? []) as string[];
  const toggleFeature = (value: string) => {
    const next = features.includes(value)
      ? features.filter((f) => f !== value)
      : [...features, value];
    set("features", next);
  };

  // Mehrfach-Upload: PhotoDropZone ruft onUploaded pro fertigem File.
  // Wir aktualisieren media[] mit functional state-update + 400ms-Debounce
  // für ein einziges DB-Write am Ende.
  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistMediaRef = React.useRef<string[] | null>(null);

  // Persistierung via atomarem RPC set_listing_media (Migration 0040).
  // Synchronisiert listings.media[] UND listing_photos (Position + Existenz) in
  // einem Roundtrip — sonst war Editor-Reorder/Delete im Public-View unsichtbar,
  // weil public-listing.ts bevorzugt aus listing_photos liest.
  function schedulePersistMedia(next: string[]) {
    persistMediaRef.current = next;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      const toSave = persistMediaRef.current;
      if (!toSave) return;
      persistMediaRef.current = null;
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("set_listing_media", {
        p_listing_id: initial.id,
        p_media: toSave,
      });
      if (error) setError(error.message);
      else router.refresh(); // Public-Vorschau nachzieht (Server-Comp re-rendert)
    }, 400);
  }

  function appendMedia(m: { url: string; name: string; isVideo: boolean }) {
    setError(null);
    setMedia((prev) => {
      const next = Array.from(new Set([...prev, m.url]));
      schedulePersistMedia(next);
      return next;
    });
  }

  // Bild-Reihenfolge ändern. media[0] ist Cover — moveMedia(idx, 0) macht das
  // gewählte Bild zum Cover. Drag-and-Drop (Desktop) und Buttons (alle Devices).
  function moveMedia(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx || toIdx < 0) return;
    setMedia((prev) => {
      if (fromIdx >= prev.length || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      schedulePersistMedia(next);
      return next;
    });
  }

  const [dragIdx, setDragIdx] = React.useState<number | null>(null);

  async function removeMedia(url: string) {
    setError(null);
    setBusy(`media-remove-${url}`);
    const supabase = createSupabaseBrowserClient();
    let next: string[] = [];
    setMedia((prev) => {
      next = prev.filter((m) => m !== url);
      return next;
    });
    // RPC statt direktem update — räumt auch listing_photos auf, sonst
    // bleibt das gelöschte Bild im Public-View sichtbar.
    const { error } = await supabase.rpc("set_listing_media", {
      p_listing_id: initial.id,
      p_media: next,
    });
    setBusy(null);
    if (error) setError(error.message);
    else router.refresh();
  }

  async function save() {
    if (Object.keys(form).length === 0) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/listings/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail ?? detail.error ?? `Fehler ${res.status}`);
        return;
      }
      setForm({});
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Netzwerkfehler");
    } finally {
      setBusy(null);
    }
  }

  const dirty = Object.keys(form).length > 0;

  return (
    <div className="space-y-6">
      {/* Vorschau-Link → so sieht es für Suchende aus */}
      <Link
        href={`/listings/${initial.id}?from=edit`}
        // Bewusst KEIN target="_blank" — sonst sammelt jeder Vorschau-Klick
        // einen neuen Tab an. Public-Page rendert per ?from=edit den Back-
        // Link „Zurück zur Bearbeitung" → Browser-Back funktioniert sauber.
        className="flex items-center justify-between rounded-xl border bg-emerald-50/60 hover:bg-emerald-50 transition-colors px-4 py-3"
      >
        <div className="flex items-center gap-2 text-sm">
          <Eye className="size-4 text-emerald-700" />
          <span>
            <strong>Vorschau:</strong> So sieht das Inserat für Suchende aus
          </span>
        </div>
        <span className="text-xs text-emerald-700 underline">Öffnen ↗</span>
      </Link>

      {/* Sophie-Vision: alle Felder auto-befüllen */}
      <AnalyzeWithSophieButton
        listingId={initial.id}
        hasMedia={media.length > 0}
        alreadyAnalyzed={Boolean(initial.ai_analyzed_at)}
      />

      {/* Bilder + Videos */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Bilder & Videos ({media.length})</h2>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            Ziehen oder Pfeile zum Sortieren · ⭐ = Cover
          </span>
        </div>

        {media.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {media.map((url, idx) => {
              const isVideo = /\.(mp4|mov|webm)$/i.test(url);
              const isCover = idx === 0;
              const isFirst = idx === 0;
              const isLast = idx === media.length - 1;
              return (
                <div
                  key={url}
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(idx);
                    e.dataTransfer.effectAllowed = "move";
                    // Hint-Text als drag-image (Browser zeigt das Element selbst)
                    e.dataTransfer.setData("text/plain", String(idx));
                  }}
                  onDragOver={(e) => {
                    if (dragIdx === null || dragIdx === idx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx === null || dragIdx === idx) return;
                    moveMedia(dragIdx, idx);
                    setDragIdx(null);
                  }}
                  onDragEnd={() => setDragIdx(null)}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-md border bg-[var(--muted)] transition-all",
                    "cursor-move",
                    dragIdx === idx && "opacity-40 scale-95",
                    dragIdx !== null && dragIdx !== idx && "ring-2 ring-transparent hover:ring-emerald-500",
                  )}
                >
                  {isCover && (
                    <span className="absolute top-1 left-1 z-10 rounded bg-emerald-600/90 backdrop-blur px-1.5 py-0.5 text-[9px] font-semibold text-white flex items-center gap-0.5">
                      <Star className="size-2.5 fill-current" /> Cover
                    </span>
                  )}
                  {isVideo ? (
                    /* eslint-disable-next-line jsx-a11y/media-has-caption */
                    <video src={url} className="h-full w-full object-cover pointer-events-none" muted playsInline />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={url} alt="" className="h-full w-full object-cover pointer-events-none" loading="lazy" />
                  )}

                  {/* Reorder-Buttons unten — immer leicht sichtbar, voll auf Hover */}
                  <div className="absolute bottom-1 left-1 right-1 flex justify-between gap-1 opacity-70 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveMedia(idx, idx - 1);
                      }}
                      disabled={isFirst}
                      className="size-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black disabled:opacity-30 disabled:cursor-not-allowed pointer-events-auto"
                      aria-label="Nach links verschieben"
                    >
                      <ArrowLeft className="size-3" />
                    </button>
                    {!isCover && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveMedia(idx, 0);
                        }}
                        className="size-6 rounded-full bg-emerald-600/90 text-white flex items-center justify-center hover:bg-emerald-700 pointer-events-auto"
                        aria-label="Als Cover setzen"
                        title="Als Cover setzen"
                      >
                        <Star className="size-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveMedia(idx, idx + 1);
                      }}
                      disabled={isLast}
                      className="size-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black disabled:opacity-30 disabled:cursor-not-allowed pointer-events-auto"
                      aria-label="Nach rechts verschieben"
                    >
                      <ArrowRight className="size-3" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeMedia(url);
                    }}
                    disabled={busy === `media-remove-${url}`}
                    className="absolute top-1 right-1 size-6 rounded-full bg-black/70 text-white flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    aria-label="Bild entfernen"
                  >
                    {busy === `media-remove-${url}` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <PhotoDropZone onUploaded={appendMedia} />
      </section>

      {/* Quick-Facts */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--muted-foreground)]" />
          <h2 className="text-sm font-semibold">Eckdaten</h2>
        </div>

        <Field label="Titel">
          <Input
            value={(get("title") as string) ?? ""}
            onChange={(e) => set("title", e.target.value || null)}
            placeholder="z. B. Modernes 2-Zi-Apartment mit Meerblick in Limassol"
            maxLength={160}
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
          <Field label="Immobilien-Art">
            <select
              value={(get("property_type") as string) ?? ""}
              onChange={(e) => set("property_type", e.target.value || null)}
              className="h-10 w-full rounded-md border bg-[var(--background)] px-3 text-sm"
            >
              <option value="">— wählen —</option>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Stadt">
            <Input
              value={(get("location_city") as string) ?? ""}
              onChange={(e) => set("location_city", e.target.value)}
            />
          </Field>
          <Field label="Bezirk">
            <Input
              value={(get("location_district") as string) ?? ""}
              onChange={(e) => set("location_district", e.target.value || null)}
              placeholder="z. B. Germasogeia"
            />
          </Field>
        </div>

        <Field label="Vollständige Adresse (Straße + Hausnummer + PLZ)">
          <Input
            value={(get("location_address") as string) ?? ""}
            onChange={(e) => set("location_address", e.target.value || null)}
            placeholder="z. B. Prenzlauer Allee 123, 10409 Berlin – Prenzlauer Berg"
            maxLength={240}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label={get("type") === "sale" ? "Kaufpreis (€)" : "Miete (€)"}>
            <Input
              type="number"
              value={(get("price") as number | undefined) ?? ""}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                set("price", Number.isFinite(n) ? n : (initial.price as number));
              }}
              min={0}
            />
          </Field>
          <Field label="Kaution (€)">
            <Input
              type="number"
              value={(get("deposit") as number | null) ?? ""}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                set("deposit", Number.isFinite(n) ? n : null);
              }}
              min={0}
              placeholder="z. B. 2 × Miete"
            />
          </Field>
          {get("type") === "rent" && (
            <Field label="Service-Charge / Mt. (€)">
              <Input
                type="number"
                value={(get("service_charge_monthly") as number | null) ?? ""}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  set("service_charge_monthly", Number.isFinite(n) ? n : null);
                }}
                min={0}
                placeholder="Pool/Aufzug"
              />
            </Field>
          )}
        </div>

        <Field label="Verfügbar ab">
          <Input
            type="date"
            value={((get("available_from") as string) ?? "").slice(0, 10)}
            onChange={(e) => set("available_from", e.target.value || null)}
          />
        </Field>

        <MarketHint
          position={initial.market_position}
          pricePerSqm={initial.price_per_sqm}
          median={initial.market_median_eur_sqm}
          p25={initial.market_p25_eur_sqm}
          p75={initial.market_p75_eur_sqm}
          compsetSize={initial.market_compset_size}
        />

        {get("type") === "rent" && (
          <ContractTermEditor get={get} set={set} />
        )}

        {get("type") === "rent" && <UtilitiesEditor get={get} set={set} />}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Zimmer">
            <Input
              type="number"
              value={(get("rooms") as number | undefined) ?? ""}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                set("rooms", Number.isFinite(n) ? n : null);
              }}
              min={0}
              max={20}
            />
          </Field>
          <Field label="Bäder">
            <Input
              type="number"
              value={(get("bathrooms") as number | undefined) ?? ""}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                set("bathrooms", Number.isFinite(n) ? n : null);
              }}
              min={0}
              max={20}
            />
          </Field>
          <Field label="Wohnfläche (m²)">
            <Input
              type="number"
              value={(get("size_sqm") as number | undefined) ?? ""}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                set("size_sqm", Number.isFinite(n) ? n : null);
              }}
              min={0}
            />
          </Field>
        </div>

        <Field label="Möbliert">
          <div className="flex gap-2 flex-wrap">
            {FURNISHING.map((f) => {
              const active = get("furnishing") === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() =>
                    set(
                      "furnishing",
                      (active ? null : f.value) as EditableListing["furnishing"]
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    active
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                      : "bg-[var(--background)] hover:bg-[var(--accent)]"
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </Field>
      </section>

      {/* Beschreibung */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Beschreibung</h2>
        <Textarea
          value={(get("description") as string) ?? ""}
          onChange={(e) => set("description", e.target.value || null)}
          placeholder="Lage, Beschaffenheit, Ausstattung. Sophie kann das später automatisch generieren — du kannst hier korrigieren."
          rows={6}
          maxLength={8000}
        />
      </section>

      {/* Features / Ausstattung */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Ausstattung</h2>
        <div className="flex flex-wrap gap-2">
          {FEATURE_OPTIONS.map((f) => {
            const active = features.includes(f.value);
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => toggleFeature(f.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs flex items-center gap-1",
                  active
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                    : "bg-[var(--background)] hover:bg-[var(--accent)]"
                )}
              >
                {active && <Check className="size-3" />}
                {f.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Profi-Modus */}
      <section className="border-t pt-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          Profi-Modus {showAdvanced ? "ausblenden" : "öffnen"}
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Etage">
                <Input
                  value={(get("floor") as string) ?? ""}
                  onChange={(e) => set("floor", e.target.value || null)}
                  placeholder="z. B. 2nd, ground, top"
                />
              </Field>
              <Field label="Baujahr">
                <Input
                  type="number"
                  value={(get("year_built") as number | undefined) ?? ""}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    set("year_built", Number.isFinite(n) ? n : null);
                  }}
                  min={1800}
                  max={2100}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Grundstück (m²)">
                <Input
                  type="number"
                  value={(get("plot_sqm") as number | undefined) ?? ""}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    set("plot_sqm", Number.isFinite(n) ? n : null);
                  }}
                />
              </Field>
              <Field label="Energie-Klasse">
                <select
                  value={(get("energy_class") as string) ?? ""}
                  onChange={(e) => set("energy_class", e.target.value || null)}
                  className="h-10 w-full rounded-md border bg-[var(--background)] px-3 text-sm"
                >
                  <option value="">—</option>
                  {ENERGY_CLASSES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Haustiere erlaubt">
              <div className="flex gap-2">
                {[
                  { v: true, l: "Ja" },
                  { v: false, l: "Nein" },
                  { v: null, l: "—" },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    onClick={() => set("pets_allowed", o.v as boolean | null)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      get("pets_allowed") === o.v
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                        : "bg-[var(--background)]"
                    )}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kontakt-Kanal">
                <Input
                  value={(get("contact_channel") as string) ?? ""}
                  onChange={(e) => set("contact_channel", e.target.value || null)}
                  placeholder="email | whatsapp | phone"
                />
              </Field>
              <Field label="Sprache">
                <select
                  value={(get("language") as string) ?? ""}
                  onChange={(e) =>
                    set("language", (e.target.value || null) as EditableListing["language"])
                  }
                  className="h-10 w-full rounded-md border bg-[var(--background)] px-3 text-sm"
                >
                  <option value="">—</option>
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                  <option value="ru">Русский</option>
                  <option value="el">Ελληνικά</option>
                </select>
              </Field>
            </div>
            <Field label="Status">
              <select
                value={get("status") as string}
                onChange={(e) =>
                  set("status", e.target.value as EditableListing["status"])
                }
                className="h-10 w-full rounded-md border bg-[var(--background)] px-3 text-sm"
              >
                <option value="active">aktiv (sichtbar)</option>
                <option value="rented">vermietet</option>
                <option value="sold">verkauft</option>
                <option value="stale">verfügbarkeit unklar</option>
                <option value="archived">archiviert</option>
                <option value="opted_out">nicht auf Home4U zeigen</option>
              </select>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
                Auf „aktiv" setzen reaktiviert das Inserat — es taucht wieder
                in Suchen auf.
              </p>
            </Field>
            <div className="border-t pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
                Externe Assets
              </h3>
              <div className="space-y-2">
                <Field label="Grundriss-URL (PDF/Bild)">
                  <Input
                    type="url"
                    value={(get("floorplan_url") as string) ?? ""}
                    onChange={(e) => set("floorplan_url", e.target.value || null)}
                    placeholder="https://…"
                  />
                </Field>
                <Field label="3D-Tour-URL (Matterport o. ä.)">
                  <Input
                    type="url"
                    value={(get("tour_3d_url") as string) ?? ""}
                    onChange={(e) => set("tour_3d_url", e.target.value || null)}
                    placeholder="https://…"
                  />
                </Field>
                <Field label="Video-URL (YouTube/Vimeo)">
                  <Input
                    type="url"
                    value={(get("video_url") as string) ?? ""}
                    onChange={(e) => set("video_url", e.target.value || null)}
                    placeholder="https://…"
                  />
                </Field>
              </div>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800 flex items-start gap-2">
          <X className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="border-t pt-4 flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
        <DeleteRecordButton
          endpoint={`/api/listings/${initial.id}`}
          redirectTo="/dashboard?view=provider"
          what="Dieses Inserat"
        />
        <div className="flex items-center gap-2">
          {savedAt && !dirty && (
            <span className="text-xs text-emerald-700 flex items-center gap-1">
              <Check className="size-3" /> Gespeichert
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

// ---------- Utilities-Editor (Cyprus-Modell) ----------

const UTILITY_OPTIONS = [
  { value: "tenant_pays", label: "Mieter zahlt" },
  { value: "included", label: "inklusive" },
  { value: "landlord_pays", label: "Vermieter zahlt" },
  { value: "estimated", label: "geschätzt" },
];
const INTERNET_OPTIONS = [
  { value: "tenant_pays", label: "Mieter zahlt" },
  { value: "included", label: "inklusive" },
  { value: "landlord_pays", label: "Vermieter zahlt" },
  { value: "not_provided", label: "nicht vorhanden" },
];

function UtilitiesEditor({
  get,
  set,
}: {
  get: <K extends keyof EditableListing>(key: K) => EditableListing[K];
  set: <K extends keyof EditableListing>(key: K, value: EditableListing[K]) => void;
}) {
  const u = (get("utilities") as Utilities) ?? {};

  function update<K extends keyof Utilities>(key: K, value: Utilities[K]) {
    set("utilities", { ...u, [key]: value } as EditableListing["utilities"]);
  }

  return (
    <div className="rounded-lg border bg-[var(--accent)]/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Nebenkosten</h3>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          Strom · Wasser · Internet · Verträge
        </span>
      </div>

      <UtilityRow
        label="Strom"
        value={u.electricity ?? null}
        options={UTILITY_OPTIONS}
        onChange={(v) => update("electricity", v as UtilityArrangement)}
      />
      <UtilityRow
        label="Wasser"
        value={u.water ?? null}
        options={UTILITY_OPTIONS}
        onChange={(v) => update("water", v as UtilityArrangement)}
      />
      <UtilityRow
        label="Internet"
        value={u.internet ?? null}
        options={INTERNET_OPTIONS}
        onChange={(v) => update("internet", v as UtilityArrangement)}
      />
      <UtilityRow
        label="Müll"
        value={u.garbage ?? null}
        options={UTILITY_OPTIONS}
        onChange={(v) => update("garbage", v as UtilityArrangement)}
      />

      <Field label="Geschätzte Nebenkosten / Monat (€)">
        <Input
          type="number"
          value={u.estimated_monthly_total ?? ""}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            update("estimated_monthly_total", Number.isFinite(n) ? n : null);
          }}
          min={0}
          placeholder="z. B. 80–120 € — Strom + Wasser + Internet zusammen"
        />
      </Field>

      <Field label="Verträge">
        <div className="flex flex-wrap gap-2">
          {[
            { v: true, l: "Mieter meldet eigene Verträge an" },
            { v: false, l: "Verträge laufen über Vermieter" },
            { v: null, l: "noch offen" },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => update("bills_in_tenant_name", o.v as boolean | null)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                u.bills_in_tenant_name === o.v
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                  : "bg-[var(--background)] hover:bg-[var(--accent)]"
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Notizen / Besonderheiten">
        <Input
          value={u.notes ?? ""}
          onChange={(e) => update("notes", e.target.value || null)}
          placeholder="z. B. Solar-Boiler, kein Klimaanlagen-Stromverbrauch im Sommer"
          maxLength={500}
        />
      </Field>
    </div>
  );
}

// ---------- Contract-Term-Editor ----------

const CONTRACT_OPTIONS = [
  { value: 6, label: "6 Monate" },
  { value: 12, label: "1 Jahr" },
  { value: 24, label: "2 Jahre" },
  { value: 0, label: "flexibel / kurzfristig" },
];

function ContractTermEditor({
  get,
  set,
}: {
  get: <K extends keyof EditableListing>(key: K) => EditableListing[K];
  set: <K extends keyof EditableListing>(key: K, value: EditableListing[K]) => void;
}) {
  const months = get("contract_min_months") as number | null;
  const notes = (get("contract_notes") as string | null) ?? "";

  return (
    <div className="rounded-lg border bg-[var(--accent)]/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Mietvertrag</h3>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          CY-üblich: 1-Jahres-Vertrag
        </span>
      </div>

      <Field label="Mindestlaufzeit">
        <div className="flex flex-wrap gap-2">
          {CONTRACT_OPTIONS.map((o) => {
            const active = months === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() =>
                  set("contract_min_months", active ? null : o.value)
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  active
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                    : "bg-[var(--background)] hover:bg-[var(--accent)]"
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Hinweise zum Vertrag">
        <Input
          value={notes}
          onChange={(e) => set("contract_notes", e.target.value || null)}
          placeholder="z. B. '1+1 mit Verlängerungsoption', 'Kündigung 1 Monat zum Monatsende'"
          maxLength={500}
        />
      </Field>
    </div>
  );
}

function UtilityRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium w-16 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(value === o.value ? null : o.value)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px]",
              value === o.value
                ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                : "bg-[var(--background)] hover:bg-[var(--accent)]"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
