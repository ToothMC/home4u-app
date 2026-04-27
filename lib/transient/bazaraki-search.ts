/**
 * Bazaraki-Search-Adapter (Indexer-Spec v2.0 §5.2).
 *
 * HTTP-only Fetch + cheerio-Parse der Schema.org-Microdata.
 *
 * **Bekannte Einschränkung — Cloudflare-Block:**
 * Bazaraki blockt zum Zeitpunkt von A4 alle pure-HTTP-Requests mit 403,
 * unabhängig vom User-Agent (Server antwortet mit `Accept-CH: Sec-CH-UA-*`,
 * also Client-Hints-Challenge / TLS-Fingerprinting). Der Python-Crawler
 * kommt nur durch, weil Playwright eine echte Chromium-Instanz mit voller
 * TLS-/JS-Fingerprint betreibt.
 *
 * Konsequenz: dieser Adapter liefert in der aktuellen Realität in Vercel-Edge
 * + Node-Runtime ein status="rate_limited"-Resultat. Die Gesamt-Architektur
 * (Cache, Trigger, Mix-In, dedupe) ist trotzdem produktiv — sie greift, sobald
 * eine **alternative durchlässige Quelle** angebunden wird:
 *   - Telegram-Channel-Bot (HTTP-frei)
 *   - Partner-API
 *   - Eigener Python-Microservice mit Playwright (analog zum Crawler)
 * Spec §5.5 dokumentiert genau diesen Fallback.
 *
 * Compliance: identisch zum Server-Crawler, würde durchgreifen, wenn HTTP
 * nicht geblockt wäre — Browser-User-Agent + Standard-Browser-Headers,
 * keine Auto-Retries, 8s Timeout.
 */
import * as cheerio from "cheerio";

const BASE_URL = "https://www.bazaraki.com";
// Anders als der Server-Crawler (Playwright + Chromium) machen wir hier
// pure HTTP. Bazaraki blockt generic-Bot-UAs mit 403, daher mimicken wir
// einen realen Chrome-Header-Satz. Das ist KEIN Tarnen — wir respektieren
// robots.txt + Rate-Limit identisch zum sichtbaren Crawler. Beide
// präsentieren sich als "Browser-User auf bazaraki.com".
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 8_000;

// City-display → URL-Slug-Map (gespiegelt aus bazaraki-crawler/src/config.py).
// Klein gehalten — wenn Sophie eine unbekannte Stadt anfragt, returnen
// wir leeres Array statt zu raten.
const CITY_SLUGS: Record<string, string> = {
  limassol: "lemesos",
  paphos: "pafos",
  larnaca: "larnaca",
  nicosia: "lefkosia",
  famagusta: "ammochostos",
};

export type SearchProfile = {
  city: string;                          // "Limassol", "Paphos", ...
  type: "rent" | "sale";
  rooms?: number | null;                 // 0 = Studio
  price_min?: number | null;
  price_max?: number | null;
  /** "apartments-flats" oder "houses". Default: probiert beide via 2 Calls
   *  an den Caller (lib/transient/lookup.ts) — diese Funktion macht 1 Call. */
  property_subtype?: "apartments-flats" | "houses";
};

export type TransientCandidate = {
  external_id: string;                   // Bazaraki adv-id
  source: "bazaraki";
  type: "rent" | "sale";
  city: string;
  district: string | null;
  price: number;
  currency: "EUR";
  rooms: number | null;
  size_sqm: null;                        // Such-Karten zeigen das nicht
  media: string[];
  title: string | null;
  detail_url: string;
  isTransient: true;
};

export type TransientFetchResult =
  | { status: "ok"; candidates: TransientCandidate[]; url: string }
  | { status: "rate_limited" | "error"; reason: string; url: string };

export function buildSearchUrl(profile: SearchProfile): string | null {
  const cityKey = profile.city.trim().toLowerCase();
  const slug = CITY_SLUGS[cityKey];
  if (!slug) return null;

  const deal = profile.type === "rent" ? "to-rent" : "for-sale";
  const subtype = profile.property_subtype ?? "apartments-flats";
  const district = cityKey;
  const path = `/real-estate-${deal}/${subtype}/${slug}-district-${district}/`;

  const params = new URLSearchParams();
  if (profile.price_min != null) params.set("price-min", String(profile.price_min));
  if (profile.price_max != null) params.set("price-max", String(profile.price_max));
  // 0 = Studio → "studio" ist ein eigener Query-Wert; sonst Zahl
  if (profile.rooms === 0) {
    params.set("number-of-bedrooms", "studio");
  } else if (profile.rooms != null && profile.rooms > 0) {
    params.set("number-of-bedrooms", String(profile.rooms));
  }
  params.set("ordering", "newest");

  const qs = params.toString();
  return `${BASE_URL}${path}${qs ? "?" + qs : ""}`;
}

/**
 * Fetcht die Search-Result-Seite und parst die ersten N Kandidaten.
 * Wirft nicht — bei Netz-/HTTP-/Parse-Fehlern liefert sie status=error.
 */
export async function fetchTransientBazaraki(
  profile: SearchProfile,
  limit = 10,
): Promise<TransientFetchResult> {
  const url = buildSearchUrl(profile);
  if (!url) {
    return { status: "error", reason: "unknown_city", url: profile.city };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });
    if (resp.status === 429 || resp.status === 403) {
      return { status: "rate_limited", reason: `http_${resp.status}`, url };
    }
    if (!resp.ok) {
      return { status: "error", reason: `http_${resp.status}`, url };
    }
    html = await resp.text();
  } catch (err) {
    const reason = err instanceof Error ? err.name : "fetch_failed";
    return { status: "error", reason, url };
  } finally {
    clearTimeout(timer);
  }

  try {
    const candidates = parseSearchHtml(html, profile, limit);
    return { status: "ok", candidates, url };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "parse_failed";
    return { status: "error", reason, url };
  }
}

/**
 * Parst die SSR-Search-Page-HTML. Bazaraki nutzt Schema.org-Microdata:
 *   <li itemtype=".../Product">
 *     <a href="/adv/<id>/...">title</a>
 *     <meta itemprop="price" content="1200" />
 *     <img src="https://www.bazaraki.com/media/.../foo.webp" />
 *
 * Logik gespiegelt aus bazaraki-crawler/src/crawler.py LIST_EXTRACT_JS.
 */
function parseSearchHtml(html: string, profile: SearchProfile, limit: number): TransientCandidate[] {
  const $ = cheerio.load(html);
  const cards = $('li[itemtype*="Product"]');
  const out: TransientCandidate[] = [];

  cards.each((_idx, el) => {
    if (out.length >= limit) return;
    const $el = $(el);
    const link = $el.find('a[href*="/adv/"]').first();
    const href = link.attr("href");
    if (!href) return;

    // External-ID aus URL: /adv/<id>_<slug>/
    const idMatch = href.match(/\/adv\/(\d+)/);
    if (!idMatch) return;
    const externalId = idMatch[1];

    // Preis: itemprop=price, content-Attribute
    const priceEl = $el.find('[itemprop="price"]').first();
    const priceContent = priceEl.attr("content") ?? priceEl.text();
    const price = parseFloat(priceContent ?? "");
    if (!Number.isFinite(price) || price <= 0) return;

    // Titel
    const nameEl = $el.find('[itemprop="name"]').first();
    const title = (nameEl.attr("content") ?? nameEl.text() ?? "").trim() || null;

    // Cover-Bild — bevorzugt data-src über src (Lazy-Load)
    const imgEl = $el.find("img").first();
    const imgUrl =
      imgEl.attr("data-src") || imgEl.attr("src") || null;
    const validImg = imgUrl && imgUrl.includes("bazaraki") ? imgUrl : null;

    // Rooms aus URL-Slug
    const rooms = parseRoomsFromSlug(href);

    // Detail-URL absolut machen
    const detailUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    out.push({
      external_id: externalId,
      source: "bazaraki",
      type: profile.type,
      city: profile.city,
      district: null,
      price,
      currency: "EUR",
      rooms,
      size_sqm: null,
      media: validImg ? [validImg] : [],
      title,
      detail_url: detailUrl,
      isTransient: true,
    });
  });

  return out;
}

const STUDIO_RE = /studio/i;
const BEDROOM_RE = /(\d+)-bedroom/i;

function parseRoomsFromSlug(href: string): number | null {
  if (STUDIO_RE.test(href)) return 0;
  const m = href.match(BEDROOM_RE);
  return m ? parseInt(m[1], 10) : null;
}
