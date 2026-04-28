"use client";

import * as React from "react";

/**
 * True wenn der Viewport ≥ 768 px breit ist (Tailwind `md:`-Breakpoint).
 * Verwendet für Decisions wie „target='_blank' nur auf Desktop, sonst
 * gleicher Tab" — auf Mobile-Browsern gehört Tab-Sparsamkeit zur UX.
 *
 * SSR-sicher: erste Render-Pass gibt false zurück (Mobile-First-Default).
 * Nach Hydration via `useEffect` updatet sich der Wert. Click-Events
 * passieren immer post-Hydration, also kommt der echte Wert rechtzeitig.
 */
export function useIsDesktop(minWidthPx = 768): boolean {
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidthPx}px)`);
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [minWidthPx]);
  return isDesktop;
}
