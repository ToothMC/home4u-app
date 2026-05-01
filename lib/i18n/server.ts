import { getPreferredLanguage } from "@/lib/lang/preferred-language";
import { DEFAULT_LANG, makeT, type T } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

export async function getT(): Promise<{ t: T; lang: SupportedLang }> {
  const lang = (await getPreferredLanguage()) ?? DEFAULT_LANG;
  return { t: makeT(lang), lang };
}
