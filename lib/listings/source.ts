/**
 * Helfer rund um die Listing-Quelle (Bridge vs. Plattform).
 *
 * Bridge-Listings sind aus externen Quellen indexiert (Bazaraki, FB, …) —
 * Anbieter haben sich nicht aktiv bei Home4U registriert. Für sie zeigen
 * wir „Zum Original →" statt eines Direkt-Kontakt-Buttons.
 *
 * Platform-Listings (`source = 'direct'`) sind echte Home4U-Anbieter mit
 * Account und Kontakt-Settings.
 */

export type ListingSource = "bazaraki" | "fb" | "direct" | "other";

export function isBridgeSource(source: string | null | undefined): boolean {
  return source === "bazaraki" || source === "fb" || source === "other";
}

export function isPlatformSource(source: string | null | undefined): boolean {
  return source === "direct";
}

/**
 * Baut die externe Original-URL für ein Bridge-Listing — nur wenn sich
 * die Quelle deterministisch aus (source, external_id) konstruieren
 * lässt. Liefert sonst null.
 */
export function buildSourceUrl(
  source: string | null | undefined,
  externalId: string | null | undefined
): string | null {
  if (!externalId) return null;
  switch (source) {
    case "bazaraki":
      return `https://www.bazaraki.com/adv/${encodeURIComponent(externalId)}/`;
    case "fb":
      // FB-Post-URLs brauchen Page-ID + Post-ID; externalId allein reicht
      // nicht — daher kein deterministischer Link.
      return null;
    default:
      return null;
  }
}

export const SOURCE_LABEL: Record<string, string> = {
  bazaraki: "Bazaraki",
  fb: "Facebook",
  direct: "Home4U",
  other: "Externe Quelle",
};

export function sourceLabel(source: string | null | undefined): string {
  return SOURCE_LABEL[source ?? ""] ?? "Externe Quelle";
}
