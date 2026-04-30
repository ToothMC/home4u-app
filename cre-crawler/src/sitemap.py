"""cyprus-real.estate Sitemap-Discovery.

Sitemap-Index: https://cyprus-real.estate/sitemap-en.xml
  → enthält sitemap-0.xml … sitemap-N.xml

sitemap-0 enthält Companies/Agencies (kein Listing).
sitemap-1..N enthalten Listing-URLs `/property/o{ID}/`.

Output: list[ListingURL] mit listing_id + detail_url. Kein image_urls aus
Sitemap (c-r-e exposed keine image:image tags) — Cover wird aus Detail-HTML
geholt.
"""
from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

log = logging.getLogger(__name__)

SITEMAP_INDEX_URL = "https://cyprus-real.estate/sitemap-en.xml"
LISTING_URL_PATTERN = re.compile(
    r"^https://cyprus-real\.estate/property/o(?P<id>\d+)/?$"
)


@dataclass
class ListingURL:
    listing_id: str
    detail_url: str
    # listing_type (sale|rent) ist auf c-r-e nicht aus URL erkennbar — wird
    # aus Detail-HTML gesetzt (og:title "for rent" / "for sale").
    listing_type: str | None = None
    image_urls: list[str] = field(default_factory=list)
    lastmod: str | None = None


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _fetch(client: httpx.Client, url: str) -> str:
    resp = client.get(url, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def fetch_sitemap_urls(client: httpx.Client) -> list[str]:
    """Sitemap-Index lesen und alle sub-sitemaps zurückgeben."""
    xml = _fetch(client, SITEMAP_INDEX_URL)
    urls = re.findall(
        r"<loc>(https://cyprus-real\.estate/sitemap-\d+\.xml)</loc>", xml
    )
    log.info("sitemap-index: %d sub-sitemaps", len(urls))
    return urls


def parse_sub_sitemap(client: httpx.Client, sitemap_url: str) -> list[ListingURL]:
    """Eine sub-sitemap parsen → list[ListingURL] mit nur Property-URLs."""
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
            continue  # company, root etc.

        listing_id = m.group("id")
        if listing_id in listings:
            continue

        lastmod_node = url_node.find("sm:lastmod", _NS)
        lastmod = lastmod_node.text.strip() if lastmod_node is not None and lastmod_node.text else None

        listings[listing_id] = ListingURL(
            listing_id=listing_id,
            detail_url=loc,
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
            if item.listing_id not in all_listings:
                all_listings[item.listing_id] = item
        log.info(
            "  %s: +%d listings (total %d)",
            sm_url.rsplit("/", 1)[-1], len(items), len(all_listings),
        )
    return list(all_listings.values())
