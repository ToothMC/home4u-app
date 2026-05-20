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

// =====================================================================
// Sub-Areas: Viertel/Dörfer innerhalb einer Region (Pegeia, Germasogeia …)
// =====================================================================
//
// Listings haben in listings.location_district eine Vielzahl von
// Schreibvarianten desselben Orts ("Pegeia" / "Peyia" / "Coral Bay" /
// "Sea Caves Peyia"). Der Sub-Area-Filter normalisiert auf einen Slug
// und matched per ILIKE-OR über alle bekannten Aliase.
//
// Daten sind redaktionell aus der Top-20-Verteilung je Region kuratiert
// und decken die häufigsten Suchwünsche (Tourismus-Areas, Vororte) ab.
// Weniger frequente Districts (<50 Listings) sind absichtlich weggelassen
// — der Filter würde sich sonst leer anfühlen.

export type CyprusSubArea = {
  slug: string;
  label: string;
  region: CyprusRegion["slug"];
  /** Lowercase-Aliase; werden in applyFiltersToQuery als ILIKE-OR
   *  gegen location_district + location_raw gematcht. Schreibvarianten
   *  und englisch/griechische Doppelformen explizit auflisten. */
  aliases: string[];
};

export const CYPRUS_SUB_AREAS: CyprusSubArea[] = [
  // === Paphos ===
  {
    slug: "pegeia",
    label: "Pegeia / Coral Bay",
    region: "paphos",
    aliases: ["pegeia", "peyia", "coral bay", "sea caves peyia"],
  },
  {
    slug: "geroskipou",
    label: "Geroskipou",
    region: "paphos",
    aliases: ["geroskipou", "yeroskipou"],
  },
  {
    slug: "chlorakas",
    label: "Chlorakas",
    region: "paphos",
    aliases: ["chlorakas", "chloraka"],
  },
  {
    slug: "kato-paphos",
    label: "Kato Paphos",
    region: "paphos",
    aliases: [
      "kato paphos",
      "kato pafos",
      "paphos - kato paphos",
      "kato paphos universal",
      "paphos - universal",
      "tombs of the kings",
      "tombs of the kings paphos",
    ],
  },
  { slug: "konia", label: "Konia", region: "paphos", aliases: ["konia"] },
  { slug: "tsada", label: "Tsada", region: "paphos", aliases: ["tsada"] },
  {
    slug: "agios-theodoros",
    label: "Agios Theodoros",
    region: "paphos",
    aliases: ["paphos - agios theodoros", "agios theodoros"],
  },
  { slug: "tala", label: "Tala", region: "paphos", aliases: ["tala"] },
  {
    slug: "kissonerga",
    label: "Kissonerga",
    region: "paphos",
    aliases: ["kissonerga"],
  },
  { slug: "anarita", label: "Anarita", region: "paphos", aliases: ["anarita"] },
  { slug: "empa", label: "Empa", region: "paphos", aliases: ["empa"] },
  {
    slug: "tremithousa",
    label: "Tremithousa",
    region: "paphos",
    aliases: ["tremithousa"],
  },
  {
    slug: "mandria",
    label: "Mandria",
    region: "paphos",
    aliases: ["mandria", "mandria pafou"],
  },
  {
    slug: "polis",
    label: "Polis / Latchi",
    region: "paphos",
    aliases: ["polis", "polis chrysochous", "latchi"],
  },

  // === Limassol ===
  {
    slug: "germasogeia",
    label: "Germasogeia",
    region: "limassol",
    aliases: [
      "germasogeia",
      "potamos germasogeias",
      "germasogeia tourist area",
    ],
  },
  {
    slug: "agios-athanasios",
    label: "Agios Athanasios",
    region: "limassol",
    aliases: ["agios athanasios"],
  },
  {
    slug: "agios-tychonas",
    label: "Agios Tychonas",
    region: "limassol",
    aliases: ["agios tychon", "agios tychonas", "agios tychon tourist area"],
  },
  {
    slug: "ypsonas",
    label: "Ypsonas",
    region: "limassol",
    aliases: ["ypsonas"],
  },
  {
    slug: "kato-polemidia",
    label: "Kato Polemidia",
    region: "limassol",
    aliases: ["kato polemidia", "polemidia"],
  },
  {
    slug: "parekklisia",
    label: "Parekklisia",
    region: "limassol",
    aliases: ["parekklisia"],
  },
  {
    slug: "mouttagiaka",
    label: "Mouttagiaka",
    region: "limassol",
    aliases: ["mouttagiaka"],
  },
  {
    slug: "neapolis",
    label: "Neapolis",
    region: "limassol",
    aliases: ["neapolis", "limassol - neapolis"],
  },
  {
    slug: "mesa-geitonia",
    label: "Mesa Geitonia",
    region: "limassol",
    aliases: ["mesa geitonia", "mesa yitonia", "limassol - mesa geitonia"],
  },
  {
    slug: "zakaki",
    label: "Zakaki",
    region: "limassol",
    aliases: ["zakaki", "limassol - zakaki"],
  },
  {
    slug: "agia-fyla",
    label: "Agia Fyla",
    region: "limassol",
    aliases: ["agia fyla", "limassol - agia fyla"],
  },
  {
    slug: "panthea",
    label: "Panthea",
    region: "limassol",
    aliases: ["panthea"],
  },
  {
    slug: "agia-triada",
    label: "Agia Triada",
    region: "limassol",
    aliases: ["agia triada", "limassol - agia triada"],
  },
  {
    slug: "pissouri",
    label: "Pissouri",
    region: "limassol",
    aliases: ["pissouri"],
  },
  {
    slug: "pyrgos",
    label: "Pyrgos",
    region: "limassol",
    aliases: ["pyrgos", "pyrgos lemesou"],
  },

  // === Nicosia ===
  {
    slug: "strovolos",
    label: "Strovolos",
    region: "nicosia",
    aliases: ["strovolos"],
  },
  { slug: "latsia", label: "Latsia", region: "nicosia", aliases: ["latsia"] },
  {
    slug: "makedonitissa",
    label: "Makedonitissa",
    region: "nicosia",
    aliases: ["makedonitissa"],
  },
  {
    slug: "aglantzia",
    label: "Aglantzia",
    region: "nicosia",
    aliases: ["aglantzia", "aglandjia"],
  },
  {
    slug: "lakatamia",
    label: "Lakatamia",
    region: "nicosia",
    aliases: ["lakatamia", "pano lakatamia", "kato lakatamia"],
  },
  { slug: "geri", label: "Geri", region: "nicosia", aliases: ["geri"] },
  { slug: "dali", label: "Dali", region: "nicosia", aliases: ["dali"] },
  {
    slug: "agios-dometios",
    label: "Agios Dometios",
    region: "nicosia",
    aliases: ["agios dometios"],
  },
  { slug: "tseri", label: "Tseri", region: "nicosia", aliases: ["tseri"] },
  {
    slug: "archangelos",
    label: "Archangelos",
    region: "nicosia",
    aliases: ["archangelos"],
  },
  { slug: "engomi", label: "Engomi", region: "nicosia", aliases: ["engomi"] },

  // === Larnaca ===
  {
    slug: "aradippou",
    label: "Aradippou",
    region: "larnaca",
    aliases: ["aradippou"],
  },
  {
    slug: "livadia",
    label: "Livadia",
    region: "larnaca",
    aliases: ["livadia", "livadia larnacas", "livadia larnakas"],
  },
  {
    slug: "oroklini",
    label: "Oroklini",
    region: "larnaca",
    aliases: ["oroklini", "voroklini"],
  },
  { slug: "kiti", label: "Kiti", region: "larnaca", aliases: ["kiti"] },
  { slug: "pyla", label: "Pyla", region: "larnaca", aliases: ["pyla"] },
  {
    slug: "chrysopolitissa",
    label: "Chrysopolitissa",
    region: "larnaca",
    aliases: ["chrysopolitissa"],
  },
  {
    slug: "mackenzie",
    label: "Mackenzie",
    region: "larnaca",
    aliases: ["mackenzie"],
  },
  {
    slug: "pervolia",
    label: "Pervolia",
    region: "larnaca",
    aliases: ["pervolia"],
  },
  {
    slug: "mazotos",
    label: "Mazotos",
    region: "larnaca",
    aliases: ["mazotos"],
  },
  {
    slug: "dekeleia",
    label: "Dekeleia",
    region: "larnaca",
    aliases: ["dekeleia"],
  },

  // === Famagusta (Ayia Napa / Paralimni) ===
  {
    slug: "paralimni",
    label: "Paralimni",
    region: "famagusta",
    aliases: ["paralimni"],
  },
  {
    slug: "protaras",
    label: "Protaras / Pernera",
    region: "famagusta",
    aliases: ["protaras", "pernera"],
  },
  {
    slug: "ayia-napa",
    label: "Ayia Napa",
    region: "famagusta",
    aliases: ["ayia napa", "agia napa"],
  },
  {
    slug: "kapparis",
    label: "Kapparis",
    region: "famagusta",
    aliases: ["kapparis"],
  },
  {
    slug: "deryneia",
    label: "Deryneia",
    region: "famagusta",
    aliases: ["deryneia"],
  },
  {
    slug: "sotira",
    label: "Sotira",
    region: "famagusta",
    aliases: ["sotira", "sotira ammochostou"],
  },
  {
    slug: "avgorou",
    label: "Avgorou",
    region: "famagusta",
    aliases: ["avgorou"],
  },
  {
    slug: "frenaros",
    label: "Frenaros",
    region: "famagusta",
    aliases: ["frenaros"],
  },
  {
    slug: "liopetri",
    label: "Liopetri",
    region: "famagusta",
    aliases: ["liopetri", "potamos liopetriou"],
  },
];

const SUB_AREA_BY_SLUG: Map<string, CyprusSubArea> = new Map(
  CYPRUS_SUB_AREAS.map((s) => [s.slug, s]),
);
const SUB_AREA_BY_ALIAS: Map<string, CyprusSubArea> = (() => {
  const map = new Map<string, CyprusSubArea>();
  for (const s of CYPRUS_SUB_AREAS) {
    for (const a of s.aliases) map.set(a.toLowerCase(), s);
    map.set(s.slug, s);
    map.set(s.label.toLowerCase(), s);
  }
  return map;
})();

export function subAreaBySlug(
  slug: string | null | undefined,
): CyprusSubArea | null {
  if (!slug) return null;
  return SUB_AREA_BY_SLUG.get(slug.toLowerCase()) ?? null;
}

/** Best-Effort: enthält der Text einen bekannten Sub-Area-Alias?
 *  Längste Aliase zuerst — "kato paphos" gewinnt über "paphos". */
export function subAreaFromText(
  text: string | null | undefined,
): CyprusSubArea | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();
  const direct = SUB_AREA_BY_ALIAS.get(lower);
  if (direct) return direct;
  // Substring-Suche, längste Aliase zuerst (verhindert dass "paphos" in
  // "kato paphos" das Match abfängt).
  const sortedAliases = [...SUB_AREA_BY_ALIAS.keys()].sort(
    (a, b) => b.length - a.length,
  );
  for (const alias of sortedAliases) {
    if (lower.includes(alias)) return SUB_AREA_BY_ALIAS.get(alias) ?? null;
  }
  return null;
}

export function subAreasForRegion(
  regionSlug: CyprusRegion["slug"],
): CyprusSubArea[] {
  return CYPRUS_SUB_AREAS.filter((s) => s.region === regionSlug);
}
