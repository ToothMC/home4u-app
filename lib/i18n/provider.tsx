"use client";

import * as React from "react";
import { DEFAULT_LANG } from "@/lib/i18n/dict";
import type { SupportedLang } from "@/lib/lang/preferred-language";

const LangContext = React.createContext<SupportedLang>(DEFAULT_LANG);

export function LangProvider({
  lang,
  children,
}: {
  lang: SupportedLang;
  children: React.ReactNode;
}) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): SupportedLang {
  return React.useContext(LangContext);
}
