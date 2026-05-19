import type { TKey } from "@/lib/i18n/dict";
import { CYPRUS_REGIONS, type CyprusRegion } from "@/lib/geo/cyprus-regions";

export const PROPERTY_TYPE_OPTIONS = [
  "apartment",
  "house",
  "villa",
  "penthouse",
  "maisonette",
  "townhouse",
  "studio",
  "bungalow",
  "plot",
  "commercial",
  "room",
] as const;
export type PropertyTypeOption = (typeof PROPERTY_TYPE_OPTIONS)[number];

export const FEATURE_OPTIONS = [
  "pool",
  "garden",
  "parking",
  "balcony",
  "terrace",
  "sea_view",
  "air_conditioning",
  "elevator",
  "fireplace",
  "solar",
  "smart_home",
  "storage",
  "accessible",
  "mountain_view",
] as const;
export type FeatureOption = (typeof FEATURE_OPTIONS)[number];

export const FURNISHING_OPTIONS = ["furnished", "semi", "unfurnished"] as const;
export type FurnishingOption = (typeof FURNISHING_OPTIONS)[number];

export const ENERGY_OPTIONS = ["A+", "A", "B", "C", "D", "E", "F", "G"] as const;
export type EnergyOption = (typeof ENERGY_OPTIONS)[number];

export const ROOM_OPTIONS = [1, 2, 3, 4, 5] as const;
export const ROOMS_PLUS_THRESHOLD = 5; // "5+" = >= 5

export type ListingType = "rent" | "sale";

export type BrowseFilters = {
  type: ListingType | null;
  region: CyprusRegion["slug"] | null;
  propertyTypes: PropertyTypeOption[];
  rooms: number[]; // empty = any; contains ROOMS_PLUS_THRESHOLD → ">=5"
  priceMin: number | null;
  priceMax: number | null;
  // Advanced
  bathroomsMin: number | null;
  sizeMin: number | null;
  sizeMax: number | null;
  furnishing: FurnishingOption | null;
  features: FeatureOption[];
  energyMin: EnergyOption | null;
  yearMin: number | null;
  petsAllowed: boolean;
  /** Default false → Anteils-Inserate (is_share=true) werden ausgeblendet,
   *  weil deren m² im Titel sich aufs ganze Grundstueck beziehen und der
   *  User irregefuehrt waere. Opt-in fuer Spekulanten via Toggle. */
  includeShares: boolean;
};

export const EMPTY_FILTERS: BrowseFilters = {
  type: null,
  region: null,
  propertyTypes: [],
  rooms: [],
  priceMin: null,
  priceMax: null,
  bathroomsMin: null,
  sizeMin: null,
  sizeMax: null,
  furnishing: null,
  features: [],
  energyMin: null,
  yearMin: null,
  petsAllowed: false,
  includeShares: false,
};

function parsePosInt(v: string | undefined | null): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCsv<T extends string>(
  v: string | undefined | null,
  allowed: readonly T[],
): T[] {
  if (!v) return [];
  const allowedSet = new Set<string>(allowed);
  const seen = new Set<T>();
  for (const part of v.split(",")) {
    const t = part.trim();
    if (allowedSet.has(t) && !seen.has(t as T)) seen.add(t as T);
  }
  return Array.from(seen);
}

function parseRoomsCsv(v: string | undefined | null): number[] {
  if (!v) return [];
  const out = new Set<number>();
  for (const part of v.split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n >= 1 && n <= ROOMS_PLUS_THRESHOLD) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function parseFiltersFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): BrowseFilters {
  const pick = (k: string) =>
    Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined);

  const type = pick("type");
  const region = pick("region");
  const furnishing = pick("furn");
  const energyMin = pick("energy");

  const validType: ListingType | null =
    type === "rent" || type === "sale" ? type : null;
  const validRegion =
    region && CYPRUS_REGIONS.some((r) => r.slug === region)
      ? (region as CyprusRegion["slug"])
      : null;
  const validFurnishing: FurnishingOption | null =
    furnishing && (FURNISHING_OPTIONS as readonly string[]).includes(furnishing)
      ? (furnishing as FurnishingOption)
      : null;
  const validEnergy: EnergyOption | null =
    energyMin && (ENERGY_OPTIONS as readonly string[]).includes(energyMin)
      ? (energyMin as EnergyOption)
      : null;

  return {
    type: validType,
    region: validRegion,
    propertyTypes: parseCsv(pick("pt"), PROPERTY_TYPE_OPTIONS),
    rooms: parseRoomsCsv(pick("rooms")),
    priceMin: parsePosInt(pick("pmin")),
    priceMax: parsePosInt(pick("pmax")),
    bathroomsMin: parsePosInt(pick("baths")),
    sizeMin: parsePosInt(pick("szmin")),
    sizeMax: parsePosInt(pick("szmax")),
    furnishing: validFurnishing,
    features: parseCsv(pick("feat"), FEATURE_OPTIONS),
    energyMin: validEnergy,
    yearMin: parsePosInt(pick("year")),
    petsAllowed: pick("pets") === "1",
    includeShares: pick("shares") === "1",
  };
}

/**
 * Serialisiert Filter → URLSearchParams. Defaults (null/leer/false) werden
 * weggelassen, damit die URL kurz bleibt und Default-State === leere URL ist.
 * `p` (Pagination) wird NICHT mit ausgegeben — wir resetten Pagination bei
 * jedem Filter-Wechsel auf Seite 1.
 */
export function serializeFilters(f: BrowseFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.type) sp.set("type", f.type);
  if (f.region) sp.set("region", f.region);
  if (f.propertyTypes.length) sp.set("pt", f.propertyTypes.join(","));
  if (f.rooms.length) sp.set("rooms", f.rooms.join(","));
  if (f.priceMin != null) sp.set("pmin", String(f.priceMin));
  if (f.priceMax != null) sp.set("pmax", String(f.priceMax));
  if (f.bathroomsMin != null) sp.set("baths", String(f.bathroomsMin));
  if (f.sizeMin != null) sp.set("szmin", String(f.sizeMin));
  if (f.sizeMax != null) sp.set("szmax", String(f.sizeMax));
  if (f.furnishing) sp.set("furn", f.furnishing);
  if (f.features.length) sp.set("feat", f.features.join(","));
  if (f.energyMin) sp.set("energy", f.energyMin);
  if (f.yearMin != null) sp.set("year", String(f.yearMin));
  if (f.petsAllowed) sp.set("pets", "1");
  if (f.includeShares) sp.set("shares", "1");
  return sp;
}

/**
 * Anzahl der gesetzten Filter — fürs "{n} aktiv"-Badge auf dem
 * "Mehr Filter"-Button. type/region/price/rooms/propertyType zählen
 * mit, advanced ebenfalls.
 */
export function countActiveFilters(f: BrowseFilters): number {
  let n = 0;
  if (f.type) n++;
  if (f.region) n++;
  if (f.propertyTypes.length) n++;
  if (f.rooms.length) n++;
  if (f.priceMin != null || f.priceMax != null) n++;
  if (f.bathroomsMin != null) n++;
  if (f.sizeMin != null || f.sizeMax != null) n++;
  if (f.furnishing) n++;
  if (f.features.length) n++;
  if (f.energyMin) n++;
  if (f.yearMin != null) n++;
  if (f.petsAllowed) n++;
  if (f.includeShares) n++;
  return n;
}

export function countAdvancedFilters(f: BrowseFilters): number {
  let n = 0;
  if (f.bathroomsMin != null) n++;
  if (f.sizeMin != null || f.sizeMax != null) n++;
  if (f.furnishing) n++;
  if (f.features.length) n++;
  if (f.energyMin) n++;
  if (f.yearMin != null) n++;
  if (f.petsAllowed) n++;
  if (f.includeShares) n++;
  return n;
}

export function propertyTypeKey(pt: PropertyTypeOption): TKey {
  return `property.${pt}` as TKey;
}

export function featureKey(feat: FeatureOption): TKey {
  return `filter.feature.${feat}` as TKey;
}

// === Supabase query application =============================================

// Furnishing-Spalte ist Freitext aus Crawlern in gemischten Sprachen/Casing
// ("Fully Furnished", "Unfurnished", "Semi-Furnished", "furnished", ...).
// Wir gruppieren mit case-insensitive ilike + or-Clause.
function furnishingOrClause(v: FurnishingOption): string {
  if (v === "furnished") {
    // "Fully Furnished" und "furnished" — aber NICHT "Semi-Furnished" / "Unfurnished".
    // PostgREST hat kein ieq, aber ilike ohne % ist eine case-insensitive Exact-Match.
    return "furnishing.ilike.fully%,furnishing.ilike.furnished";
  }
  if (v === "semi") {
    return "furnishing.ilike.semi%,furnishing.ilike.appliances%";
  }
  // unfurnished — ilike ohne Wildcard = case-insensitive exact; bewusst NICHT
  // mit % am Ende, damit "Fully Furnished" nicht versehentlich matcht
  // (würde es nicht, da kein "unfurnished"-Prefix, aber sicher ist sicher).
  return "furnishing.ilike.unfurnished";
}

// Generischer Query-Builder; arbeitet mit dem Filter-Builder von supabase-js
// (PostgrestFilterBuilder). Wir typisieren bewusst als unknown und casten,
// damit die Datei sowohl im Server-Page-Context als auch in evtl. anderen
// Aufrufern wiederverwendbar bleibt ohne harten Import.
type AnyQuery = {
  eq: (col: string, v: unknown) => AnyQuery;
  in: (col: string, v: unknown[]) => AnyQuery;
  gte: (col: string, v: unknown) => AnyQuery;
  lte: (col: string, v: unknown) => AnyQuery;
  ilike: (col: string, v: string) => AnyQuery;
  or: (s: string) => AnyQuery;
  contains: (col: string, v: unknown) => AnyQuery;
  not: (col: string, op: string, v: unknown) => AnyQuery;
};

export function applyFiltersToQuery<Q>(query: Q, f: BrowseFilters): Q {
  let q = query as unknown as AnyQuery;

  if (f.type) q = q.eq("type", f.type);

  if (f.region) {
    const region = CYPRUS_REGIONS.find((r) => r.slug === f.region);
    if (region) q = q.ilike("location_city", `${region.cityPrefix}%`);
  }

  if (f.propertyTypes.length) {
    q = q.in("property_type", f.propertyTypes);
  }

  if (f.rooms.length) {
    const exact = f.rooms.filter((r) => r < ROOMS_PLUS_THRESHOLD);
    const hasPlus = f.rooms.includes(ROOMS_PLUS_THRESHOLD);
    if (exact.length && hasPlus) {
      // Beide: "1, 2, 3 oder 5+" → or-clause
      const parts = exact.map((r) => `rooms.eq.${r}`);
      parts.push(`rooms.gte.${ROOMS_PLUS_THRESHOLD}`);
      q = q.or(parts.join(","));
    } else if (hasPlus) {
      q = q.gte("rooms", ROOMS_PLUS_THRESHOLD);
    } else if (exact.length === 1) {
      q = q.eq("rooms", exact[0]);
    } else if (exact.length > 1) {
      q = q.in("rooms", exact);
    }
  }

  if (f.priceMin != null) q = q.gte("price", f.priceMin);
  if (f.priceMax != null) q = q.lte("price", f.priceMax);

  if (f.bathroomsMin != null) q = q.gte("bathrooms", f.bathroomsMin);
  if (f.sizeMin != null) q = q.gte("size_sqm", f.sizeMin);
  if (f.sizeMax != null) q = q.lte("size_sqm", f.sizeMax);

  if (f.furnishing) q = q.or(furnishingOrClause(f.furnishing));

  // text[] features — `contains` ist AND-Match (alle gewählten müssen drin sein).
  // Genau die UX, die User erwarten ("must-have"-Liste).
  if (f.features.length) q = q.contains("features", f.features);

  if (f.energyMin) {
    // Energieklassen-Reihenfolge: A+ ist besser als A; bei "min A" wollen wir
    // A+ UND A treffen, NICHT B/C/D/.... Wir filtern per in() mit allen
    // Klassen, die ≥ der gewählten sind. Order: A+ > A > B > C > D > E > F > G.
    const order: EnergyOption[] = ["A+", "A", "B", "C", "D", "E", "F", "G"];
    const idx = order.indexOf(f.energyMin);
    if (idx >= 0) q = q.in("energy_class", order.slice(0, idx + 1));
  }

  if (f.yearMin != null) q = q.gte("year_built", f.yearMin);

  if (f.petsAllowed) q = q.eq("pets_allowed", true);

  // Default: Anteils-Inserate ausblenden. Opt-in via includeShares.
  if (!f.includeShares) q = q.eq("is_share", false);

  return q as unknown as Q;
}
