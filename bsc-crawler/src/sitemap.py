"""BSC Sitemap-Discovery.

10 sub-sitemaps (sitemap1.xml..sitemap10.xml). WICHTIG: die `.xml.gz`-Variante
liefert nur einen 10-Byte-Gzip-Header — vermutlich Anti-Scraper-Trap. Die
`.xml`-URL ohne `.gz` liefert das echte ~8 MB XML.

Jede sub-sitemap enthält bis zu 45.000 Detail-URLs. Pattern:

    /property-for-sale/{city}/{district}/{slug}-{listing_id}.html
    /property-for-sale/{city}/{district}/{slug}-{listing_id}/gallery

`/gallery`-URLs sind die Bildergalerie der gleichen Listings und werden
ausgefiltert. Pro Listing bleibt eine kanonische `.html`-URL.

TRNC-Filter: BSC indexiert ohnehin nur Republik-Zypern (kein Kyrenia/Iskele
in den Sitemaps), wir brauchen keinen extra Filter. Famagusta auf BSC ist
der RoC-Bezirk (Sotira, Ayia Napa, Paralimni etc.).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from .http_client import BscSession

log = logging.getLogger(__name__)

SITEMAP_INDEX_URL = "https://www.buysellcyprus.com/sitemap.xml"
SITEMAP_FILES = [f"https://www.buysellcyprus.com/sitemap{i}.xml" for i in range(1, 11)]

LISTING_URL_PATTERN = re.compile(
    r"^https://www\.buysellcyprus\.com/property-for-sale/"
    r"(?P<city>[a-z-]+)/(?P<district>[a-z0-9-]+)/"
    r"(?P<slug>[a-z0-9-]+)-(?P<id>\d+)\.html$"
)


@dataclass
class ListingURL:
    listing_id: str
    detail_url: str
    city_slug: str
    district_slug: str
    type_slug: str  # vor der ID, z.B. "2-bed-apartment-for-sale-livadia-larnacas-larnaca"


def parse_sitemap(session: BscSession, sitemap_url: str) -> list[ListingURL]:
    """Eine sub-sitemap parsen. Filtert /gallery-URLs raus, dedupliziert
    listings im einzelnen Sitemap (über listing_id)."""
    body = session.get_text(sitemap_url, timeout=45)
    # Schnell-Parser via Regex — XML-Schema ist trivial, kein lxml nötig
    locs = re.findall(r"<loc>([^<]+)</loc>", body)
    seen: dict[str, ListingURL] = {}
    for loc in locs:
        if not loc.endswith(".html"):
            continue  # /gallery + Sonstiges
        m = LISTING_URL_PATTERN.match(loc)
        if not m:
            continue
        lid = m.group("id")
        if lid in seen:
            continue
        seen[lid] = ListingURL(
            listing_id=lid,
            detail_url=loc,
            city_slug=m.group("city"),
            district_slug=m.group("district"),
            type_slug=m.group("slug"),
        )
    return list(seen.values())


def discover_all_listings(session: BscSession) -> list[ListingURL]:
    """End-to-end: alle 10 sub-sitemaps → flache Liste ID-eindeutiger Listings."""
    all_listings: dict[str, ListingURL] = {}
    for sm_url in SITEMAP_FILES:
        try:
            items = parse_sitemap(session, sm_url)
        except Exception as e:
            log.warning("sitemap fetch failed %s: %s", sm_url, e)
            continue
        new_in_file = 0
        for it in items:
            if it.listing_id not in all_listings:
                all_listings[it.listing_id] = it
                new_in_file += 1
        log.info(
            "  %s: %d listings (%d new, %d total accumulated)",
            sm_url.rsplit("/", 1)[-1], len(items), new_in_file, len(all_listings),
        )
    return list(all_listings.values())
