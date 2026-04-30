// Region-Detection für die Landing-Page.
//
// Prioritäten (zuerst gewinnt):
//   1. URL-Param ?region=paphos
//   2. Letzte aktive search_profile.location des angemeldeten Users
//   3. IP-Geo via Vercel-Header x-vercel-ip-city (kostenlos, kein Consent)
//   4. null → Listings nicht filtern, Standard-Mix anzeigen
//
// Server-only (nutzt next/headers + Service-Client). Auf Localhost ohne
// Vercel-Header fällt Schritt 3 weg.

import { headers } from "next/headers";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import {
  CYPRUS_REGIONS,
  regionBySlug,
  regionFromText,
  type CyprusRegion,
} from "@/lib/geo/cyprus-regions";

export type RegionDetection = {
  region: CyprusRegion | null;
  source: "url" | "search_profile" | "ip" | "none";
};

export async function detectRegion(opts?: {
  urlSlug?: string | null;
}): Promise<RegionDetection> {
  // 1. URL-Param-Override
  const fromUrl = regionBySlug(opts?.urlSlug);
  if (fromUrl) return { region: fromUrl, source: "url" };

  // 2. Letzte aktive search_profile.location des Users
  const fromProfile = await regionFromActiveSearchProfile();
  if (fromProfile) return { region: fromProfile, source: "search_profile" };

  // 3. IP-Geo via Vercel-Header
  const fromIp = await regionFromVercelHeaders();
  if (fromIp) return { region: fromIp, source: "ip" };

  return { region: null, source: "none" };
}

async function regionFromActiveSearchProfile(): Promise<CyprusRegion | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("search_profiles")
    .select("location, updated_at")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return regionFromText(data?.location);
}

async function regionFromVercelHeaders(): Promise<CyprusRegion | null> {
  const h = await headers();
  // Vercel setzt x-vercel-ip-city (URL-encoded). Beispiel: "Paphos", "Pegeia",
  // "Larnaca". Auf Localhost / Self-Hosted fehlt der Header.
  const cityRaw = h.get("x-vercel-ip-city");
  if (!cityRaw) return null;
  let city: string;
  try {
    city = decodeURIComponent(cityRaw);
  } catch {
    city = cityRaw;
  }
  return regionFromText(city);
}

export { CYPRUS_REGIONS };
