"""Pafilia — Premium-Bauträger Limassol/Paphos (ONE Limassol, Minthis etc.).

Discovery via Yoast-Sitemap-Index:
- /projects-sitemap.xml: Projekt-Übersichtsseiten (z.B. /minthis-resort/topos-residences/)
- /property-sitemap.xml: Unit-Level-Seiten (selten, ~30 Stück)

Strategie: Projekt-Granularität wie Aristo. Wir nehmen die Projekt-Seiten,
filtern Locale-Prefixes (/ru/, /vi/, /zh/) raus, deduplizieren.

Property-URL-Patterns die als Projekt-Seite zählen:
- /properties/all/{city}/{slug}/        (eigentliche Property-Pages)
- /minthis-resort/{slug}/                (Spezial-Resort-Pages)
- /properties/all/{city}/{slug}/{unit}/  (Unit-Level — überspringen, wir bleiben auf Projekt)
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

DEVELOPER = "pafilia"
BASE_URL = "https://www.pafilia.com"

SITEMAP_INDEX = f"{BASE_URL}/sitemap_index.xml"
PROJECTS_SITEMAP = f"{BASE_URL}/projects-sitemap.xml"

# Pafilia-spezifische Resort-Namen → Stadt-Mapping (ergänzt CITY_HINTS_DEFAULT)
PAFILIA_HINTS = {
    **_common.CITY_HINTS_DEFAULT,
    "minthis": "Paphos",
    "minthis-resort": "Paphos",
    "tsada": "Paphos",
    "lofos": "Paphos",
    "elysia": "Paphos",
    "amathos": "Limassol",
    "aria": "Limassol",
    "lana": "Limassol",
    "limassol-blu": "Limassol",
}

# Filter: nur EN-Locale, keine /ru//vi//zh/-Pfade. Property-URLs nur auf
# /properties/all/{city}/{slug}/ ODER /{resort-name}/{slug}/.
_PROPERTY_PATH_RE = re.compile(r'^/properties/all/[^/]+/[^/]+/?$')
_RESORT_PATH_RE = re.compile(r'^/[a-z][a-z0-9-]+/[a-z][a-z0-9-]+/?$')


def _is_project_page(url: str) -> bool:
    """True wenn URL eine Projekt-Page ist (kein Unit, kein Locale-Subpath)."""
    if not _common.is_english_path(url):
        return False
    path = urlparse(url).path
    if _PROPERTY_PATH_RE.match(path):
        return True
    # /minthis-resort/topos-residences/ — Resort-Subprojekte
    if _RESORT_PATH_RE.match(path):
        # Aber nicht Marketing-Pages wie /about/team oder /careers/jobs.
        # Wir verlassen uns darauf dass die Sitemap nur Projekte listet.
        # /minthis-resort/ als Top-Level (1 Segment) wird hier nicht gematcht — gut.
        return True
    return False


def discover(client: httpx.Client) -> Iterable[str]:
    urls: set[str] = set()
    for sm_url in (PROJECTS_SITEMAP, f"{BASE_URL}/property-sitemap.xml"):
        locs = _common.fetch_sitemap_locs(client, sm_url)
        for u in locs:
            if _is_project_page(u):
                urls.add(u.rstrip("/") + "/")
    log.info("pafilia discover: %d project URLs", len(urls))
    return list(urls)


def parse(client: httpx.Client, url: str) -> ParsedListing | None:
    try:
        resp = client.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.warning("pafilia parse fetch fail %s: %s", url, e)
        return None

    tree = HTMLParser(resp.text)
    slug = url.rstrip("/").rsplit("/", 1)[-1]

    title = _common.og(tree, "og:title") or ""
    # Suffix " - Pafilia", " | Pafilia" entfernen
    for sep in (" - Pafilia", " | Pafilia"):
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

    # City: erst aus URL-Pfad (/properties/all/{city}/...) ablesen, dann Heuristik
    # mit Pafilia-Hints (Resort-Namen wie 'minthis' → Paphos).
    # Athens-Projekte (Iliso Suites) bekommen None — sind kein CY-Inventar, aber
    # wir indexieren sie der Vollständigkeit halber. Index-Filter macht das Frontend.
    city = None
    path_parts = urlparse(url).path.strip("/").split("/")
    if len(path_parts) >= 4 and path_parts[0] == "properties" and path_parts[1] == "all":
        city = _common.guess_city(path_parts[2], hints=PAFILIA_HINTS)
    if not city:
        # Resort-Path /minthis-resort/{slug}/ — versuche resort-name + slug
        full_slug = "/".join(path_parts).lower()
        city = _common.guess_city(full_slug, title, hints=PAFILIA_HINTS)

    if property_type == "plot":
        rooms = None
        size_sqm = None

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
