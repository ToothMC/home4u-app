// Semantische Gruppen fuer property_type. MUSS synchron bleiben mit der
// Postgres-Funktion `_property_type_group(text)` (siehe Migration
// 20260519120000_market_position_property_type_group.sql). Wird im DB-Layer
// zur Eingrenzung der Markt-Vergleichsmenge benutzt und im UI fuer die
// Labels der MarketPriceBadge / MarketPriceBlock.
//
// Seltene Typen werden mit dem naechsten grossen Bucket gepoolt damit
// die Vergleichsmenge gesund bleibt (villa→house, studio→apartment etc.).

export type PropertyTypeGroup =
  | "residential_apartment"
  | "residential_house"
  | "plot"
  | "commercial"
  | "room"
  | "other";

export function propertyTypeGroup(pt: string | null | undefined): PropertyTypeGroup {
  switch ((pt ?? "").toLowerCase()) {
    case "apartment":
    case "studio":
    case "penthouse":
    case "maisonette":
      return "residential_apartment";
    case "house":
    case "villa":
    case "townhouse":
    case "bungalow":
      return "residential_house";
    case "plot":
    case "land":
      return "plot";
    case "commercial":
    case "building":
      return "commercial";
    case "room":
      return "room";
    default:
      return "other";
  }
}
