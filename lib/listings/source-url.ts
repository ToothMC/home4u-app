/**
 * Rekonstruiert die Original-URL eines gecrawlten Listings.
 *
 * Für die meisten Quellen liegt sie in `extracted_data.source_url` (Crawler
 * speichert sie dort beim Detail-Fetch). Fallback pro Source aus external_id
 * (+ optional Title für slug).
 */

type SourceLike = string | null | undefined;

export interface ListingSourceFields {
  source: SourceLike;
  external_id: SourceLike;
  extracted_data: Record<string, unknown> | null | undefined;
  /** Optional — wird für den Bazaraki-Slug-Fallback genutzt, falls
   *  extracted_data.source_url fehlt (Altdaten vor dem 2026-05-01-Fix). */
  title?: string | null;
}

/** Bazaraki-Pattern: /adv/{id}_{slug}/ — ohne Slug redirected die Seite
 *  auf die Kategorie-Übersicht statt aufs Inserat (Bazaraki-Quirk). */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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
    case "bazaraki": {
      // Bazaraki braucht /adv/{id}_{slug}/ — nur die ID (ohne Slug)
      // führt zur Kategorie-Übersicht. Slug aus Title ableiten falls
      // vorhanden, sonst nur ID (degraded fallback).
      const slug = listing.title ? slugifyTitle(listing.title) : "";
      return slug
        ? `https://www.bazaraki.com/adv/${ext}_${slug}/`
        : `https://www.bazaraki.com/adv/${ext}/`;
    }
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
