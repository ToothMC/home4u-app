// Cyprus-Region-Mapping für Listing-Filter und Geo-Detection.
//
// Listing-DB nutzt 5 Haupt-Cities ("Paphos", "Limassol", "Nicosia", "Larnaca",
// "Famagusta") als Prefix in location_city — Sub-Locations folgen mit
// " &#8211; ..." (Bazaraki) oder " District". Daher reicht ein
// ILIKE 'Paphos%'-Match um die ganze Region zu treffen.
//
// IP-Geo (Vercel Headers x-vercel-ip-city) gibt feinere Town-Namen zurück
// — die mappen wir hier auf die kanonische Region.

export type CyprusRegion = {
  slug: "paphos" | "limassol" | "nicosia" | "larnaca" | "famagusta";
  label: string;
  /** Prefix-Match auf listings.location_city (case-insensitive). */
  cityPrefix: string;
  /** Stadt-/Town-Aliasse aus IP-Geo / Search-Profile-Texten,
   *  die alle auf diese Region zeigen. Lowercase. */
  aliases: string[];
};

export const CYPRUS_REGIONS: CyprusRegion[] = [
  {
    slug: "paphos",
    label: "Paphos",
    cityPrefix: "Paphos",
    aliases: [
      "paphos",
      "pafos",
      "pegeia",
      "peyia",
      "kato paphos",
      "kato pafos",
      "coral bay",
      "polis",
      "latchi",
      "chloraka",
      "chlorakas",
      "kissonerga",
      "geroskipou",
      "yeroskipou",
      "tala",
      "tsada",
      "mesogi",
      "anavargos",
      "konia",
      "agios theodoros",
      "universal",
    ],
  },
  {
    slug: "limassol",
    label: "Limassol",
    cityPrefix: "Limassol",
    aliases: [
      "limassol",
      "lemesos",
      "germasogeia",
      "mouttagiaka",
      "agios athanasios",
      "mesa geitonia",
      "mesa yitonia",
      "agia fyla",
      "neapolis",
      "kapsalos",
      "katholiki",
      "panthea",
      "linopetra",
      "marina",
      "zakaki",
      "agia zoni",
      "omonoia",
      "agios spyridon",
      "apostolos andreas",
      "ypsonas",
    ],
  },
  {
    slug: "nicosia",
    label: "Nicosia",
    cityPrefix: "Nicosia",
    aliases: [
      "nicosia",
      "lefkosia",
      "strovolos",
      "aglandjia",
      "aglantzia",
      "engomi",
      "dali",
      "latsia",
      "lakatamia",
      "geri",
      "tseri",
    ],
  },
  {
    slug: "larnaca",
    label: "Larnaca",
    cityPrefix: "Larnaca",
    aliases: [
      "larnaca",
      "larnaka",
      "aradippou",
      "oroklini",
      "voroklini",
      "pyla",
      "livadia",
      "kiti",
      "mazotos",
      "finikoudes",
      "chrysopolitissa",
    ],
  },
  {
    slug: "famagusta",
    label: "Ayia Napa / Paralimni",
    cityPrefix: "Famagusta",
    aliases: [
      "famagusta",
      "ayia napa",
      "agia napa",
      "paralimni",
      "protaras",
      "sotira",
      "avgorou",
      "ayia thekla",
      "deryneia",
    ],
  },
];

const ALIAS_INDEX: Map<string, CyprusRegion> = (() => {
  const map = new Map<string, CyprusRegion>();
  for (const r of CYPRUS_REGIONS) {
    for (const a of r.aliases) map.set(a.toLowerCase(), r);
    map.set(r.slug, r);
    map.set(r.label.toLowerCase(), r);
  }
  return map;
})();

/** Best-Effort: hat der Text einen Hinweis auf eine Region? */
export function regionFromText(text: string | null | undefined): CyprusRegion | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  // Längste Aliasse zuerst — vermeidet "paphos" vs. "kato paphos" Verwirrung
  const sortedAliases = [...ALIAS_INDEX.keys()].sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    if (lower.includes(alias)) {
      return ALIAS_INDEX.get(alias) ?? null;
    }
  }
  return null;
}

export function regionBySlug(slug: string | null | undefined): CyprusRegion | null {
  if (!slug) return null;
  return CYPRUS_REGIONS.find((r) => r.slug === slug.toLowerCase()) ?? null;
}
