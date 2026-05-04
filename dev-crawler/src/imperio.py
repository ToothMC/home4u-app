"""Imperio Properties — Limassol-only Luxus-Bauträger.

Discovery: sitemap.xml ist leer (nur 301-Redirects). Wir crawlen die
/properties/-Index-Seite und filtern Root-Slugs nach Blocklist (Marketing-,
Kontakt-, Service-Pages raus).

URL-Pattern: https://www.imperioproperties.com/{project-slug}/
"""
from __future__ import annotations

import logging
import re
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx
from selectolax.parser import HTMLParser

from . import _common
from .base import ParsedListing

log = logging.getLogger(__name__)

DEVELOPER = "imperio"
BASE_URL = "https://www.imperioproperties.com"

INDEX_PATH = "/properties/"

# Slug-Blocklist: Pages die KEINE Projekte sind. Wenn ein neuer Slug auftaucht
# der nicht hier steht, wird er als Projekt behandelt → Parser kann skippen
# wenn keine sinnvolle Daten extrahiert werden.
NON_PROJECT_SLUGS = {
    "become-an-associate", "careers", "contact", "esg", "feed", "imperio",
    "interior-design", "market-news", "media", "permanent-residence-permit-programme",
    "press", "properties", "property-management", "rentals", "ru",
    "services-rentals", "the-team", "why-cyprus", "wp-json", "comments",
    "wp-content", "wp-admin", "wp-login.php",
}

_ROOT_SLUG_RE = re.compile(r'^https?://(?:www\.)?imperioproperties\.com/([a-z][a-z0-9-]+)/?$')


def discover(client: httpx.Client) -> Iterable[str]:
    try:
        resp = client.get(urljoin(BASE_URL, INDEX_PATH), timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.warning("imperio discover %s fail: %s", INDEX_PATH, e)
        return []

    tree = HTMLParser(resp.text)
    urls: set[str] = set()
    for a in tree.css("a[href]"):
        href = a.attributes.get("href") or ""
        if not href.startswith("http"):
            continue
        m = _ROOT_SLUG_RE.match(href)
        if not m:
            continue
        slug = m.group(1).lower()
        if slug in NON_PROJECT_SLUGS:
            continue
        urls.add(f"{BASE_URL}/{slug}/")
    log.info("imperio discover: %d project URLs", len(urls))
    return list(urls)


def parse(client: httpx.Client, url: str) -> ParsedListing | None:
    try:
        resp = client.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.warning("imperio parse fetch fail %s: %s", url, e)
        return None

    tree = HTMLParser(resp.text)
    slug = url.rstrip("/").rsplit("/", 1)[-1]

    title = _common.og(tree, "og:title") or ""
    for sep in (" | Imperio Properties", " - Imperio Properties"):
        if sep in title:
            title = title.split(sep, 1)[0].strip()
    if not title:
        title = slug.replace("-", " ").title()

    description = _common.og(tree, "og:description")
    cover = _common.og(tree, "og:image")
    # og:image ist bei manchen Imperio-Pages das Logo (.png in /uploads/) — IMG_BLOCKLIST
    # filtert es in collect_property_images raus, aber wir wollen nicht das Logo als Cover.
    # Falls cover ein Logo ist, lass es weg und nimm das erste Property-Bild aus collect.
    if cover and any(b in cover.lower() for b in ("logo", "_2021_without-symbol", "wp-content/uploads/2019/01/logo")):
        cover = None

    body_text = tree.body.text(separator=" ", strip=True) if tree.body else ""
    price = _common.parse_price_eur(body_text)
    rooms = _common.parse_bedrooms_max(body_text)
    size_sqm = _common.parse_area_sqm(body_text)

    property_type = _common.guess_property_type(slug, title)
    if property_type == "plot":
        rooms = None
        size_sqm = None

    # Imperio = ~100% Limassol. Falls Slug/Title keinen Stadt-Hint hat → Limassol.
    city = _common.guess_city(slug, title) or "Limassol"

    media = _common.collect_property_images(tree, cover=cover, limit=20)

    # Wenn ein Projekt KEIN Hero-Bild liefert UND keine Description/Price/Rooms,
    # ist es vermutlich keine echte Projekt-Page (Marketing-Slug der durchs
    # Blocklist-Sieb rutscht). Skip.
    if not media and not description and not price and not rooms:
        log.info("imperio %s: kein nutzbarer Content — skip", slug)
        return None

    return ParsedListing(
        listing_id=slug,
        listing_type="sale",
        detail_url=url,
        location_city=city,
        location_district=None,
        price=price,
        currency="EUR",
        rooms=rooms,
        size_sqm=size_sqm,
        property_type=property_type,
        title=title,
        description=description,
        media=media,
    )
