"""Leptos Estates — 60-Jahre-Brand Limassol/Paphos.

Discovery via WP/Yoast sitemap_index.xml:
- /project-sitemap.xml: Project-Übersichten (z.B. /project/limassol-blu-marine/)
- /property-sitemapN.xml: Unit-Level (3-Bedroom-Apartment-2901-...)

Strategie: Project-Granularität wie Aristo. Filter Locale-Prefixes (/ru/, /de/,
/zh-hans/) raus. ~30-50 EN-Projekte erwartet.
"""
from __future__ import annotations

import logging
import re
from typing import Iterable
from urllib.parse import urlparse

import httpx
from selectolax.parser import HTMLParser

from . import _common
from .base import ParsedListing

log = logging.getLogger(__name__)

DEVELOPER = "leptos"
BASE_URL = "https://www.leptosestates.com"

PROJECT_SITEMAP = f"{BASE_URL}/project-sitemap.xml"

# Leptos: /project/{slug}/ ist Projekt-Page. Locale-Subroutes haben /xx/project/.
_PROJECT_PATH_RE = re.compile(r'^/project/[^/]+/?$')

LEPTOS_HINTS = {
    **_common.CITY_HINTS_DEFAULT,
    "blu-marine": "Limassol",
    "neapolis": "Paphos",
    "fortuna": "Paphos",
    "viglia": "Paphos",
    "peyia-gardens": "Paphos",
    "mandria": "Paphos",
    "king-gardens": "Paphos",
    "paradise-gardens": "Paphos",
    "ano-glyfada": "Athens",  # Griechenland — wir setzen None weil nicht in CITY_HINTS_DEFAULT
}


def _is_project_page(url: str) -> bool:
    if not _common.is_english_path(url):
        return False
    return bool(_PROJECT_PATH_RE.match(urlparse(url).path))


def discover(client: httpx.Client) -> Iterable[str]:
    locs = _common.fetch_sitemap_locs(client, PROJECT_SITEMAP)
    urls = {u.rstrip("/") + "/" for u in locs if _is_project_page(u)}
    log.info("leptos discover: %d project URLs", len(urls))
    return list(urls)


def parse(client: httpx.Client, url: str) -> ParsedListing | None:
    try:
        resp = client.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.warning("leptos parse fetch fail %s: %s", url, e)
        return None

    tree = HTMLParser(resp.text)
    slug = url.rstrip("/").rsplit("/", 1)[-1]

    title = _common.og(tree, "og:title") or ""
    # "Limassol Blu Marine In Limassol Cyprus | Leptos Estates" → "Limassol Blu Marine In Limassol Cyprus"
    for sep in (" | Leptos Estates", " - Leptos Estates"):
        if sep in title:
            title = title.split(sep, 1)[0].strip()
    if not title:
        title = slug.replace("-", " ").title()

    description = _common.og(tree, "og:description")
    cover = _common.og(tree, "og:image")

    body_text = tree.body.text(separator=" ", strip=True) if tree.body else ""
    price = _common.parse_price_eur(body_text)
    rooms = _common.parse_bedrooms_max(body_text)
    size_sqm = _common.parse_area_sqm(body_text)

    property_type = _common.guess_property_type(slug, title)
    if property_type == "plot":
        rooms = None
        size_sqm = None

    city = _common.guess_city(slug, title, hints=LEPTOS_HINTS)

    media = _common.collect_property_images(tree, cover=cover, limit=20)

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
