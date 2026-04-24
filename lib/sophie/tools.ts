import type Anthropic from "@anthropic-ai/sdk";

export const SOPHIE_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_search_profile",
    description:
      "Legt ein neues Suchprofil für einen Wohnungssuchenden an, sobald Lage und Budget feststehen. Andere Felder dürfen leer bleiben und später per update_search_profile ergänzt werden.",
    input_schema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description:
            "Stadt und optional Viertel/Umkreis, z. B. 'Paphos Kato' oder 'Nicosia Zentrum' — Freitext, wird später normalisiert",
        },
        budget_min: {
          type: "number",
          description: "Untere Preisgrenze in EUR pro Monat bei Miete",
        },
        budget_max: {
          type: "number",
          description: "Obere Preisgrenze in EUR pro Monat bei Miete",
        },
        rooms: {
          type: "integer",
          description: "Anzahl Zimmer (z. B. 2 für eine 2-Zimmer-Wohnung)",
        },
        move_in_date: {
          type: "string",
          description: "Frühestes Einzugsdatum als ISO-Datum (YYYY-MM-DD)",
        },
        household: {
          type: "string",
          enum: ["single", "couple", "family", "shared"],
          description: "Haushaltstyp des Suchenden",
        },
        lifestyle_tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Weiche Präferenzen als kurze Schlagwörter, z. B. ['ruhig', 'nah am Meer', 'Homeoffice']",
        },
        pets: {
          type: "boolean",
          description: "Haustiere im Haushalt — true/false",
        },
      },
      required: ["location", "budget_max"],
      additionalProperties: false,
    },
  },
  {
    name: "update_search_profile",
    description:
      "Aktualisiert ein bestehendes Suchprofil. Nur die geänderten Felder übergeben.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: [
            "location",
            "budget_min",
            "budget_max",
            "rooms",
            "move_in_date",
            "household",
            "lifestyle_tags",
            "pets",
          ],
        },
        value: {
          description:
            "Der neue Wert. Typ passend zum Feld (string, number, boolean oder Array).",
        },
      },
      required: ["field", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_match_request",
    description:
      "Suchender bestätigt, dass Home4U den Anbieter eines gefundenen Listings kontaktieren soll (Bridge-Outreach).",
    input_schema: {
      type: "object",
      properties: {
        listing_id: {
          type: "string",
          description: "ID des Listings, für das der Outreach gestartet wird",
        },
      },
      required: ["listing_id"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Leitet das Gespräch an einen menschlichen Moderator weiter. Nutze dies bei Betrug, Diskriminierung, rechtlichen Fragen oder wenn der Nutzer explizit einen Menschen wünscht.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "user_request",
            "scam_suspicion",
            "discrimination",
            "legal_question",
            "out_of_scope",
            "other",
          ],
        },
        notes: {
          type: "string",
          description: "Kurze Zusammenfassung für den Moderator",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];
