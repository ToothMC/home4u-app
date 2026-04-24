// Region-Modell: Country + City. Slug = URL-Param. Label = User-Anzeige.
// Erweitern, sobald Home4U in neue Märkte geht (Malta, Griechenland, Algarve, …).

export type Region = {
  slug: string;
  city: string;
  country: string;
  countrySlug: string;
  label: string; // z. B. "Zypern · Paphos"
  hint?: string; // optionaler Marketing-Hint im Picker
};

export const REGIONS: Region[] = [
  {
    slug: "paphos",
    city: "Paphos",
    country: "Zypern",
    countrySlug: "cy",
    label: "Zypern · Paphos",
    hint: "Startmarkt",
  },
  {
    slug: "limassol",
    city: "Limassol",
    country: "Zypern",
    countrySlug: "cy",
    label: "Zypern · Limassol",
  },
  {
    slug: "nicosia",
    city: "Nicosia",
    country: "Zypern",
    countrySlug: "cy",
    label: "Zypern · Nicosia",
  },
  {
    slug: "larnaca",
    city: "Larnaca",
    country: "Zypern",
    countrySlug: "cy",
    label: "Zypern · Larnaca",
  },
  {
    slug: "famagusta",
    city: "Ayia Napa / Paralimni",
    country: "Zypern",
    countrySlug: "cy",
    label: "Zypern · Ayia Napa / Paralimni",
  },
];

export const COUNTRIES: {
  slug: string;
  label: string;
  status: "live" | "planned";
}[] = [
  { slug: "cy", label: "Zypern", status: "live" },
  { slug: "mt", label: "Malta", status: "planned" },
  { slug: "gr", label: "Griechenland", status: "planned" },
  { slug: "pt", label: "Portugal", status: "planned" },
];

export function regionBySlug(slug?: string | null): Region | undefined {
  if (!slug) return undefined;
  return REGIONS.find((r) => r.slug === slug.toLowerCase());
}
