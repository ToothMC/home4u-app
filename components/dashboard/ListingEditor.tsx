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
import { useT } from "@/lib/i18n/client";
import type { T, TKey } from "@/lib/i18n/dict";

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

const FURNISHING: Array<{ value: string; key: TKey }> = [
  { value: "furnished", key: "furnishing.furnished" },
  { value: "semi_furnished", key: "furnishing.semi_furnished" },
  { value: "unfurnished", key: "furnishing.unfurnished" },
];

const ENERGY_CLASSES = ["A+", "A", "B", "C", "D", "E", "F", "G"];

const FEATURE_OPTIONS: Array<{ value: string; key: TKey }> = [
  { value: "parking", key: "feature.parking" },
  { value: "covered_parking", key: "feature.covered_parking" },
  { value: "pool", key: "feature.pool" },
  { value: "garden", key: "feature.garden" },
  { value: "balcony", key: "feature.balcony" },
  { value: "terrace", key: "feature.terrace" },
  { value: "elevator", key: "feature.elevator" },
  { value: "air_conditioning", key: "feature.air_conditioning" },
  { value: "solar", key: "feature.solar" },
  { value: "sea_view", key: "feature.sea_view" },
  { value: "mountain_view", key: "feature.mountain_view" },
  { value: "storage", key: "feature.storage" },
  { value: "fireplace", key: "feature.fireplace" },
  { value: "jacuzzi", key: "feature.jacuzzi" },
  { value: "gym", key: "feature.gym" },
  { value: "smart_home", key: "feature.smart_home" },
  { value: "accessible", key: "feature.accessible" },
];

const PROPERTY_TYPE_KEY: Record<string, TKey> = {
  apartment: "property.apartment",
  house: "property.house",
  villa: "property.villa",
  maisonette: "property.maisonette",
  studio: "property.studio",
  townhouse: "property.townhouse",
  penthouse: "property.penthouse",
  bungalow: "property.bungalow",
  land: "property.land",
  commercial: "property.commercial",
};

type FormState = Partial<EditableListing>;

const ROOM_TYPES = [
  "living",
  "kitchen",
  "bedroom",
  "bathroom",
  "balcony",
  "terrace",
  "exterior",
  "view",
  "garden",
  "pool",
  "parking",
  "hallway",
  "utility",
  "other",
] as const;

type RoomType = (typeof ROOM_TYPES)[number];

const ROOM_TYPE_LABEL_KEY: Record<RoomType, TKey> = {
  living: "room.living",
  kitchen: "room.kitchen",
  bedroom: "room.bedroom",
  bathroom: "room.bathroom",
  balcony: "room.balcony",
  terrace: "room.terrace",
  exterior: "room.exterior",
  view: "room.view",
  garden: "room.garden",
  pool: "room.pool",
  parking: "room.parking",
  hallway: "room.hallway",
  utility: "room.utility",
  other: "room.other",
};

export function ListingEditor({
  initial,
  roomTypeByUrl,
}: {
  initial: EditableListing;
  roomTypeByUrl?: Record<string, string | null>;
}) {
  const router = useRouter();
  const { t } = useT();
  const [form, setForm] = React.useState<FormState>({});
  const [media, setMedia] = React.useState<string[]>(initial.media ?? []);
  const [roomTypes, setRoomTypes] = React.useState<Record<string, string | null>>(
    roomTypeByUrl ?? {}
  );
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

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

  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistMediaRef = React.useRef<string[] | null>(null);

  function schedulePersistMedia(next: string[]) {
    persistMediaRef.current = next;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      const toSave = persistMediaRef.current;
      if (!toSave) return;
      // Schutz: schedule-Pfad darf NIE clearen (nur appendMedia/moveMedia
      // rufen schedule). Leeres Array hier wäre Race/Bug → ignorieren.
      if (toSave.length === 0) {
        persistMediaRef.current = null;
        return;
      }
      persistMediaRef.current = null;
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("set_listing_media", {
        p_listing_id: initial.id,
        p_media: toSave,
      });
      if (error) setError(error.message);
      else router.refresh();
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

  async function setRoomType(url: string, value: string) {
    const next = value || null;
    setError(null);
    setRoomTypes((prev) => ({ ...prev, [url]: next }));
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.rpc("update_listing_photo_room_type", {
      p_listing_id: initial.id,
      p_url: url,
      p_room_type: next,
    });
    if (error) setError(error.message);
    else router.refresh();
  }

  async function removeMedia(url: string) {
    // Letztes Bild → Confirm. Verhindert versehentliches Lösch-Cascade,
    // außerdem braucht der RPC dann das p_allow_empty=true Flag.
    const isLast = media.length === 1 && media[0] === url;
    if (isLast) {
      const ok = window.confirm(t("listingEditor.media.confirmRemoveLast"));
      if (!ok) return;
    }
    setError(null);
    setBusy(`media-remove-${url}`);
    const supabase = createSupabaseBrowserClient();
    let next: string[] = [];
    setMedia((prev) => {
      next = prev.filter((m) => m !== url);
      return next;
    });
    const { error } = await supabase.rpc("set_listing_media", {
      p_listing_id: initial.id,
      p_media: next,
      p_allow_empty: next.length === 0,
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
        setError(detail.detail ?? detail.error ?? `${t("phone.reveal.errorPrefix")} ${res.status}`);
        return;
      }
      setForm({});
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("btn.networkError"));
    } finally {
      setBusy(null);
    }
  }

  const dirty = Object.keys(form).length > 0;

  return (
    <div className="space-y-6">
      <Link
        href={`/listings/${initial.id}?from=edit`}
        className="flex items-center justify-between rounded-xl border bg-emerald-50/60 hover:bg-emerald-50 transition-colors px-4 py-3"
      >
        <div className="flex items-center gap-2 text-sm">
          <Eye className="size-4 text-emerald-700" />
          <span>
            <strong>{t("listingEditor.preview.title")}</strong> {t("listingEditor.preview.subtitle")}
          </span>
        </div>
        <span className="text-xs text-emerald-700 underline">{t("listingEditor.preview.open")}</span>
      </Link>

      <AnalyzeWithSophieButton
        listingId={initial.id}
        hasMedia={media.length > 0}
        alreadyAnalyzed={Boolean(initial.ai_analyzed_at)}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("listingEditor.media.heading")} ({media.length})</h2>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {t("listingEditor.media.hint")}
          </span>
        </div>

        {media.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {media.map((url, idx) => {
              const isVideo = /\.(mp4|mov|webm)$/i.test(url);
              const isCover = idx === 0;
              const isFirst = idx === 0;
              const isLast = idx === media.length - 1;
              const currentRoom = roomTypes[url] ?? "";
              return (
                <div key={url} className="space-y-1">
                <div
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(idx);
                    e.dataTransfer.effectAllowed = "move";
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
                      <Star className="size-2.5 fill-current" /> {t("listingEditor.media.cover")}
                    </span>
                  )}
                  {isVideo ? (
                    /* eslint-disable-next-line jsx-a11y/media-has-caption */
                    <video src={url} className="h-full w-full object-cover pointer-events-none" muted playsInline />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={url} alt="" className="h-full w-full object-cover pointer-events-none" loading="lazy" />
                  )}

                  <div className="absolute bottom-1 left-1 right-1 flex justify-between gap-1 opacity-70 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveMedia(idx, idx - 1);
                      }}
                      disabled={isFirst}
                      className="size-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black disabled:opacity-30 disabled:cursor-not-allowed pointer-events-auto"
                      aria-label={t("listingEditor.media.moveLeft")}
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
                        aria-label={t("listingEditor.media.makeCover")}
                        title={t("listingEditor.media.makeCover")}
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
                      aria-label={t("listingEditor.media.moveRight")}
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
                    aria-label={t("listingEditor.media.remove")}
                  >
                    {busy === `media-remove-${url}` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                  </button>
                </div>
                <select
                  value={currentRoom}
                  onChange={(e) => setRoomType(url, e.target.value)}
                  className={cn(
                    "h-7 w-full rounded border bg-[var(--background)] px-1 text-[10px]",
                    !currentRoom && "text-[var(--muted-foreground)] italic"
                  )}
                  aria-label={t("listingEditor.media.roomType")}
                  title={t("listingEditor.media.roomTypeHint")}
                >
                  <option value="">— {t("listingEditor.media.roomNone")} —</option>
                  {ROOM_TYPES.map((rt) => (
                    <option key={rt} value={rt}>
                      {t(ROOM_TYPE_LABEL_KEY[rt])}
                    </option>
                  ))}
                </select>
                </div>
              );
            })}
          </div>
        )}

        <PhotoDropZone onUploaded={appendMedia} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--muted-foreground)]" />
          <h2 className="text-sm font-semibold">{t("listingEditor.facts")}</h2>
        </div>

        <Field label={t("listingEditor.title")}>
          <Input
            value={(get("title") as string) ?? ""}
            onChange={(e) => set("title", e.target.value || null)}
            placeholder={t("listingEditor.titlePlaceholder")}
            maxLength={160}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("searchEditor.type")}>
            <select
              value={get("type") as string}
              onChange={(e) => set("type", e.target.value as "rent" | "sale")}
              className="h-10 w-full rounded-md border bg-[var(--background)] px-3 text-sm"
            >
              <option value="rent">{t("searchEditor.type.rent")}</option>
              <option value="sale">{t("searchEditor.type.sale")}</option>
            </select>
          </Field>
          <Field label={t("listingEditor.propertyType")}>
            <select
              value={(get("property_type") as string) ?? ""}
              onChange={(e) => set("property_type", e.target.value || null)}
              className="h-10 w-full rounded-md border bg-[var(--background)] px-3 text-sm"
            >
              <option value="">{t("listingEditor.propertyTypeChoose")}</option>
              {PROPERTY_TYPES.map((p) => (
                <option key={p} value={p}>
                  {PROPERTY_TYPE_KEY[p] ? t(PROPERTY_TYPE_KEY[p]) : p}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("listingEditor.city")}>
            <Input
              value={(get("location_city") as string) ?? ""}
              onChange={(e) => set("location_city", e.target.value)}
            />
          </Field>
          <Field label={t("listingEditor.district")}>
            <Input
              value={(get("location_district") as string) ?? ""}
              onChange={(e) => set("location_district", e.target.value || null)}
              placeholder={t("listingEditor.districtPlaceholder")}
            />
          </Field>
        </div>

        <Field label={t("listingEditor.address")}>
          <Input
            value={(get("location_address") as string) ?? ""}
            onChange={(e) => set("location_address", e.target.value || null)}
            placeholder={t("listingEditor.addressPlaceholder")}
            maxLength={240}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label={get("type") === "sale" ? t("listingEditor.priceSale") : t("listingEditor.priceRent")}>
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
          <Field label={t("listingEditor.depositLabel")}>
            <Input
              type="number"
              value={(get("deposit") as number | null) ?? ""}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                set("deposit", Number.isFinite(n) ? n : null);
              }}
              min={0}
              placeholder={t("listingEditor.depositPlaceholder")}
            />
          </Field>
          {get("type") === "rent" && (
            <Field label={t("listingEditor.serviceChargeLabel")}>
              <Input
                type="number"
                value={(get("service_charge_monthly") as number | null) ?? ""}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  set("service_charge_monthly", Number.isFinite(n) ? n : null);
                }}
                min={0}
                placeholder={t("listingEditor.serviceChargePlaceholder")}
              />
            </Field>
          )}
        </div>

        <Field label={t("listingEditor.availableFrom")}>
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

        {get("type") === "rent" && <ContractTermEditor get={get} set={set} t={t} />}

        {get("type") === "rent" && <UtilitiesEditor get={get} set={set} t={t} />}

        <div className="grid grid-cols-3 gap-3">
          <Field label={t("searchEditor.rooms")}>
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
          <Field label={t("listingEditor.bathrooms")}>
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
          <Field label={t("listingEditor.size")}>
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

        <Field label={t("listingEditor.furnishing")}>
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
                  {t(f.key)}
                </button>
              );
            })}
          </div>
        </Field>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("listingEditor.descriptionHeading")}</h2>
        <Textarea
          value={(get("description") as string) ?? ""}
          onChange={(e) => set("description", e.target.value || null)}
          placeholder={t("listingEditor.descriptionPlaceholder")}
          rows={6}
          maxLength={8000}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("listingEditor.featuresHeading")}</h2>
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
                {t(f.key)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-t pt-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {showAdvanced ? t("listingEditor.advancedClose") : t("listingEditor.advancedOpen")}
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("listingEditor.floor")}>
                <Input
                  value={(get("floor") as string) ?? ""}
                  onChange={(e) => set("floor", e.target.value || null)}
                  placeholder={t("listingEditor.floorPlaceholder")}
                />
              </Field>
              <Field label={t("listingEditor.yearBuilt")}>
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
              <Field label={t("listingEditor.plotSqm")}>
                <Input
                  type="number"
                  value={(get("plot_sqm") as number | undefined) ?? ""}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    set("plot_sqm", Number.isFinite(n) ? n : null);
                  }}
                />
              </Field>
              <Field label={t("listingEditor.energyClass")}>
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
            <Field label={t("listingEditor.petsAllowed")}>
              <div className="flex gap-2">
                {[
                  { v: true, l: t("searchEditor.pets.yes") },
                  { v: false, l: t("searchEditor.pets.no") },
                  { v: null, l: t("searchEditor.pets.dontCare") },
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
              <Field label={t("listingEditor.contactChannel")}>
                <Input
                  value={(get("contact_channel") as string) ?? ""}
                  onChange={(e) => set("contact_channel", e.target.value || null)}
                  placeholder="email | whatsapp | phone"
                />
              </Field>
              <Field label={t("listingEditor.language")}>
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
                  <option value="zh">中文</option>
                </select>
              </Field>
            </div>
            <Field label={t("searchEditor.statusLabel")}>
              <select
                value={get("status") as string}
                onChange={(e) =>
                  set("status", e.target.value as EditableListing["status"])
                }
                className="h-10 w-full rounded-md border bg-[var(--background)] px-3 text-sm"
              >
                <option value="active">{t("listingEditor.statusActive")}</option>
                <option value="reserved">{t("listingEditor.statusReserved")}</option>
                <option value="rented">{t("listingEditor.statusRented")}</option>
                <option value="sold">{t("listingEditor.statusSold")}</option>
                <option value="stale">{t("listingEditor.statusStale")}</option>
                <option value="archived">{t("listingEditor.statusArchived")}</option>
                <option value="opted_out">{t("listingEditor.statusOptedOut")}</option>
              </select>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
                {t("listingEditor.statusReactivateHint")}
              </p>
            </Field>
            <div className="border-t pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
                {t("listingEditor.externalAssets")}
              </h3>
              <div className="space-y-2">
                <Field label={t("listingEditor.floorplanUrl")}>
                  <Input
                    type="url"
                    value={(get("floorplan_url") as string) ?? ""}
                    onChange={(e) => set("floorplan_url", e.target.value || null)}
                    placeholder="https://…"
                  />
                </Field>
                <Field label={t("listingEditor.tour3dUrl")}>
                  <Input
                    type="url"
                    value={(get("tour_3d_url") as string) ?? ""}
                    onChange={(e) => set("tour_3d_url", e.target.value || null)}
                    placeholder="https://…"
                  />
                </Field>
                <Field label={t("listingEditor.videoUrl")}>
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
          what={t("listingEditor.deleteWhat")}
        />
        <div className="flex items-center gap-2">
          {savedAt && !dirty && (
            <span className="text-xs text-emerald-700 flex items-center gap-1">
              <Check className="size-3" /> {t("searchEditor.saved")}
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

function UtilitiesEditor({
  get,
  set,
  t,
}: {
  get: <K extends keyof EditableListing>(key: K) => EditableListing[K];
  set: <K extends keyof EditableListing>(key: K, value: EditableListing[K]) => void;
  t: T;
}) {
  const u = (get("utilities") as Utilities) ?? {};
  const utilityOptions: Array<{ value: string; key: TKey }> = [
    { value: "tenant_pays", key: "utilities.tenantPays" },
    { value: "included", key: "utilities.included" },
    { value: "landlord_pays", key: "utilities.landlordPays" },
    { value: "estimated", key: "utilities.estimated" },
  ];
  const internetOptions: Array<{ value: string; key: TKey }> = [
    { value: "tenant_pays", key: "utilities.tenantPays" },
    { value: "included", key: "utilities.included" },
    { value: "landlord_pays", key: "utilities.landlordPays" },
    { value: "not_provided", key: "utilities.notProvided" },
  ];

  function update<K extends keyof Utilities>(key: K, value: Utilities[K]) {
    set("utilities", { ...u, [key]: value } as EditableListing["utilities"]);
  }

  return (
    <div className="rounded-lg border bg-[var(--accent)]/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("listingEditor.utilities.heading")}</h3>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {t("listingEditor.utilities.hint")}
        </span>
      </div>

      <UtilityRow
        label={t("utilities.electricity")}
        value={u.electricity ?? null}
        options={utilityOptions}
        t={t}
        onChange={(v) => update("electricity", v as UtilityArrangement)}
      />
      <UtilityRow
        label={t("utilities.water")}
        value={u.water ?? null}
        options={utilityOptions}
        t={t}
        onChange={(v) => update("water", v as UtilityArrangement)}
      />
      <UtilityRow
        label={t("utilities.internet")}
        value={u.internet ?? null}
        options={internetOptions}
        t={t}
        onChange={(v) => update("internet", v as UtilityArrangement)}
      />
      <UtilityRow
        label={t("utilities.garbage")}
        value={u.garbage ?? null}
        options={utilityOptions}
        t={t}
        onChange={(v) => update("garbage", v as UtilityArrangement)}
      />

      <Field label={t("listingEditor.utilities.estimatedTotal")}>
        <Input
          type="number"
          value={u.estimated_monthly_total ?? ""}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            update("estimated_monthly_total", Number.isFinite(n) ? n : null);
          }}
          min={0}
          placeholder={t("listingEditor.utilities.estimatedPlaceholder")}
        />
      </Field>

      <Field label={t("listingEditor.utilities.contracts")}>
        <div className="flex flex-wrap gap-2">
          {[
            { v: true, l: t("listingEditor.utilities.tenantSelf") },
            { v: false, l: t("listingEditor.utilities.viaLandlord") },
            { v: null, l: t("listingEditor.utilities.tbd") },
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

      <Field label={t("listingEditor.utilities.notes")}>
        <Input
          value={u.notes ?? ""}
          onChange={(e) => update("notes", e.target.value || null)}
          placeholder={t("listingEditor.utilities.notesPlaceholder")}
          maxLength={500}
        />
      </Field>
    </div>
  );
}

function ContractTermEditor({
  get,
  set,
  t,
}: {
  get: <K extends keyof EditableListing>(key: K) => EditableListing[K];
  set: <K extends keyof EditableListing>(key: K, value: EditableListing[K]) => void;
  t: T;
}) {
  const months = get("contract_min_months") as number | null;
  const notes = (get("contract_notes") as string | null) ?? "";

  const contractOptions: Array<{ value: number; key: TKey }> = [
    { value: 6, key: "listingEditor.contract.term6m" },
    { value: 12, key: "listingEditor.contract.term1y" },
    { value: 24, key: "listingEditor.contract.term2y" },
    { value: 0, key: "listingEditor.contract.flexible" },
  ];

  return (
    <div className="rounded-lg border bg-[var(--accent)]/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("listingEditor.contract.heading")}</h3>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {t("listingEditor.contract.hint")}
        </span>
      </div>

      <Field label={t("facts.minTerm")}>
        <div className="flex flex-wrap gap-2">
          {contractOptions.map((o) => {
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
                {t(o.key)}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t("listingEditor.contract.notes")}>
        <Input
          value={notes}
          onChange={(e) => set("contract_notes", e.target.value || null)}
          placeholder={t("listingEditor.contract.notesPlaceholder")}
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
  t,
}: {
  label: string;
  value: string | null;
  options: Array<{ value: string; key: TKey }>;
  onChange: (v: string | null) => void;
  t: T;
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
            {t(o.key)}
          </button>
        ))}
      </div>
    </div>
  );
}
