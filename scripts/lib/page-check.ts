/**
 * Entscheidungslogik der Bazaraki-Seitenprüfung — rein, ohne Netz/DB,
 * damit sie offline testbar ist (scripts/page-check.test.ts).
 *
 * Stilllegen nur bei ZWEI unabhängigen Belegen:
 *   1. Titelbild beim Anbieter gelöscht (media_ok=false, Bildcheck) und
 *   2. Inserat-Seite unter der gespeicherten URL liefert 404/410.
 * 404 allein reicht nicht: Bazaraki antwortet auch bei falschem Slug mit 404
 * (geprüft 2026-10-26), ein geänderter Titel könnte also ein lebendes
 * Inserat "töten". Ein geänderter Slug löscht aber kein Bild.
 */

export type PageVerdict = "alive" | "gone" | "unknown";
export type Action = "stale" | "touch" | "skip";

/** HTTP-Status der Inserat-Seite (ohne Redirects zu folgen) deuten. */
export function classifyStatus(status: number): PageVerdict {
  if (status === 200) return "alive";
  if (status === 404 || status === 410) return "gone";
  // 3xx (unbekanntes Ziel), 403/429/5xx (Cloudflare, Rate-Limit, Störung),
  // 0 (Netzfehler/Timeout): kein Beleg in die eine oder andere Richtung.
  return "unknown";
}

/**
 * - gone + Bild vorhanden (und gelöscht)  → stale
 * - gone ohne Bild (leeres media-Array)   → skip: dann fehlt Beleg 1
 * - alive                                  → touch: lebt nachweislich
 * - unknown                                → skip
 */
export function decide(verdict: PageVerdict, hasMedia: boolean): Action {
  if (verdict === "alive") return "touch";
  if (verdict === "gone" && hasMedia) return "stale";
  return "skip";
}

export type Tally = { alive: number; gone: number; unknown: number };

/**
 * Kontrollprobe: frische Inserate mit intaktem Bild müssen fast alle 200
 * liefern. Tun sie das nicht, stimmt etwas Grundsätzliches nicht (URL-Format
 * geändert, Block, Wartungsseite) — dann nichts schreiben.
 */
export function controlsHealthy(t: Tally, minAliveShare = 0.8): boolean {
  const n = t.alive + t.gone + t.unknown;
  return n > 0 && t.alive / n >= minAliveShare;
}

/**
 * Blockade-Erkennung während des Laufs: liefert der Großteil der Anfragen
 * weder 200 noch 404, reden wir vermutlich nicht mehr mit dem echten Origin
 * (Cloudflare-Challenge, 429). Dann abbrechen statt weiterzumachen.
 */
export function looksBlocked(t: Tally, minSample = 50, maxUnknownShare = 0.5): boolean {
  const n = t.alive + t.gone + t.unknown;
  return n >= minSample && t.unknown / n > maxUnknownShare;
}
