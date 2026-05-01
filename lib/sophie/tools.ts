import type Anthropic from "@anthropic-ai/sdk";

export const SOPHIE_TOOLS: Anthropic.Tool[] = [
  {
    name: "set_user_role",
    description:
      "Markiert die primäre Absicht des Nutzers fürs Dashboard: 'seeker' = sucht, 'owner' = bietet eigene Immobilie an, 'agent' = Makler. Das ist NUR ein Dashboard-Fokus — technisch darf der Nutzer jederzeit beides machen (suchen UND inserieren). Nutze das Tool, sobald die Hauptabsicht klar ist, damit das Dashboard auf die passende Ansicht voreingestellt ist. Bei Wechsel der Hauptabsicht einfach neu setzen.",
    input_schema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["seeker", "owner", "agent"],
          description: "Dashboard-Fokus des Nutzers",
        },
        reason: {
          type: "string",
          description: "Kurz nachvollziehbar, warum du diesen Fokus setzt",
        },
      },
      required: ["role", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "create_search_profile",
    description:
      "Legt ein neues Suchprofil für einen Wohnungssuchenden an, sobald Lage und Budget feststehen. Andere Felder dürfen leer bleiben und später per update_search_profile ergänzt werden. WICHTIG: type muss aus dem Nutzer-Intent abgeleitet werden — wenn unklar, vor dem Tool-Call nachfragen.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["rent", "sale"],
          description:
            "Mietsuche oder Kaufsuche. 'rent' bei Miete/Wohnung mieten/Apartment, 'sale' bei Kaufen/Erwerben/Investition. Pflichtfeld — bei Unklarheit nachfragen statt raten.",
        },
        property_type: {
          type: "string",
          enum: ["apartment", "house", "room", "plot"],
          description:
            "Art der Immobilie. apartment = Wohnung/Apartment/Studio/Penthouse, house = Haus/Villa/Townhouse/Maisonette, room = Zimmer/WG, plot = Grundstück/Bauland/Acker/Plot/Land. Weglassen wenn der User keine Präferenz angibt — dann matched alles. Setze 'plot' wenn der User Grundstück/Bauland/Land sagt — dann werden Wohnungen NICHT mehr in den Treffern gemischt.",
        },
        location: {
          type: "string",
          description:
            "Stadt und optional Viertel/Umkreis, z. B. 'Paphos Kato' oder 'Nicosia Zentrum' — Freitext, wird später normalisiert",
        },
        budget_min: {
          type: "number",
          description:
            "Untere Preisgrenze in EUR pro Monat bei Miete. NUR setzen, wenn der User explizit eine Range oder Untergrenze nennt ('zwischen X und Y', 'ab X', 'mindestens X'). NIEMALS separat danach fragen — wenn der User nur eine Zahl genannt hat, ist das budget_max, und budget_min bleibt weg.",
        },
        budget_max: {
          type: "number",
          description:
            "Obere Preisgrenze in EUR pro Monat bei Miete. Bei einer einzelnen Zahl ('1500 Euro', 'bis 1500') wird das hier eingetragen.",
        },
        rooms: {
          type: "integer",
          description: "Anzahl Zimmer (z. B. 2 für eine 2-Zimmer-Wohnung). Bei Grundstücken/plot weglassen.",
        },
        rooms_strict: {
          type: "boolean",
          description: "Wenn true, matched die Suche NUR exakt rooms (kein ±1). Default false (toleriert ±1 Zimmer). Auf true setzen wenn der User explizit 'genau N', 'nur N', 'exakt N', 'ausschließlich N' Zimmer sagt.",
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
      required: ["type", "location", "budget_max"],
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
            "type",
            "property_type",
            "location",
            "budget_min",
            "budget_max",
            "rooms",
            "rooms_strict",
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
    name: "create_listing",
    description:
      "Legt ein neues Inserat für eine Immobilie (Wohnung, Haus, Grundstück) an, wenn der Nutzer als privater Eigentümer oder Makler etwas inserieren möchte. Pflicht: eingeloggter Nutzer, Stadt, mindestens Viertel/Postleitzahl, Preis, Zimmer, Typ (rent/sale). Bei Makler-Inseraten zusätzlich Provisionshöhe erfragen. Das Inserat ist nach Anlage sofort aktiv und kann gematcht werden.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["rent", "sale"],
          description: "Miete oder Kauf",
        },
        location_city: {
          type: "string",
          description: "Stadt, z. B. 'Paphos', 'Limassol', 'Nicosia'",
        },
        location_district: {
          type: "string",
          description: "Viertel oder genauere Lage, z. B. 'Chloraka', 'Kato Paphos'",
        },
        price: {
          type: "number",
          description: "Miete pro Monat (in EUR) oder Kaufpreis",
        },
        rooms: {
          type: "integer",
          description: "Anzahl Zimmer",
        },
        size_sqm: {
          type: "integer",
          description: "Wohnfläche in Quadratmetern",
        },
        contact_channel: {
          type: "string",
          enum: ["whatsapp", "telegram", "email", "phone"],
          description: "Bevorzugter Kontaktkanal, über den Sophie den Match-Anfragen weiterleitet",
        },
        language: {
          type: "string",
          enum: ["de", "en", "ru", "el", "zh"],
          description: "Sprache, in der der Anbieter bevorzugt antwortet",
        },
        notes: {
          type: "string",
          description: "Kurzer Freitext: was macht die Immobilie aus, besondere Wünsche an Mieter/Käufer",
        },
        media_urls: {
          type: "array",
          items: { type: "string" },
          description: "Öffentliche URLs zu Bildern/Videos in der Reihenfolge, in der sie angezeigt werden. Erste URL = Cover. Übernimm diese aus dem <attached_media>-Context, wenn vorhanden — niemals URLs erfinden.",
        },
      },
      required: ["type", "location_city", "price", "rooms"],
      additionalProperties: false,
    },
  },
  {
    name: "find_matches",
    description:
      "Sucht passende Wohnungsangebote für das zuletzt angelegte Suchprofil des Nutzers. Ruft den Matching-Job in der Datenbank auf und liefert die Top-Treffer zurück (Stadt, Lage, Preis, Zimmer, Größe). Nutze dieses Tool, sobald genug Informationen für ein Profil erfasst sind — idealerweise direkt nach create_search_profile oder wenn der Nutzer nach 'was hast du für mich?' fragt.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Maximale Anzahl an Vorschlägen (Default 50, max 50). Normalerweise weglassen — die /matches-Page zeigt sowieso bis zu 50, und Sophie sollte nur die Gesamtzahl nennen statt Listings aufzuzählen.",
        },
      },
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
