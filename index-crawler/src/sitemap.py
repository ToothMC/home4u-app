"""INDEX.cy Sitemap-Discovery.

Sitemap-Index: https://index.cy/sitemap.xml
  → enthält sale-sitemap1..N.xml + rent-sitemap1..N.xml + post-sitemap*

Jede sub-sitemap enthält ~600 <url>-Einträge mit:
  - <loc>https://index.cy/sale/{id}-{slug}/</loc>
  - <lastmod>
  - <image:image><image:loc>...</image:loc></image:image> (mehrere)

Sprach-Varianten /el/ /ru/ haben dieselbe ID — wir nehmen nur die /sale/
oder /rent/ Pfade (English-Default).

Output pro discovery: list[ListingURL] mit URL + listing_type + image_urls[].
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import xml.etree.ElementTree as ET

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

# Sitemap.org-Standard + Image-Sitemap-Extension
_NS = {
    "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
    "image": "http://www.google.com/schemas/sitemap-image/1.1",
}

log = logging.getLogger(__name__)

SITEMAP_INDEX_URL = "https://index.cy/sitemap.xml"
LISTING_URL_PATTERN = re.compile(
    r"^https://index\.cy/(?P<type>sale|rent)/(?P<id>\d+)-[a-z0-9-]+/?$"
)


@dataclass
class ListingURL:
    """Discovery-Output: alles was die Sitemap pro Listing liefert."""
    listing_id: str          # numerische ID aus URL
    listing_type: str        # 'sale' | 'rent' → mappt auf listings.type
    detail_url: str          # vollständige URL zur Detail-Page
    image_urls: list[str] = field(default_factory=list)
    lastmod: str | None = None


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _fetch(client: httpx.Client, url: str) -> str:
    resp = client.get(url, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def fetch_sitemap_urls(client: httpx.Client) -> list[str]:
    """Liefert alle sub-sitemap-URLs aus dem sitemap-index, gefiltert auf
    sale-/rent-/post-relevante Sitemaps. Sprach-Varianten ignorieren wir
    bewusst — die enthalten dieselben Listings doppelt."""
    xml = _fetch(client, SITEMAP_INDEX_URL)
    # Schnell-Parser via Regex statt vollem XML — Format ist vorhersehbar
    urls = re.findall(r"<loc>(https://index\.cy/[^<]+)</loc>", xml)
    relevant = [u for u in urls if "/sale-sitemap" in u or "/rent-sitemap" in u]
    log.info("sitemap-index: %d sub-sitemaps", len(relevant))
    return relevant


def parse_sub_sitemap(client: httpx.Client, sitemap_url: str) -> list[ListingURL]:
    """Eine sub-sitemap parsen → list[ListingURL]. Filtert Sprach-Varianten
    (/el/ /ru/) raus — wir wollen nur die kanonische English-URL pro Listing.
    """
    xml_text = _fetch(client, sitemap_url)
    listings: dict[str, ListingURL] = {}

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        log.warning("xml parse failed %s: %s", sitemap_url, e)
        return []

    for url_node in root.findall("sm:url", _NS):
        loc_node = url_node.find("sm:loc", _NS)
        if loc_node is None or not loc_node.text:
            continue
        loc = loc_node.text.strip()
        m = LISTING_URL_PATTERN.match(loc)
        if not m:
            continue  # Sprach-Variante oder Sonder-Pfad

        listing_id = m.group("id")
        if listing_id in listings:
            continue

        lastmod_node = url_node.find("sm:lastmod", _NS)
        lastmod = lastmod_node.text.strip() if lastmod_node is not None and lastmod_node.text else None

        image_urls: list[str] = []
        for img in url_node.findall("image:image/image:loc", _NS):
            if img.text:
                image_urls.append(img.text.strip())

        listings[listing_id] = ListingURL(
            listing_id=listing_id,
            listing_type=m.group("type"),
            detail_url=loc,
            image_urls=image_urls,
            lastmod=lastmod,
        )

    return list(listings.values())


def discover_all_listings(client: httpx.Client) -> list[ListingURL]:
    """End-to-end: sitemap-index → alle sub-sitemaps → flache Liste aller
    eindeutigen Listings (ID-dedup über alle sub-sitemaps)."""
    sub_urls = fetch_sitemap_urls(client)
    all_listings: dict[str, ListingURL] = {}
    for sm_url in sub_urls:
        try:
            items = parse_sub_sitemap(client, sm_url)
        except Exception as e:
            log.warning("sitemap fetch failed %s: %s", sm_url, e)
            continue
        for item in items:
            # Schon in einer früheren sitemap gesehen? Erste Quelle gewinnt
            if item.listing_id not in all_listings:
                all_listings[item.listing_id] = item
        log.info("  %s: +%d unique (total %d)", sm_url.rsplit("/", 1)[-1], len(items), len(all_listings))
    return list(all_listings.values())
