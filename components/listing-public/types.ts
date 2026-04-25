export type AssessmentItem = {
  title: string;
  reason: string;
};

export type HonestAssessment = {
  pros: AssessmentItem[];
  cons: AssessmentItem[];
};

export type NearbyPOI = {
  name: string;
  category:
    | "transit"
    | "park"
    | "supermarket"
    | "restaurant"
    | "school"
    | "beach"
    | "other";
  walking_minutes: number;
};

export type ListingPhoto = {
  id: string;
  url: string;
  room_type: string | null;
  caption: string | null;
  position: number;
};

export const ROOM_LABEL: Record<string, string> = {
  living: "Wohnzimmer",
  kitchen: "Küche",
  bedroom: "Schlafzimmer",
  bathroom: "Bad",
  balcony: "Balkon",
  terrace: "Terrasse",
  exterior: "Außenansicht",
  view: "Aussicht",
  garden: "Garten",
  pool: "Pool",
  parking: "Parkplatz",
  hallway: "Eingang",
  utility: "Hauswirtschaft",
  other: "Sonstige",
};

export const ROOM_ORDER = [
  "exterior",
  "living",
  "kitchen",
  "bedroom",
  "bathroom",
  "balcony",
  "terrace",
  "view",
  "garden",
  "pool",
  "parking",
  "hallway",
  "utility",
  "other",
];

export const POI_LABEL: Record<NearbyPOI["category"], string> = {
  transit: "ÖPNV",
  park: "Park",
  supermarket: "Supermarkt",
  restaurant: "Restaurant",
  school: "Schule",
  beach: "Strand",
  other: "POI",
};

export type PublicListingData = {
  id: string;
  title: string | null;
  description: string | null;
  type: "rent" | "sale";
  property_type: string | null;
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
  utilities: {
    water?: string | null;
    electricity?: string | null;
    internet?: string | null;
    garbage?: string | null;
    bills_in_tenant_name?: boolean | null;
    estimated_monthly_total?: number | null;
    notes?: string | null;
  } | null;
  currency: string;
  rooms: number | null;
  bathrooms: number | null;
  size_sqm: number | null;
  plot_sqm: number | null;
  floor: string | null;
  year_built: number | null;
  energy_class: string | null;
  furnishing: string | null;
  pets_allowed: boolean | null;
  available_from: string | null;
  features: string[];
  media: string[];
  photos: ListingPhoto[];
  honest_assessment: HonestAssessment | null;
  nearby_pois: NearbyPOI[];
  floorplan_url: string | null;
  tour_3d_url: string | null;
  video_url: string | null;
  contract_min_months: number | null;
  contract_notes: string | null;
  // Faire-Preis-Analyse
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
  market_p10_eur_sqm: number | null;
  market_p25_eur_sqm: number | null;
  market_median_eur_sqm: number | null;
  market_p75_eur_sqm: number | null;
  source: string;
  external_id: string | null;
  ai_analyzed_at: string | null;
  created_at: string;
};
