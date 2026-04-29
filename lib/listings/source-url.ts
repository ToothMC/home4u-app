/**
 * Rekonstruiert die Original-URL eines gecrawlten Listings.
 *
 * Für die meisten Quellen liegt sie in `extracted_data.source_url` (Crawler
 * speichert sie dort beim Detail-Fetch). Fallback pro Source aus external_id.
 */

type SourceLike = string | null | undefined;

export interface ListingSourceFields {
  source: SourceLike;
  external_id: SourceLike;
  extracted_data: Record<string, unknown> | null | undefined;
}

export function buildSourceUrl(listing: ListingSourceFields): string | null {
  const fromExtracted =
    typeof listing.extracted_data?.source_url === "string"
      ? (listing.extracted_data.source_url as string).trim()
      : "";
  if (fromExtracted) return fromExtracted;

  const ext = (listing.external_id ?? "").trim();
  if (!ext) return null;

  switch (listing.source) {
    case "bazaraki":
      // Bazaraki adv-IDs sind stabil und URL ist deterministisch.
      return `https://www.bazaraki.com/adv/${ext}/`;
    case "index_cy":
      // INDEX speichert source_url in extracted_data — Fallback nur grob.
      return null;
    case "fb":
      // FB-Marketplace-Pfade sind volatil; ohne extracted_data nicht
      // zuverlässig rekonstruierbar.
      return null;
    case "direct":
      // Eigene Inserate haben keine externe URL.
      return null;
    default:
      return null;
  }
}
