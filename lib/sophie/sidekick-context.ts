import { z } from "zod";

/**
 * Kontext, den Sophie mitbekommt, wenn sie als Drawer/Sidekick auf einer
 * Browse- oder Detail-Seite läuft. Hilft ihr, präzise auf die aktuelle
 * Filter-Ansicht oder das offene Inserat zu reagieren — und entscheidet,
 * welche Tools sie priorisiert (apply_browse_filters, explain_listing, ...).
 *
 * Der Typ wird aus dem zod-Schema abgeleitet — das ist absichtlich
 * lockerer typisiert als BrowseFilters (region ist string statt Slug-Union),
 * damit die API-Validierung über Drahtformat funktioniert. BrowseFilters
 * ist ein gültiger Subtyp und kann ohne Cast übergeben werden.
 */

const ListingSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  type: z.enum(["rent", "sale"]),
  property_type: z.string().nullable().optional(),
  price: z.number(),
  currency: z.string().nullable().optional(),
  location_city: z.string(),
  location_district: z.string().nullable().optional(),
  rooms: z.number().nullable().optional(),
  size_sqm: z.number().nullable().optional(),
  bathrooms: z.number().nullable().optional(),
  market_position: z.string().nullable().optional(),
});

const BrowseFiltersSchema = z.object({
  type: z.enum(["rent", "sale"]).nullable(),
  region: z.string().nullable(),
  subArea: z.string().nullable(),
  propertyTypes: z.array(z.string()),
  rooms: z.array(z.number()),
  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  bathroomsMin: z.number().nullable(),
  sizeMin: z.number().nullable(),
  sizeMax: z.number().nullable(),
  furnishing: z.string().nullable(),
  features: z.array(z.string()),
  energyMin: z.string().nullable(),
  yearMin: z.number().nullable(),
  petsAllowed: z.boolean(),
  includeShares: z.boolean(),
});

export const SidekickContextSchema = z.discriminatedUnion("page", [
  z.object({
    page: z.literal("stoebern"),
    filters: BrowseFiltersSchema,
    visible_listing_ids: z.array(z.string()).max(48),
  }),
  z.object({
    page: z.literal("listing"),
    listing: ListingSummarySchema,
  }),
]);

export type SidekickContext = z.infer<typeof SidekickContextSchema>;
export type SidekickListingSummary = z.infer<typeof ListingSummarySchema>;

/**
 * Baut einen menschen- und Sophie-lesbaren System-Kontext-Block. Wird
 * server-seitig in /api/chat verwendet, um den aktuellen UI-State in den
 * Prompt zu injizieren.
 */
export function formatSidekickContextBlock(ctx: SidekickContext): string {
  if (ctx.page === "stoebern") {
    const f = ctx.filters;
    const parts: string[] = [];
    if (f.type) parts.push(`type=${f.type}`);
    if (f.region) parts.push(`region=${f.region}`);
    if (f.subArea) parts.push(`sub_area=${f.subArea}`);
    if (f.propertyTypes.length)
      parts.push(`property_types=${f.propertyTypes.join("|")}`);
    if (f.rooms.length) parts.push(`rooms=${f.rooms.join("|")}`);
    if (f.priceMin != null) parts.push(`price_min=${f.priceMin}`);
    if (f.priceMax != null) parts.push(`price_max=${f.priceMax}`);
    if (f.bathroomsMin != null) parts.push(`bathrooms_min=${f.bathroomsMin}`);
    if (f.sizeMin != null) parts.push(`size_min=${f.sizeMin}`);
    if (f.sizeMax != null) parts.push(`size_max=${f.sizeMax}`);
    if (f.furnishing) parts.push(`furnishing=${f.furnishing}`);
    if (f.features.length) parts.push(`features=${f.features.join("|")}`);
    if (f.energyMin) parts.push(`energy_min=${f.energyMin}`);
    if (f.yearMin != null) parts.push(`year_min=${f.yearMin}`);
    if (f.petsAllowed) parts.push("pets=true");
    if (f.includeShares) parts.push("shares=true");
    const filterLine = parts.length ? parts.join(", ") : "keine";
    const ids = ctx.visible_listing_ids.slice(0, 24).join(", ");
    return `<sidekick_context>
Du bist als Drawer auf /stoebern aktiv. Der User stöbert mit folgenden Filtern: ${filterLine}.
Sichtbare Listing-IDs (oberste Seite): [${ids || "—"}].
Du darfst Filter ändern (apply_browse_filters), Inserate erklären (explain_listing), vergleichen (compare_listings), Markt zeigen (market_insights) oder die Suche als Alert speichern (save_search). Nutze diese Tools, statt ein neues create_search_profile aufzubauen — der User filtert schon.
</sidekick_context>`;
  }
  const l = ctx.listing;
  const where = l.location_district
    ? `${l.location_district}, ${l.location_city}`
    : l.location_city;
  const sizeInfo = l.size_sqm ? `, ${l.size_sqm} m²` : "";
  const roomsInfo = l.rooms != null ? `, ${l.rooms} Zimmer` : "";
  const market = l.market_position ? `, market=${l.market_position}` : "";
  return `<sidekick_context>
Du bist als Drawer auf der Detail-Seite eines Inserats aktiv. Aktuelles Listing:
- id=${l.id}
- type=${l.type}${l.property_type ? `, property_type=${l.property_type}` : ""}
- ${where}
- ${l.price} ${l.currency ?? "EUR"}${roomsInfo}${sizeInfo}${market}
Antworten beziehen sich primär auf DIESES Listing. Bevorzugte Tools: explain_listing, compare_listings (mit ähnlichen), market_insights, confirm_match_request (Bridge-Outreach).
</sidekick_context>`;
}
