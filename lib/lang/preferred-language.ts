import { cookies, headers } from "next/headers";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

export type SupportedLang = "de" | "en" | "ru" | "el" | "zh";

const SUPPORTED: SupportedLang[] = ["de", "en", "ru", "el", "zh"];

/**
 * Liefert die bevorzugte Sprache des aktuellen Besuchers.
 * Quelle (in dieser Reihenfolge): profiles.preferred_language → Cookie
 * home4u_lang → Accept-Language des Browsers → null (Caller entscheidet
 * Default).
 *
 * Der Accept-Language-Schritt greift nur beim Erstbesuch ohne Cookie. Sobald
 * der Besucher die Flagge im Header benutzt oder einen Link mit ?lang=
 * aufruft (siehe middleware.ts), gewinnt immer seine explizite Wahl.
 */
export async function getPreferredLanguage(): Promise<SupportedLang | null> {
  const user = await getAuthUser();
  if (user) {
    const supabase = createSupabaseServiceClient();
    if (supabase) {
      const { data } = await supabase
        .from("profiles")
        .select("preferred_language")
        .eq("id", user.id)
        .maybeSingle();
      const lang = data?.preferred_language as string | null | undefined;
      if (lang && SUPPORTED.includes(lang as SupportedLang)) {
        return lang as SupportedLang;
      }
    }
  }

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get("home4u_lang")?.value;
  if (fromCookie && SUPPORTED.includes(fromCookie as SupportedLang)) {
    return fromCookie as SupportedLang;
  }

  const headerStore = await headers();
  const fromBrowser = parseAcceptLanguage(headerStore.get("accept-language"));
  if (fromBrowser) return fromBrowser;

  return null;
}

/**
 * Wertet den Accept-Language-Header aus und liefert die am hoechsten
 * gewichtete von Home4U unterstuetzte Sprache.
 *
 * Beispiel: "el-CY,el;q=0.9,en-GB;q=0.8,de;q=0.5" → "el"
 * Regionale Tags werden auf den Sprachcode verkuerzt (el-CY → el, en-GB → en).
 */
function parseAcceptLanguage(value: string | null): SupportedLang | null {
  if (!value) return null;

  const ranked = value
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().toLowerCase().startsWith("q="));
      const parsed = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      const quality = Number.isFinite(parsed) ? parsed : 0;
      return { tag: tag.trim().toLowerCase(), quality };
    })
    .filter((entry) => entry.tag.length > 0 && entry.tag !== "*" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const short = tag.slice(0, 2) as SupportedLang;
    if (SUPPORTED.includes(short)) return short;
  }

  return null;
}
