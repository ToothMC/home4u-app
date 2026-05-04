"""Korantina Homes — Paphos-zentrierter Boutique-Bauträger.

Discovery via flacher /sitemap.xml (Django/Wagtail). 23+ Projekte, alle in
Paphos (Cap St. Georges, Royal Bay, Soho Resort etc.).

URL-Pattern: /projects/{slug}/.
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

DEVELOPER = "korantina"
BASE_URL = "https://korantinahomes.com"

SITEMAP = f"{BASE_URL}/sitemap.xml"

_PROJECT_PATH_RE = re.compile(r'^/projects/[^/]+/?$')


def _is_project_page(url: str) -> bool:
    if not _common.is_english_path(url):
        return False
    return bool(_PROJECT_PATH_RE.match(urlparse(url).path))


def discover(client: httpx.Client) -> Iterable[str]:
    locs = _common.fetch_sitemap_locs(client, SITEMAP)
    urls = {u.rstrip("/") + "/" for u in locs if _is_project_page(u)}
    log.info("korantina discover: %d project URLs", len(urls))
    return list(urls)


def parse(client: httpx.Client, url: str) -> ParsedListing | None:
    try:
        resp = client.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.warning("korantina parse fetch fail %s: %s", url, e)
        return None

    tree = HTMLParser(resp.text)
    slug = url.rstrip("/").rsplit("/", 1)[-1]

    title = _common.og(tree, "og:title") or ""
    # Korantina hat einen globalen og:title-Fallback. Wenn er gesetzt ist,
    # ersetzen wir ihn durch den Slug-basierten Titel — Slug = Projektname.
    if not title or "korantina" in title.lower():
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

    # Korantina ist ~100% Paphos. Default-Heuristik fängt cap-st-georges,
    # royal-bay, soho-resort etc. nicht — erst Slug+Title prüfen, dann Paphos default.
    city = _common.guess_city(slug, title) or "Paphos"

    # Bilder: Korantina nutzt divio-media.org als CDN, nicht /wp-content/uploads/
    media = _common.collect_property_images(
        tree, cover=cover, upload_substr="divio-media", limit=20
    )

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
