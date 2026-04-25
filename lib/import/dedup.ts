import { type NormalizedListing } from "./types";

type DedupInput = Pick<
  NormalizedListing,
  "external_id" | "location_city" | "location_district" | "price" | "rooms"
>;

/**
 * Stabiler Dedup-Hash pro Broker.
 *
 * Strategie nach Verfügbarkeit:
 *  1. external_id vorhanden → ext-basiert (zuverlässigster Re-Import-Schlüssel)
 *  2. Fallback → Owner+Stadt+Bezirk+Preis+Zimmer (matched bewusst die Logik
 *     in lib/sophie/tool-handlers.ts:164, damit Sophie-Eingabe und Bulk-Upload
 *     keine Duplikate erzeugen).
 */
export function computeDedupHash(brokerId: string, row: DedupInput): string {
  const prefix = `direct:${brokerId.slice(0, 8)}`;
  if (row.external_id) {
    return `${prefix}:ext:${row.external_id}`;
  }
  return [
    prefix,
    row.location_city.toLowerCase(),
    (row.location_district ?? "").toLowerCase(),
    String(row.price),
    String(row.rooms),
  ].join(":");
}
