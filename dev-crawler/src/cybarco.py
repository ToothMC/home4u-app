"""Cybarco — Limassol Marina, Trilogy etc. Flagship-Bauträger.

Discovery via /projects-sitemap.xml. Cybarcos CDN blockt Datacenter-IPs
(GitHub Actions) mit 403 — als Fallback nutzen wir eine hardcoded
Project-Slug-Liste (15 Flagship-Projekte, ändern sich selten).

Rate-Limit: robots.txt verlangt Crawl-delay: 10s. RATE_LIMIT_S=10 wird vom
Orchestrator (main.py) per getattr(module, "RATE_LIMIT_S", default) gelesen.
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

DEVELOPER = "cybarco"
BASE_URL = "https://www.cybarco.com"
RATE_LIMIT_S = 10.0  # robots.txt Crawl-delay

PROJECTS_SITEMAP = f"{BASE_URL}/projects-sitemap.xml"

_PROJECT_PATH_RE = re.compile(r'^/project/[^/]+/?$')

# Fallback wenn Sitemap geblockt wird (GitHub Actions IPs werden mit 403
# abgewiesen). Stand 2026-05: 15 Flagship-Projekte. Wenn Cybarco neue Projekte
# launcht, hier ergänzen — Sitemap ist die Source-of-Truth wenn erreichbar.
FALLBACK_SLUGS = (
    "limassol-marina", "limassol-greens", "trilogy-limassol-seafront",
    "centro-limassol", "the-oval", "thalassa-residences",
    "seaview-heights-limassol", "naftikos-residences", "attikis-residences",
    "aktea-residences-2", "aktea-residences-3", "aktea-residences-4",
    "akamas-bay-villas", "park-residences-nicosia", "sea-gallery-villas",
)


def _is_project_page(url: str) -> bool:
    if not _common.is_english_path(url):
        return False
    return bool(_PROJECT_PATH_RE.match(urlparse(url).path))


def discover(client: httpx.Client) -> Iterable[str]:
    locs = _common.fetch_sitemap_locs(client, PROJECTS_SITEMAP)
    urls = {u.rstrip("/") + "/" for u in locs if _is_project_page(u)}
    if not urls:
        log.warning("cybarco sitemap blockt (vermutl. WAF) — fallback auf hardcoded slugs")
        urls = {f"{BASE_URL}/project/{s}/" for s in FALLBACK_SLUGS}
    log.info("cybarco discover: %d project URLs", len(urls))
    return list(urls)


def parse(client: httpx.Client, url: str) -> ParsedListing | None:
    try:
        resp = client.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.warning("cybarco parse fetch fail %s: %s", url, e)
        return None

    tree = HTMLParser(resp.text)
    slug = url.rstrip("/").rsplit("/", 1)[-1]

    title = _common.og(tree, "og:title") or ""
    for sep in (" | Cybarco", " - Cybarco"):
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

    # Cybarco-Projekte sind primär Limassol (Marina, Greens, Trilogy, Centro)
    # mit wenigen Ausnahmen (Park Residences Nicosia, Akamas Bay Paphos).
    city = _common.guess_city(slug, title) or "Limassol"

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
