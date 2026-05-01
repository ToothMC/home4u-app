"""Aristo Developers — größter CY-Bauträger.

URL-Struktur:
- Sitemap: https://www.aristodevelopers.com/sitemap.xml — listet aber nur
  Marketing-Pages, keine Project-Detail-URLs direkt.
- Listings via paginierte Stadt-Filter-Seiten:
  /property-for-sale-in-cyprus?page=N (1..5)
  /property-for-sale-in-{city} mit city in {paphos, limassol, peyia, polis}
- Detail: /developments/{slug} — eine Page pro Projekt, mit von-Preis,
  Bedroom-Range und Covered-Area-Range über alle Unit-Typen.

Granularität: Pro PROJEKT ein Listing (nicht pro Unit). Bauträger publizieren
keine unit-IDs konsistent; das Projekt ist die kaufentscheidende Einheit.
Cross-Source-Match auf Bazaraki/INDEX wird über pHash + Title-Embedding laufen.
"""
from __future__ import annotations

import logging
import re
from typing import Iterable
from urllib.parse import urljoin

import httpx
from selectolax.parser import HTMLParser

from .base import ParsedListing

log = logging.getLogger(__name__)

DEVELOPER = "aristo"
BASE_URL = "https://www.aristodevelopers.com"

# Stadt-Buckets für Discovery. Aristo hat eigene Stadt-Filter-Pages.
# "cyprus" ist die Sammel-Page als Fallback (max Coverage).
DISCOVERY_PATHS = [
    "/property-for-sale-in-cyprus",
    "/property-for-sale-in-paphos",
    "/property-for-sale-in-limassol",
    "/property-for-sale-in-peyia",
    "/property-for-sale-in-polis",
]
MAX_PAGES = 10  # Aristo hat aktuell ~5 Pages pro Filter — Sicherheits-Cap

DETAIL_PATH_RE = re.compile(r'/developments/[a-z0-9-]+')

# City aus URL-Slug raten (Pafilia hat ähnliches Schema, dieser Helper passt nur für Aristo)
CITY_HINTS = {
    "paphos": "Paphos", "pafos": "Paphos", "peyia": "Paphos", "polis": "Paphos",
    "mandria": "Paphos", "venusrock": "Paphos",
    "limassol": "Limassol", "lemesos": "Limassol",
    "nicosia": "Nicosia", "lefkosia": "Nicosia", "engomi": "Nicosia",
    "larnaca": "Larnaca", "larnaka": "Larnaca",
    "famagusta": "Famagusta", "ayianapa": "Famagusta", "protaras": "Famagusta",
}


def _guess_city(slug: str) -> str | None:
    s = slug.lower()
    for hint, city in CITY_HINTS.items():
        if hint in s:
            return city
    return None


def discover(client: httpx.Client) -> Iterable[str]:
    """Sammelt /developments/{slug}-URLs durch alle Stadt-Filter-Pages.

    Aristo paginiert mit ?page=N. Wir laufen jede Stadt 1..MAX_PAGES ab,
    dedupen Slugs (Projekt taucht in mehreren Stadt-Filtern auf).
    """
    seen: set[str] = set()
    for path in DISCOVERY_PATHS:
        for page in range(1, MAX_PAGES + 1):
            url = urljoin(BASE_URL, path)
            if page > 1:
                url = f"{url}?page={page}"
            try:
                resp = client.get(url, timeout=30, follow_redirects=True)
                resp.raise_for_status()
            except Exception as e:
                log.warning("aristo discover %s page %d fail: %s", path, page, e)
                break
            slugs = set(DETAIL_PATH_RE.findall(resp.text))
            new = slugs - seen
            if not new:
                break  # nichts Neues mehr → vermutlich End-of-Pagination
            seen.update(slugs)
            log.debug("aristo %s p%d: %d slugs (+%d new, total %d)", path, page, len(slugs), len(new), len(seen))
    log.info("aristo discover: %d unique projects", len(seen))
    return [urljoin(BASE_URL, slug) for slug in seen]


_PRICE_RE = re.compile(r'(?:&euro;|€)\s*([0-9][0-9,.\s]*)')
_BEDROOMS_RE = re.compile(r'(\d+)(?:\s*[-–]\s*(\d+))?\s*Bedroom', re.I)
_AREA_RE = re.compile(r'Covered area\s*\|\s*([0-9.,]+)\s*m', re.I)


def _meta(tree: HTMLParser, prop: str) -> str | None:
    node = tree.css_first(f'meta[property="{prop}"]')
    if not node:
        return None
    val = node.attributes.get("content")
    return val.strip() if val else None


def _parse_price_eur(text: str) -> float | None:
    m = _PRICE_RE.search(text)
    if not m:
        return None
    raw = m.group(1).replace(",", "").replace(" ", "").replace(".", "")
    try:
        return float(raw)
    except ValueError:
        return None


def parse(client: httpx.Client, url: str) -> ParsedListing | None:
    """Parsed eine Aristo /developments/{slug} Detail-Page."""
    try:
        resp = client.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.warning("aristo parse fetch fail %s: %s", url, e)
        return None

    tree = HTMLParser(resp.text)
    slug = url.rstrip("/").rsplit("/", 1)[-1]

    title = _meta(tree, "og:title") or slug.replace("-", " ").title()
    cover = _meta(tree, "og:image")
    # og:description fehlt auf Aristo-Detail-Pages — Fallback auf meta name="description"
    description = _meta(tree, "og:description")
    if not description:
        node = tree.css_first('meta[name="description"]')
        if node:
            description = (node.attributes.get("content") or "").strip() or None

    # Erstes <h3 class*="secondary-header-text"> trägt die Headline-Preis-Angabe
    price_node = tree.css_first('h3.secondary-header-text')
    price_text = price_node.text(strip=True) if price_node else resp.text
    price = _parse_price_eur(price_text)

    # Bedrooms aus Project-Summary-Block
    body_text = tree.body.text(separator=" ", strip=True) if tree.body else ""
    rooms = None
    m = _BEDROOMS_RE.search(body_text)
    if m:
        # "2-4 Bedrooms" → wir nehmen das Maximum als Match-relevanten Wert
        rooms = int(m.group(2) or m.group(1))

    size_sqm = None
    a = _AREA_RE.search(body_text)
    if a:
        try:
            # "123.17m" → 123 (rund auf int)
            size_sqm = int(float(a.group(1).replace(",", "")))
        except ValueError:
            pass

    # Property-Type-Heuristik aus Slug + Title.
    # plot/land vor house prüfen — sonst wird "land for sale" zu "house" wenn
    # zufällig "residence" im Slug auftaucht (Marketing-Artefakt).
    pt_text = (slug + " " + title).lower()
    if "plot" in pt_text or "land for sale" in pt_text:
        property_type = "plot"
    elif any(k in pt_text for k in ("villa", "house", "residence", "maisonette")):
        property_type = "house"
    elif any(k in pt_text for k in ("apartment", "flat")):
        property_type = "apartment"
    else:
        property_type = "house"  # Default Bauträger = Neubau-Häuser

    # Bei plot ergibt Bedrooms keinen Sinn — Footer-Newsletter hat ein
    # "3 Bedrooms"-Snippet das der Regex sonst fälschlich aufgreift.
    if property_type == "plot":
        rooms = None
        size_sqm = None

    media: list[str] = []
    if cover:
        media.append(cover)
    # Weitere Galerie-Bilder via og:image-Sequenz oder Carousel-img-Tags
    for img in tree.css('img[src*="/storage/aristo/projects"]'):
        src = img.attributes.get("src")
        if src and src not in media:
            media.append(src)

    return ParsedListing(
        listing_id=slug,
        listing_type="sale",  # Bauträger fast immer Verkauf
        detail_url=url,
        location_city=_guess_city(slug),
        location_district=None,
        price=price,
        currency="EUR",
        rooms=rooms,
        size_sqm=size_sqm,
        property_type=property_type,
        title=title,
        description=description,
        media=media[:20],  # Limit
    )
