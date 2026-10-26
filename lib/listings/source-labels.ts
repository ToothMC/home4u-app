/** Anzeigename je Quelle (`listings.source`). Eine Liste für alle Stellen —
 *  vorher gab es vier Kopien, in keiner stand BSC. */
export const SOURCE_LABELS: Record<string, string> = {
  bazaraki: "Bazaraki",
  index_cy: "INDEX.cy",
  bsc: "BuySellCyprus",
  cyprus_real_estate: "Cyprus-Real.Estate",
  cy_developer: "Developer",
  fb: "Facebook",
  direct: "Home4U",
  other: "—",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
