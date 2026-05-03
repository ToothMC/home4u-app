import type Anthropic from "@anthropic-ai/sdk";

export const PROPERTY_TYPES = [
  "apartment",
  "house",
  "villa",
  "maisonette",
  "studio",
  "townhouse",
  "penthouse",
  "bungalow",
  "land",
  "commercial",
] as const;

export const FEATURE_VALUES = [
  "parking",
  "covered_parking",
  "pool",
  "garden",
  "balcony",
  "terrace",
  "elevator",
  "air_conditioning",
  "solar",
  "sea_view",
  "mountain_view",
  "storage",
  "fireplace",
  "jacuzzi",
  "gym",
  "smart_home",
  "accessible",
] as const;

export const ROOM_TYPES = [
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
  "office",
  "other",
] as const;

export const ANALYZE_TOOL: Anthropic.Tool = {
  name: "submit_listing_analysis",
  description:
    "Liefere die vollständige Analyse als strukturiertes Objekt zurück. Pro Foto MUSS ein room_type gesetzt sein.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Inserats-Titel auf Deutsch, max 70 Zeichen. Faktisch + EIN Highlight.",
      },
      description: {
        type: "string",
        description:
          "Beschreibung 150-280 Wörter, drei Absätze (Lage / Beschaffenheit / Ausstattung).",
      },
      property_type: {
        type: "string",
        enum: [...PROPERTY_TYPES],
      },
      furnishing: {
        type: "string",
        enum: ["furnished", "semi_furnished", "unfurnished"],
      },
      bathrooms: {
        type: "integer",
        description: "Anzahl Bäder, falls auf Bildern erkennbar (0-10). Sonst weglassen.",
      },
      energy_class_estimate: {
        type: "string",
        description:
          "Optional: A+, A, B, C, D, E, F, G falls aus Aushang/Schild auf Bildern erkennbar. Sonst weglassen.",
      },
      features: {
        type: "array",
        items: { type: "string", enum: [...FEATURE_VALUES] },
        description: "Sichtbare/eindeutige Ausstattungsmerkmale.",
      },
      photos: {
        type: "array",
        description:
          "Pro übergebenem Foto ein Eintrag mit index (0-basiert) + room_type + optional caption.",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "0-basierter Foto-Index" },
            room_type: { type: "string", enum: [...ROOM_TYPES] },
            caption: {
              type: "string",
              description: "Sehr kurz (max 6 Wörter), z. B. 'Wohnzimmer mit Balkon-Zugang'",
            },
          },
          required: ["index", "room_type"],
        },
      },
      honest_assessment: {
        type: "object",
        description:
          "Ehrliche Bewertung: 3 Pros + bis zu 2 Cons. Cons NICHT erfinden — wenn nichts auffällt, leeres Array.",
        properties: {
          pros: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Stichpunkt, max 6 Wörter" },
                reason: { type: "string", description: "Kurze Begründung, 1 Satz" },
              },
              required: ["title", "reason"],
            },
          },
          cons: {
            type: "array",
            maxItems: 2,
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Stichpunkt, max 6 Wörter" },
                reason: { type: "string", description: "Kurze Begründung, 1 Satz" },
              },
              required: ["title", "reason"],
            },
          },
        },
        required: ["pros", "cons"],
      },
    },
    required: [
      "title",
      "description",
      "property_type",
      "features",
      "photos",
      "honest_assessment",
    ],
  },
};

export type AnalyzeResult = {
  title: string;
  description: string;
  property_type: (typeof PROPERTY_TYPES)[number];
  furnishing?: "furnished" | "semi_furnished" | "unfurnished";
  bathrooms?: number;
  energy_class_estimate?: string;
  features: (typeof FEATURE_VALUES)[number][];
  photos: { index: number; room_type: (typeof ROOM_TYPES)[number]; caption?: string }[];
  honest_assessment: {
    pros: { title: string; reason: string }[];
    cons: { title: string; reason: string }[];
  };
};
