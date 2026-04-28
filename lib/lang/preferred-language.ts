import { cookies } from "next/headers";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

export type SupportedLang = "de" | "en" | "ru" | "el";

const SUPPORTED: SupportedLang[] = ["de", "en", "ru", "el"];

/**
 * Liefert die bevorzugte Sprache des aktuellen Besuchers.
 * Quelle (in dieser Reihenfolge): profiles.preferred_language → Cookie
 * home4u_lang → null (Caller entscheidet Default).
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

  return null;
}
