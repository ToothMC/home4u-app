"""BSC Detail-Page-Extraktion.

Primärquelle: HTML <title>. BSC formatiert ihn als strukturierte Vorlage,
die fast alle Felder enthält:

    "3 Bedroom Apartment for sale in Limassol (ID:8649754) - €520,000 - BuySellCyprus.com"
    "0 SQM Land for sale in Anogyra (ID:1006554) - €55,000 - BuySellCyprus.com"
    " Office for sale in Lykavitos (ID:1006585) - €440,000 - BuySellCyprus.com"
    " Hotel for sale in Paphos Municipality (ID:1010726) - BuySellCyprus.com"  ← inaktiv (kein €)

Aktiv-Filter: nur Listings, deren Title einen Preis enthält, werden geparst.
Listings ohne Preis im Title sind in der Praxis archiviert/zurückgezogen.
(BSC behält archived Listings für SEO in der Sitemap.)

Cover-Bild: bevorzugt srcset≥720px (Memory: nie Thumbnails). Fallback: og:image.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from .http_client import BscSession

log = logging.getLogger(__name__)

# Title-Regex deckt drei Vorlagen ab:
#   "N Bedroom {Type} for {sale|rent} in {Location} (ID:N) - €{Price}"
#   "N SQM {Type} for {sale|rent} in {Location} (ID:N) - €{Price}"
#   " {Type} for {sale|rent} in {Location} (ID:N) - €{Price}"  (führendes Space)
_TITLE_RE = re.compile(
    r"^(?:\s*(?P<bedrooms>\d+)\s+Bedroom\s+|\s*(?P<sqm_title>[\d,]+)\s+SQM\s+|\s*)"
    r"(?P<type>[A-Za-z][A-Za-z\s-]+?)\s+for\s+(?P<sale_type>sale|rent)\s+"
    r"in\s+(?P<location>[^(]+?)\s*\(ID:(?P<id>\d+)\)"
    r"(?:\s*-\s*€\s*(?P<price>[\d,]+))?"
    r"(?:\s*-\s*BuySellCyprus\.com)?\s*$",
    re.IGNORECASE,
)

_OG_TITLE_RE = re.compile(r'<meta\s+property="og:title"\s+content="([^"]+)"')
_OG_DESC_RE = re.compile(r'<meta\s+property="og:description"\s+content="([^"]+)"')
_OG_IMAGE_RE = re.compile(r'<meta\s+property="og:image"\s+content="([^"]+)"')
_TITLE_TAG_RE = re.compile(r"<title>([^<]+)</title>")

# Body-Fallback für sqm wenn nicht im Title (z.B. Apartments)
_BODY_SQM_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:sq\.?m\.?|m²|m2)", re.IGNORECASE)
_BODY_BATHROOMS_RE = re.compile(r"(\d+)\s*[Bb]athroom", re.IGNORECASE)

# Type-Slug → Home4U-Taxonomie. BSC hat sehr granulare Types (semi-detached-house,
# town-house, penthouse, ground-floor-apartment, ...). Wir grouppen pragmatisch.
_TYPE_MAP = {
    "apartment": "apartment",
    "penthouse": "apartment",
    "studio": "apartment",
    "ground floor apartment": "apartment",
    "block of flats": "apartment",
    "detached house": "house",
    "semi-detached house": "house",
    "town house": "house",
    "townhouse": "house",
    "house": "house",
    "villa": "house",
    "bungalow": "house",
    "maisonette": "house",
    "land": "plot",
    "plot": "plot",
    # Commercial / Industrial — keep but tag separately later
    "office": "commercial",
    "shop": "commercial",
    "building": "commercial",
    "apartment building": "commercial",
    "commercial building": "commercial",
    "hotel": "commercial",
    "warehouse": "commercial",
    "factory": "commercial",
    "restaurant": "commercial",
    "showroom": "commercial",
}


@dataclass
class ParsedListing:
    listing_id: str
    listing_type: str  # sale|rent
    detail_url: str

    price: float | None = None
    currency: str = "EUR"

    title: str | None = None
    description: str | None = None
    rooms: int | None = None
    bathrooms: int | None = None
    size_sqm: float | None = None
    property_type: str | None = None
    location_city: str | None = None
    location_district: str | None = None
    media: list[str] = field(default_factory=list)

    cover_phash: int | None = None

    contact_phone: str | None = None
    contact_phone_country: str | None = None
    contact_email: str | None = None
    phone_hash: str | None = None


def _to_int(s: str | None) -> int | None:
    if not s:
        return None
    cleaned = s.replace(",", "").replace(" ", "")
    try:
        return int(cleaned)
    except ValueError:
        return None


def _to_float(s: str | None) -> float | None:
    if not s:
        return None
    cleaned = s.replace(",", "").replace(" ", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _normalize_type(raw: str) -> str:
    """Mappt BSC-Title-Type (z.B. 'Detached House') auf Home4U-Taxonomie."""
    key = raw.strip().lower()
    if key in _TYPE_MAP:
        return _TYPE_MAP[key]
    # Last-Wort-Fallback (z.B. "Mixed-use Building" → "building")
    last = key.split()[-1] if key.split() else key
    return _TYPE_MAP.get(last, "other")


def _strip_district_suffix(location_raw: str, city_slug: str) -> tuple[str, str]:
    """BSC-Title schreibt Location als 'Village District' oder 'Village'.
    URL hat city_slug = einer von limassol/larnaca/nicosia/paphos/famagusta.
    Wir splitten Location grob: erstes Token = District, Rest = City-Fallback.
    """
    city = city_slug.replace("-", " ").title() if city_slug else None
    district = location_raw.strip() if location_raw else None
    return (city or "", district or "")


def parse_title(title_text: str) -> dict | None:
    """Hauptparser. Returns dict mit allen erkannten Feldern, oder None wenn
    Title nicht zum BSC-Pattern passt."""
    m = _TITLE_RE.match(title_text.strip())
    if not m:
        return None
    return {
        "bedrooms": _to_int(m.group("bedrooms")),
        "sqm_title": _to_float(m.group("sqm_title")),
        "type_raw": (m.group("type") or "").strip(),
        "sale_type": (m.group("sale_type") or "").strip().lower(),
        "location_raw": (m.group("location") or "").strip(),
        "listing_id": m.group("id"),
        "price": _to_float(m.group("price")),
    }


def _extract_cover_url(html: str) -> str | None:
    """Cover-URL bestimmen. Memory-Constraint: ≥720px wenn srcset vorhanden,
    sonst og:image. Nie Thumbnails (≤300px)."""
    # 1) og:image als sicherer Default
    og = _OG_IMAGE_RE.search(html)
    og_url = og.group(1) if og else None

    # 2) Wenn die Page einen Slider mit srcset hat, hole das größte Bild
    #    BSC nutzt z.B. data-zoom oder data-original Attribute für full-res
    for pat in [
        r'data-zoom="(https?://www\.buysellcyprus\.com/images/[^"]+)"',
        r'data-original="(https?://www\.buysellcyprus\.com/images/[^"]+)"',
        r'srcset="([^"]+)"',
    ]:
        m = re.search(pat, html)
        if not m:
            continue
        val = m.group(1)
        # srcset kann komma-separated sein "url1 1x, url2 2x"
        if pat.startswith("srcset"):
            candidates = [s.strip().split()[0] for s in val.split(",") if s.strip()]
            for c in candidates:
                if c.startswith("https://www.buysellcyprus.com/images/"):
                    return c
        else:
            return val
    return og_url


def parse_detail(session: BscSession, listing: "object") -> ParsedListing | None:
    """Detail-Page fetchen + parsen. Returns None für archived/parse-failed.

    `listing` muss `.listing_id`, `.detail_url`, `.city_slug` haben (ListingURL aus sitemap.py).
    """
    try:
        body = session.get_text(listing.detail_url, timeout=30)
    except Exception as e:
        log.debug("fetch failed for %s: %s", listing.detail_url, e)
        return None

    # Title bevorzugt aus <title>, Fallback og:title
    title_m = _TITLE_TAG_RE.search(body)
    title_text = title_m.group(1) if title_m else ""
    if not title_text:
        og_t = _OG_TITLE_RE.search(body)
        title_text = og_t.group(1) if og_t else ""

    parsed = parse_title(title_text)
    if not parsed:
        log.debug("title-parse miss for %s — title=%r", listing.detail_url, title_text[:80])
        return None

    # Aktiv-Heuristik: BSC behält archived Listings in der Sitemap, die
    # haben keinen €-Preis im Title. Skip — sonst pumpen wir tausende
    # zombie-Listings in die DB die nichts wert sind.
    if parsed["price"] is None:
        log.debug("skip archived (no price): %s", listing.detail_url)
        return None

    sqm = parsed.get("sqm_title")
    if sqm is None:
        # Body-Fallback (Apartments haben SQM nicht im Title)
        body_sqm = _BODY_SQM_RE.search(body)
        if body_sqm:
            sqm = _to_float(body_sqm.group(1))

    baths_m = _BODY_BATHROOMS_RE.search(body)
    bathrooms = _to_int(baths_m.group(1)) if baths_m else None

    cover = _extract_cover_url(body)
    desc_m = _OG_DESC_RE.search(body)
    description = desc_m.group(1) if desc_m else None

    city, district = _strip_district_suffix(parsed["location_raw"], listing.city_slug)

    return ParsedListing(
        listing_id=parsed["listing_id"],
        listing_type=parsed["sale_type"],
        detail_url=listing.detail_url,
        price=parsed["price"],
        currency="EUR",
        title=title_text.strip(),
        description=description,
        rooms=parsed.get("bedrooms"),
        bathrooms=bathrooms,
        size_sqm=sqm,
        property_type=_normalize_type(parsed["type_raw"]),
        location_city=city or None,
        location_district=district or None,
        media=[cover] if cover else [],
    )
