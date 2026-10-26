"""BSC Sitemap-Discovery.

Sub-sitemaps laut Index /sitemap.xml (Stand 2026-10: sitemap1..11). WICHTIG: die `.xml.gz`-Variante
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
# Fallback, falls der Index nicht lesbar ist. Stand 2026-10-26 listet der
# Index 11 Dateien; sitemap1 enthält nur Such-/Filterseiten (0 Inserate).
SITEMAP_FILES = [f"https://www.buysellcyprus.com/sitemap{i}.xml" for i in range(1, 12)]
_INDEX_LOC_RE = re.compile(
    r"<loc>\s*(https://www\.buysellcyprus\.com/sitemap\d+\.xml)(?:\.gz)?\s*</loc>"
)

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


def parse_sitemap_index(body: str) -> list[str]:
    """Sub-Sitemaps aus dem Index. Der Index verweist auf `.xml.gz` — das ist
    die 10-Byte-Falle, deshalb immer auf `.xml` umschreiben."""
    seen: list[str] = []
    for url in _INDEX_LOC_RE.findall(body):
        if url not in seen:
            seen.append(url)
    return seen


def discover_sitemap_files(session: BscSession) -> list[str]:
    """Sub-Sitemaps laut Index; bei Fehler die feste Fallback-Liste.
    Bis 2026-10-26 war die Liste hart auf 1..10 kodiert — sitemap11
    (6.560 Inserate) fehlte unbemerkt."""
    try:
        files = parse_sitemap_index(session.get_text(SITEMAP_INDEX_URL, timeout=30))
    except Exception as e:
        log.warning("sitemap-index nicht lesbar (%s) — Fallback auf %d feste Dateien",
                    e, len(SITEMAP_FILES))
        return list(SITEMAP_FILES)
    if not files:
        log.warning("sitemap-index ohne Einträge — Fallback auf %d feste Dateien",
                    len(SITEMAP_FILES))
        return list(SITEMAP_FILES)
    log.info("sitemap-index: %d sub-sitemaps", len(files))
    return files


def discover_all_listings(session: BscSession) -> list[ListingURL]:
    """End-to-end: alle sub-sitemaps laut Index → flache Liste ID-eindeutiger Listings."""
    all_listings: dict[str, ListingURL] = {}
    for sm_url in discover_sitemap_files(session):
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
