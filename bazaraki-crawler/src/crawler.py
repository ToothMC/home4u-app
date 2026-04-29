"""Playwright-basierter Crawler — robots.txt-respektierend, Rate-limited."""
from __future__ import annotations

import logging
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Iterator

import httpx
from playwright.sync_api import Browser, Page, sync_playwright
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import (
    BASE_URL,
    MAX_PAGES_PER_CITY,
    RATE_LIMIT_SECONDS,
    ROBOTS_URL,
    USER_AGENT,
    CityConfig,
    build_listing_url,
    home4u_property_type,
)

log = logging.getLogger(__name__)


@dataclass
class RawListing:
    """Roh-Datensatz pro Listing — wird vom Writer ins Schema gemappt.

    Werte aus der Listenseite werden ggf. von der Detail-Page überschrieben
    (z. B. city: Listenseite-Stadt vs. echte Adresse aus Detail).
    """
    external_id: str        # Bazaraki adv-ID (Primärschlüssel)
    listing_type: str       # rent|sale
    city: str               # Anzeigename — wird ggf. von Detail überschrieben
    price: float            # numerisch, EUR
    rooms: int | None       # 0 = Studio
    image_url: str | None   # Cover-Bild (Listenseite)
    title: str | None       # für Debug-Logs
    detail_url: str         # für Detail-Drilling
    property_type: str | None  # Home4U-Taxonomie: apartment|house|room|plot

    # Detail-Felder (None solange noch nicht gedrillt)
    district: str | None = None
    size_sqm: int | None = None
    media: list[str] = field(default_factory=list)  # alle Bilder, [0] = Cover
    description: str | None = None
    energy_class: str | None = None
    furnishing: str | None = None
    pets_allowed: bool | None = None

    # Indexer-Spec v2.0 §2.2 / §4.2: Roh-Output für Re-Processing.
    # Bazaraki ist eine strukturierte Quelle (Schema.org + Characteristics-
    # Block), darum konstante Confidence — keine LLM-Extraktion wie bei FB.
    extracted_data: dict | None = None  # {chars_raw, schema_address, ...}
    # 0.5 ohne Detail-Drilling (nur Listenseite), 0.85 mit Detail.
    # crawl_detail() hebt das auf 0.85 bei erfolgreichem Drill.
    confidence: float = 0.5

    # Dedup-Signale (Spur 0048): cover_phash für pHash-Match,
    # phone_hash für Phone-Match. Beide werden post-list/post-detail
    # gefüllt, je nach Verfügbarkeit. Cover-pHash wird über
    # dedup.compute_phash_from_url(image_url oder media[0]) gebildet.
    cover_phash: int | None = None
    phone_hash: str | None = None

    # Klartext-Kontaktdaten für Outreach (encrypted server-side im RPC).
    # Phone wird per "Show Phone"-Click in crawl_detail() geholt, wenn die
    # Detail-Seite den Button hat. Email findet sich bei Bazaraki kaum, ist
    # aber für andere Quellen (INDEX, home.cy) relevant.
    contact_phone: str | None = None
    contact_phone_country: str | None = None
    contact_email: str | None = None


# ---------- robots.txt ----------

_DISALLOW_RE = re.compile(r"^Disallow:\s*(.*)$", re.IGNORECASE)


def fetch_disallowed_paths() -> list[str]:
    """Liefert Disallow-Pfade für unseren User-Agent (oder *)."""
    try:
        resp = httpx.get(ROBOTS_URL, timeout=10, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()
    except Exception as e:
        log.warning("robots.txt fetch failed (%s) — defensiv: keine Pfade gesperrt", e)
        return []

    disallowed: list[str] = []
    current_agent_matches = False
    for line in resp.text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("user-agent:"):
            agent = line.split(":", 1)[1].strip()
            current_agent_matches = agent == "*" or "home4u" in agent.lower()
            continue
        if not current_agent_matches:
            continue
        m = _DISALLOW_RE.match(line)
        if m:
            path = m.group(1).strip()
            if path:
                disallowed.append(path)
    return disallowed


def is_path_allowed(path: str, disallowed: list[str]) -> bool:
    return not any(path.startswith(rule) for rule in disallowed)


# ---------- Rooms aus URL-Slug ableiten ----------

_STUDIO_RE = re.compile(r"studio", re.IGNORECASE)
_BEDROOM_RE = re.compile(r"(\d+)-bedroom", re.IGNORECASE)


def parse_rooms_from_slug(url: str) -> int | None:
    """Bazaraki-URLs codieren rooms im Slug: studio/1-bedroom/2-bedroom/..."""
    slug = url.split("/adv/", 1)[-1]
    if _STUDIO_RE.search(slug):
        return 0
    m = _BEDROOM_RE.search(slug)
    if m:
        return int(m.group(1))
    return None


# ---------- Playwright-Crawl: Listenseite ----------
#
# Bazaraki rendert je nach Page unterschiedliche Layouts:
#   - p1 (organisch + promoted gemischt): hat sowohl `li[itemtype*="Product"]`
#     als auch `.advert.js-item-listing`. Promoted-only Cards sind nur als
#     `.advert` markiert — der frühere Selektor verlor sie (15 von 60).
#   - p2+: hat NUR `.advert.js-item-listing`, kein schema.org-Markup.
# Lösung: einheitlich auf `.advert.js-item-listing` selecten, beide Layouts
# decken price/name aus den selben Selektoren ab (mit schema.org-Fallback).
LIST_EXTRACT_JS = r"""
() => {
  const cards = Array.from(document.querySelectorAll('.advert.js-item-listing'));
  return cards.map(card => {
    // External-ID: data-id ist sauber; Fallback URL-Regex.
    const link = card.querySelector('a[href*="/adv/"]');
    if (!link) return null;
    let advId = card.dataset?.id || null;
    if (!advId) {
      const m = (link.pathname || '').match(/\/adv\/(\d+)/);
      advId = m ? m[1] : null;
    }
    if (!advId) return null;

    // Sauberer URL ohne ?p=N Pagination-Suffix
    const url = new URL(link.pathname, location.origin).href;

    // Preis: schema.org [itemprop=price][content] (p1-Layout) → numerisch.
    // Fallback Text aus .advert__content-price (p2+-Layout, "€4.800" / "€680").
    let price = null;
    const ipEl = card.querySelector('[itemprop="price"][content]');
    if (ipEl) {
      const v = parseFloat(ipEl.getAttribute('content'));
      if (!Number.isNaN(v)) price = v;
    }
    if (price == null) {
      const txt = card.querySelector('.advert__content-price')?.innerText?.trim();
      if (txt) {
        // Erste Ziffern-Sequenz extrahieren — schützt vor Range "€1000 - €2000".
        const m = txt.match(/(\d[\d.,]*)/);
        if (m) {
          // Bazaraki nutzt deutsches Format: . = Tausender, , = Dezimal.
          const numeric = m[1].replace(/\./g, '').replace(',', '.');
          const v = parseFloat(numeric);
          if (!Number.isNaN(v)) price = v;
        }
      }
    }

    // Name: schema.org first, sonst .advert__content-title.
    const name = card.querySelector('[itemprop="name"]')?.getAttribute('content')
              || card.querySelector('[itemprop="name"]')?.textContent?.trim()
              || card.querySelector('.advert__content-title')?.innerText?.trim()
              || null;

    // Cover-Bild (best-effort): swiper-slide[data-background] hat das echte
    // hi-res Bild; <img> ist oft nur Placeholder. Detail-Drill liefert die
    // volle Galerie, hier reicht ein Fallback.
    let img = null;
    const slideBg = card.querySelector('.swiper-slide[data-background*="bazaraki"]');
    if (slideBg) {
      img = slideBg.getAttribute('data-background');
    } else {
      const imgEl = card.querySelector('img[src*="bazaraki"], img[data-src*="bazaraki"]');
      img = imgEl?.getAttribute('data-src') || imgEl?.src || null;
    }

    return { url, advId, price, name, img };
  }).filter(c => c && c.price != null);
}
"""


# ---------- Playwright-Crawl: Detail-Page ----------

DETAIL_EXTRACT_JS = r"""
() => {
  const text = (sel, attr) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return attr ? (el.getAttribute(attr) || null) : (el.textContent?.trim() || null);
  };

  // Adresse aus Schema.org → "City, District" oder "City, District - Sub-area"
  const address = text('[itemprop="address"]');

  // Beschreibung — itemprop="description" enthält oft Übersetzungs-Widget,
  // og:description liefert sauber den ersten Absatz
  let description = text('meta[property="og:description"]', 'content');
  if (!description) {
    description = text('[itemprop="description"]');
  }
  if (description) description = description.trim().slice(0, 4000);

  // Characteristics-Block: Plain-Text → label: value je Zeile
  const charsBlock = document.querySelector('.announcement-characteristics, [class*="chars"]');
  const charsRaw = charsBlock?.innerText?.trim() || null;

  // Galerie-Hauptbilder. Bazaraki nutzt Slick-Carousel mit Lazy-Load:
  // - .announcement__images-item: trägt das hi-res Bild (1600px) im data-src;
  //   src ist meist nur ein 160×104-Placeholder.
  // - .announcement__thumbnails-item (Nav-Strip): tiny — bewusst ausschließen.
  // Es gibt kein srcset und keine Größen-Pfad-Variante; data-src ist der einzige Hi-Res-Pfad.
  const allImages = [...new Set(
    Array.from(document.querySelectorAll('img.announcement__images-item'))
      .map(i => i.getAttribute('data-src') || i.src)
      .filter(s => s && s.includes('bazaraki.com/media') && /\.(jpe?g|png|webp)/i.test(s))
  )];

  // Cover (og:image)
  const cover = text('meta[property="og:image"]', 'content');

  // Kontaktdaten (best-effort, nur wenn ohne Click sichtbar):
  // - Phone: <a href="tel:+357..."> oder Klartext im Phones-Block.
  // - Email: <a href="mailto:..."> oder Plaintext-Pattern.
  // Bazaraki versteckt Phones meist hinter "Show phone"-Button; falls ja
  // bleibt phone null und wir versuchen Click-Reveal in der Python-Schicht.
  let phone = null;
  const telA = document.querySelector('a[href^="tel:"]');
  if (telA) {
    const href = telA.getAttribute('href') || '';
    phone = href.replace(/^tel:/i, '').trim() || null;
  }
  if (!phone) {
    // Fallback: data-attribute, das nach Click-Reveal gefüllt wird
    const phoneBlock = document.querySelector('[data-phone], .phone-list a, .show-phone');
    if (phoneBlock) {
      const dp = phoneBlock.getAttribute('data-phone');
      const txt = phoneBlock.textContent?.trim();
      if (dp) phone = dp;
      else if (txt && /\d/.test(txt) && !/show/i.test(txt)) phone = txt;
    }
  }

  let email = null;
  const mailA = document.querySelector('a[href^="mailto:"]');
  if (mailA) {
    const href = mailA.getAttribute('href') || '';
    email = href.replace(/^mailto:/i, '').split('?')[0].trim() || null;
  }

  return { address, description, charsRaw, cover, allImages, phone, email };
}
"""

# Selector für "Show phone"-Button. Bazaraki rendert ihn variabel — wir
# probieren mehrere Pattern. Click→XHR→DOM-Update mit echter Nummer.
SHOW_PHONE_SELECTORS = [
    'button.show-phone',
    'a.show-phone',
    'button[data-action="show-phone"]',
    'a[data-action="show-phone"]',
    'button:has-text("Show phone")',
    'a:has-text("Show phone")',
]


# Charakteristik-Parser: parse "Property area: 50 m²\nBedrooms: Studio\n..."
_CHARS_LINE_RE = re.compile(r"^([^:]+):\s*(.+)$")


def parse_chars(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    out: dict[str, str] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        m = _CHARS_LINE_RE.match(line)
        if m:
            label = m.group(1).strip()
            value = m.group(2).strip()
            if label and value:
                out[label] = value
    return out


def parse_size_sqm(chars: dict[str, str]) -> int | None:
    val = chars.get("Property area") or chars.get("Covered area") or chars.get("Area")
    if not val:
        return None
    m = re.search(r"(\d+)", val)
    return int(m.group(1)) if m else None


def parse_rooms_from_chars(chars: dict[str, str]) -> int | None:
    val = chars.get("Bedrooms")
    if not val:
        return None
    if "studio" in val.lower():
        return 0
    m = re.search(r"(\d+)", val)
    return int(m.group(1)) if m else None


def parse_pets_allowed(chars: dict[str, str]) -> bool | None:
    val = chars.get("Pets")
    if not val:
        return None
    v = val.lower()
    if "allowed" in v and "not" not in v:
        return True
    if "not allowed" in v or "not" in v:
        return False
    return None


def parse_address(address: str | None) -> tuple[str | None, str | None]:
    """'Nicosia, Lakatameia - Agios Mamas' → ('Nicosia', 'Lakatameia - Agios Mamas')."""
    if not address:
        return None, None
    parts = [p.strip() for p in address.split(",", 1)]
    if len(parts) == 1:
        return parts[0] or None, None
    return parts[0] or None, parts[1] or None


# ---------- Navigation ----------

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _goto_list(page: Page, url: str) -> None:
    """Navigation only — Retry für transiente Netzwerkfehler.

    Aufgesplittet von der frühren `_navigate_list`-Funktion: das Warten auf
    Cards ist kein transienter Fehler (sondern Pagination-Ende oder Empty),
    also gehört es nicht in die Retry-Schleife.
    """
    log.info("→ list %s", url)
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)


def _wait_for_cards(page: Page, timeout_ms: int = 8_000) -> bool:
    """Wartet auf Listen-Cards. False = keine Cards (Pagination-Ende oder Empty)."""
    try:
        page.wait_for_selector(".advert.js-item-listing", timeout=timeout_ms)
        return True
    except Exception:
        return False


def _redirected_away_from_page(page_url: str, expected_page: int) -> bool:
    """Bazaraki redirected ?page=N hinter dem echten Ende auf die letzte Page.

    Beispiel: ?page=999 → URL endet final auf ?page=49 (siehe empirische Tests
    2026-04-28). Erkennen wir das, brechen wir die Pagination sauber ab statt
    weitere ?page=50…N abzufragen.
    """
    if expected_page <= 1:
        return False
    qs = urllib.parse.urlparse(page_url).query
    final_pages = urllib.parse.parse_qs(qs).get("page", [])
    if not final_pages:
        # Bazaraki kann auch zur ersten Page ohne ?page= zurückwerfen
        return True
    try:
        return int(final_pages[0]) != expected_page
    except ValueError:
        return False


@retry(stop=stop_after_attempt(2), wait=wait_exponential(min=2, max=10))
def _navigate_detail(page: Page, url: str) -> None:
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    # Detail-Seite: warten auf Schema.org-Address oder Characteristics-Block
    page.wait_for_selector(
        '[itemprop="address"], .announcement-characteristics, [class*="chars"]',
        timeout=10_000,
    )


def _extract_list_page(page: Page, city: str, listing_type: str, subtype: str) -> list[RawListing]:
    raw = page.evaluate(LIST_EXTRACT_JS)
    property_type = home4u_property_type(subtype)
    out: list[RawListing] = []
    for entry in raw:
        if not entry["price"] or not entry["advId"]:
            continue
        out.append(
            RawListing(
                external_id=str(entry["advId"]),
                listing_type=listing_type,
                city=city,
                price=float(entry["price"]),
                rooms=parse_rooms_from_slug(entry["url"]),
                image_url=entry["img"] if entry["img"] and "bazaraki" in entry["img"] else None,
                title=entry["name"],
                detail_url=entry["url"],
                property_type=property_type,
            )
        )
    return out


def crawl_detail(browser: Browser, item: RawListing) -> None:
    """Drill in die Detail-Page und reichere RawListing in-place an.

    Schreibt city (override), district, size_sqm, rooms (override wenn präziser),
    media (komplette Galerie inkl. Cover), description, energy_class, furnishing, pets_allowed.
    Bei Fehler: nichts ändern, Log-Warnung.
    """
    page = browser.new_page(user_agent=USER_AGENT)
    try:
        _navigate_detail(page, item.detail_url)
        data = page.evaluate(DETAIL_EXTRACT_JS)

        # Wenn Phone nicht direkt sichtbar ist, "Show phone"-Button klicken
        # und kurz auf XHR/DOM-Update warten. Best-effort: bei Fehler oder
        # fehlendem Button bleibt phone None.
        if not data.get("phone"):
            for sel in SHOW_PHONE_SELECTORS:
                try:
                    btn = page.query_selector(sel)
                    if btn:
                        btn.click(timeout=2_000)
                        page.wait_for_timeout(800)
                        data2 = page.evaluate(DETAIL_EXTRACT_JS)
                        if data2.get("phone"):
                            data["phone"] = data2["phone"]
                        break
                except Exception:
                    continue
    except Exception as e:
        log.warning("detail-fetch failed for %s: %s", item.external_id, e)
        page.close()
        return
    page.close()

    # City + District aus echter Adresse
    city, district = parse_address(data.get("address"))
    if city:
        item.city = city
    if district:
        item.district = district

    # Characteristics
    chars = parse_chars(data.get("charsRaw"))
    size = parse_size_sqm(chars)
    if size:
        item.size_sqm = size
    rooms_from_chars = parse_rooms_from_chars(chars)
    if rooms_from_chars is not None:
        item.rooms = rooms_from_chars  # genauer als URL-Slug
    item.energy_class = chars.get("Energy Efficiency")
    item.furnishing = chars.get("Furnishing")
    item.pets_allowed = parse_pets_allowed(chars)

    # extracted_data für Re-Processing ohne Re-Crawl (Indexer-Spec v2.0 §2.2).
    # Wir packen ALLE strukturierten Roh-Outputs rein, nicht das Final-Mapping —
    # damit man bei Schema-Drift später re-extrahieren kann.
    item.extracted_data = {
        "schema_address": data.get("address"),
        "chars_raw": data.get("charsRaw"),
        "chars_parsed": chars,
        "og_description": data.get("description"),
        "og_cover": data.get("cover"),
    }
    # Detail-Drill war erfolgreich → höhere Confidence.
    item.confidence = 0.85

    # Media: Cover zuerst, dann Rest dedupliziert
    cover = data.get("cover")
    all_images = data.get("allImages") or []
    media: list[str] = []
    if cover:
        media.append(cover)
    for img in all_images:
        if img and img not in media:
            media.append(img)
    if media:
        item.media = media[:24]
    elif item.image_url:
        item.media = [item.image_url]

    # Description (clamped via JS auf 4000)
    desc = data.get("description")
    if desc:
        item.description = desc

    # Kontaktdaten — Klartext für Outreach (server-side encrypted im RPC)
    raw_phone = data.get("phone")
    if raw_phone:
        from .dedup import normalize_phone, compute_phone_hash
        norm = normalize_phone(raw_phone)
        if norm:
            # Klartext ist die normalisierte E.164-ähnliche Form (nur Ziffern,
            # mit Ländercode). Outreach-Mailer formatiert sie wieder mit "+".
            item.contact_phone = norm
            # Country-Code: erste 1-3 Ziffern. Heuristik: wenn mit "357"
            # beginnt → Cyprus; sonst Best-Guess via E.164-Liste in normalize.
            if norm.startswith("357"):
                item.contact_phone_country = "357"
            elif norm.startswith("44"):
                item.contact_phone_country = "44"
            elif norm.startswith("7"):
                item.contact_phone_country = "7"
            elif norm.startswith("30"):
                item.contact_phone_country = "30"
            else:
                # Konservativ: 1-3 stellig je nach Länge
                item.contact_phone_country = norm[:2] if len(norm) > 10 else "357"
            # phone_hash wird auch gesetzt (für Cross-Source-Dedup)
            item.phone_hash = compute_phone_hash(raw_phone)
    raw_email = data.get("email")
    if raw_email and "@" in raw_email:
        item.contact_email = raw_email.lower().strip()


def crawl_city(
    browser: Browser,
    city: CityConfig,
    listing_type: str,
    subtype: str,
    disallowed: list[str],
    max_pages: int = MAX_PAGES_PER_CITY,
) -> Iterator[RawListing]:
    """Iteriert Pages für eine City+Type+Subtype-Kombination, yieldet RawListings.

    Liefert nur die Listenseiten-Daten — Detail-Drilling macht der Caller.
    """
    seen_external_ids: set[str] = set()

    for page_num in range(1, max_pages + 1):
        url = build_listing_url(city, listing_type, subtype, page=page_num)
        path = urllib.parse.urlparse(url).path
        if not is_path_allowed(path, disallowed):
            log.warning("Pfad %s per robots.txt gesperrt — skip", path)
            return

        page = browser.new_page(user_agent=USER_AGENT)
        try:
            try:
                _goto_list(page, url)
            except Exception as e:
                log.warning("Page %s/%s/%s p%d navigate failed: %s",
                            city.display, listing_type, subtype, page_num, e)
                time.sleep(RATE_LIMIT_SECONDS)
                continue

            # Pagination-Ende-Detection vor dem Card-Wait — spart 8s Timeout.
            if _redirected_away_from_page(page.url, page_num):
                log.info("  list %s %s %s p%d: Bazaraki redirected → end of pagination",
                         city.display, listing_type, subtype, page_num)
                return

            if not _wait_for_cards(page):
                log.info("  list %s %s %s p%d: keine Cards gerendert → end",
                         city.display, listing_type, subtype, page_num)
                return

            items = _extract_list_page(page, city.display, listing_type, subtype)
        finally:
            page.close()

        new_count = 0
        for item in items:
            if item.external_id in seen_external_ids:
                continue
            seen_external_ids.add(item.external_id)
            new_count += 1
            yield item

        log.info(
            "  list %s %s %s p%d: %d cards, %d new (cum %d)",
            city.display, listing_type, subtype, page_num, len(items), new_count, len(seen_external_ids),
        )
        if new_count == 0:
            return
        time.sleep(RATE_LIMIT_SECONDS)


def with_browser():
    """Context-Manager-Wrapper für Playwright Browser."""
    return sync_playwright()
