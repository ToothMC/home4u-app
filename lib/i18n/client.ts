"use client";

import * as React from "react";
import { makeT, type T } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/provider";
import type { SupportedLang } from "@/lib/lang/preferred-language";

/**
 * Client-side Übersetzungs-Hook. Liest die Sprache aus dem `LangProvider`-
 * Context, der vom Root-Layout vom Server befüllt wird (preferred_language
 * aus profiles → home4u_lang Cookie → DEFAULT_LANG). Damit haben Client-
 * Components beim ersten Render bereits die korrekte Sprache, kein Flash.
 */
export function useT(): { t: T; lang: SupportedLang } {
  const lang = useLang();
  const t = React.useMemo(() => makeT(lang), [lang]);
  return { t, lang };
}
