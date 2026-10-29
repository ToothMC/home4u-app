// Aufteilung der Listings-Sitemap nach id-Bereichen.
//
// Vorher: COUNT über alle aktiven Inserate + pro Teil-Sitemap
// `ORDER BY updated_at LIMIT 5000 OFFSET n`. Jeder Teil sortierte dafür alle
// ~258k aktiven Zeilen (~58k Pages), und das für ~52 Teile bei JEDEM Build —
// Preview-Builds eingeschlossen. Das war 2026-10-23 bis -29 der zweitgrößte
// Disk-IO-Verbraucher der Datenbank.
//
// Jetzt: feste Anzahl Teile, jeder deckt einen Bereich der (zufälligen,
// uuid_generate_v4) ids ab. Ein Teil ist ein Range-Scan über listings_pkey
// und liest nur seine eigenen Zeilen (~4.500 Pages). Kein COUNT mehr nötig.
//
// 64 Teile à derzeit ~4.000 URLs; Googles Grenze von 50.000 URLs pro Sitemap
// wird erst bei ~3 Mio. aktiven Inseraten erreicht.

export const LISTING_SITEMAP_BUCKETS = 64;

const STEP = 256 / LISTING_SITEMAP_BUCKETS;

function uuidLowerBound(firstByte: number): string {
  return `${firstByte.toString(16).padStart(2, "0")}000000-0000-0000-0000-000000000000`;
}

/** id-Bereich [from, to) für eine Teil-Sitemap; `to` ist null beim letzten Teil. */
export function listingSitemapRange(bucket: number): {
  from: string;
  to: string | null;
} {
  return {
    from: uuidLowerBound(bucket * STEP),
    to:
      bucket >= LISTING_SITEMAP_BUCKETS - 1
        ? null
        : uuidLowerBound((bucket + 1) * STEP),
  };
}
