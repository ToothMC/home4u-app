/**
 * Real-Estate-Domain-Glossar für Übersetzungen.
 *
 * Wird in den Translation-Prompt eingebettet, damit Haiku Domain-Begriffe
 * konsistent übersetzt — Mietkaution heißt nicht "Caution money", sondern
 * "Deposit". m² wird nicht "m squared", sondern "sq.m".
 *
 * Erweiterbar: Wenn ein neuer Term auftaucht, der wiederholt falsch übersetzt
 * wird, hier eintragen.
 */

export type Lang = "de" | "en" | "ru" | "el";

export type GlossaryEntry = {
  de: string;
  en: string;
  ru: string;
  el: string;
};

export const REAL_ESTATE_GLOSSARY: GlossaryEntry[] = [
  { de: "Kaution", en: "Deposit", ru: "Залог", el: "Εγγύηση" },
  { de: "Provision", en: "Commission", ru: "Комиссия", el: "Προμήθεια" },
  { de: "Nebenkosten", en: "Utilities", ru: "Коммунальные платежи", el: "Κοινόχρηστα" },
  { de: "Möbliert", en: "Furnished", ru: "Меблированная", el: "Επιπλωμένο" },
  { de: "Unmöbliert", en: "Unfurnished", ru: "Без мебели", el: "Χωρίς έπιπλα" },
  { de: "Klimaanlage", en: "Air conditioning", ru: "Кондиционер", el: "Κλιματισμός" },
  { de: "Pool", en: "Pool", ru: "Бассейн", el: "Πισίνα" },
  { de: "Stellplatz", en: "Parking", ru: "Парковка", el: "Χώρος στάθμευσης" },
  { de: "Balkon", en: "Balcony", ru: "Балкон", el: "Μπαλκόνι" },
  { de: "Terrasse", en: "Terrace", ru: "Терраса", el: "Βεράντα" },
  { de: "Garten", en: "Garden", ru: "Сад", el: "Κήπος" },
  { de: "Aufzug", en: "Elevator", ru: "Лифт", el: "Ασανσέρ" },
  { de: "Fußbodenheizung", en: "Underfloor heating", ru: "Тёплый пол", el: "Ενδοδαπέδια θέρμανση" },
  { de: "Haustiere erlaubt", en: "Pets allowed", ru: "Можно с животными", el: "Επιτρέπονται κατοικίδια" },
  { de: "Mietvertrag", en: "Rental contract", ru: "Договор аренды", el: "Συμβόλαιο μίσθωσης" },
  { de: "Mindestmietdauer", en: "Minimum lease term", ru: "Минимальный срок аренды", el: "Ελάχιστη διάρκεια μίσθωσης" },
  { de: "Quadratmeter", en: "sq.m", ru: "м²", el: "τ.μ." },
  { de: "Schlafzimmer", en: "Bedroom", ru: "Спальня", el: "Υπνοδωμάτιο" },
  { de: "Wohnzimmer", en: "Living room", ru: "Гостиная", el: "Σαλόνι" },
  { de: "Küche", en: "Kitchen", ru: "Кухня", el: "Κουζίνα" },
  { de: "Badezimmer", en: "Bathroom", ru: "Ванная", el: "Μπάνιο" },
  { de: "Dachterrasse", en: "Roof terrace", ru: "Терраса на крыше", el: "Ταράτσα" },
  { de: "Erdgeschoss", en: "Ground floor", ru: "Первый этаж", el: "Ισόγειο" },
  { de: "Maklergebühr", en: "Agency fee", ru: "Комиссия агентства", el: "Αμοιβή μεσίτη" },
  { de: "Eigentümer", en: "Owner", ru: "Собственник", el: "Ιδιοκτήτης" },
  { de: "Makler", en: "Real estate agent", ru: "Риелтор", el: "Μεσίτης" },
  { de: "Suchender", en: "Seeker", ru: "Соискатель", el: "Αναζητητής" },
];

/**
 * Rendert das Glossar als Prompt-Text für Haiku.
 * Format: "DE Term · EN: Term · RU: Term · EL: Term".
 */
export function renderGlossaryForPrompt(): string {
  return REAL_ESTATE_GLOSSARY
    .map((e) => `- DE: ${e.de} · EN: ${e.en} · RU: ${e.ru} · EL: ${e.el}`)
    .join("\n");
}
