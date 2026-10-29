// Kanonische Basis-URL für alle absoluten Links: Sitemaps, robots.txt,
// canonical/OG-Metadaten, E-Mails, Telegram-Nachrichten.
//
// Vercel leitet home4u.ai auf www.home4u.ai um (Domain-Einstellung im
// Projekt). Links auf die nackte Domain sind also nie die End-Adresse:
// Suchmaschinen sehen in robots.txt und Sitemaps URLs, die erst umleiten.
// Darum ist www die Vorgabe, und ein auf die nackte Domain gesetztes
// NEXT_PUBLIC_BASE_URL wird ebenfalls auf www gezogen.

const CANONICAL_SITE_URL = "https://www.home4u.ai";

/**
 * Basis-URL ohne abschließenden Slash.
 * `fallback` greift nur, wenn NEXT_PUBLIC_BASE_URL fehlt (z. B. die
 * Deployment-URL bei Mail-Links aus Preview-Umgebungen).
 */
export function siteUrl(fallback?: string): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL || fallback || CANONICAL_SITE_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol
    .replace(/\/+$/, "")
    .replace(/^https?:\/\/home4u\.ai$/i, CANONICAL_SITE_URL);
}
