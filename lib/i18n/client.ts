"use client";

import * as React from "react";
import { DEFAULT_LANG, makeT, type T } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

const SUPPORTED: SupportedLang[] = ["de", "en", "ru", "el", "zh"];

function readLangCookie(): SupportedLang | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )home4u_lang=([^;]+)/);
  if (!m) return null;
  const v = decodeURIComponent(m[1]) as SupportedLang;
  return SUPPORTED.includes(v) ? v : null;
}

/**
 * Client-side Übersetzungs-Hook. Liest die Sprache aus dem `home4u_lang`
 * Cookie. Rendert beim ersten SSR-Pass mit DEFAULT_LANG (kein Cookie verfügbar)
 * und tauscht beim Hydration-Pass die Sprache. Für die meisten Strings ist
 * der kurze Flash unproblematisch — Server Components nutzen `getT()`, das
 * den Profile-DB-Wert respektiert und ist hier vorzuziehen, wo möglich.
 */
export function useT(): { t: T; lang: SupportedLang } {
  const [lang, setLang] = React.useState<SupportedLang>(DEFAULT_LANG);
  React.useEffect(() => {
    const c = readLangCookie();
    if (c && c !== lang) setLang(c);
  }, [lang]);
  const t = React.useMemo(() => makeT(lang), [lang]);
  return { t, lang };
}
