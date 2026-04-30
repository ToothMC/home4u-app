"""cyprus-real.estate Detail-Page-Extraktion.

c-r-e nutzt schema.org Microdata + og: Meta-Tags:
- og:title hat den vollen Titel inkl. "for rent/sale", property_type, location,
  agent, specs ("2 bedrooms, 92m2"), und "No. NNNN"
- itemprop="price" / "priceCurrency" / "numberOfBedrooms" / "floorSize" für
  strukturierte Werte
- itemprop="image" liefert das Original-Cover (kein Resize-Suffix → ≥720px)
- Gallery-Thumbs haben "_NxM" im Filenamen — Original durch Strippen erreichbar
- Bathrooms sind häufig nur als Label ohne Wert sichtbar → optional

JSON-LD-RealEstateListing existiert NICHT auf c-r-e — wir parsen nur Microdata.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)


@dataclass
class ParsedListing:
    listing_id: str
    listing_type: str  # rent|sale
    detail_url: str

    price: float | None = None
    currency: str = "EUR"

    title: str | None = None
    description: str | None = None
    rooms: int | None = None
    bathrooms: int | None = None
    size_sqm: int | None = None
    property_type: str | None = None
    location_city: str | None = None
    location_district: str | None = None
    media: list[str] = field(default_factory=list)

    cover_phash: int | None = None

    contact_phone: str | None = None
    contact_phone_country: str | None = None
    contact_email: str | None = None
    phone_hash: str | None = None


# og:title pattern, Beispiel:
#   "Apartment for rent in Aglandjia, Nicosia,  by Keller Williams:
#    2 bedrooms, 92m2 No. 40252 | Cyprus-Real.Estate"
# - property_type: erstes Wort ("Apartment", "Villa", "House", "Plot", …)
# - deal: rent|sale
# - location: "Aglandjia, Nicosia" (district, city)
# - optional: " by {agent}"
# - specs: ":\s*N bedrooms,\s*Mm2"
# - listing_id: "No. \d+"
_OG_TITLE_RE = re.compile(
    r"^(?P<ptype>[A-Za-z][\w-]+(?:\s[A-Za-z][\w-]+)?)\s+for\s+(?P<deal>rent|sale)\s+"
    r"in\s+(?P<location>[^|:]+?)\s*"
    r"(?:\s+by\s+[^|:]+?)?"
    r"(?::\s*(?P<specs>[^|]*?))?"
    r"\s*(?:No\.\s*(?P<id>\d+))?"
    r"\s*\|",
    re.IGNORECASE,
)

_PROP_TYPE_MAP = {
    "apartment": "apartment",
    "studio": "apartment",
    "penthouse": "apartment",
    "maisonette": "apartment",
    "flat": "apartment",
    "duplex": "apartment",
    "house": "house",
    "villa": "house",
    "townhouse": "house",
    "town house": "house",
    "bungalow": "house",
    "detached": "house",
    "semi-detached": "house",
    "terraced": "house",
    "room": "room",
    "plot": "plot",
    "land": "plot",
    "field": "plot",
    "parcel": "plot",
}


# Image-Resize-Suffix der Gallery-Thumbs: file_NNNxNNN.jpg → file.jpg
_IMG_RESIZE_RE = re.compile(r"_\d+x\d+(\.[a-zA-Z]+)$")


def _strip_resize_suffix(url: str) -> str:
    """`abc_480x320.jpg` → `abc.jpg` (Original-Auflösung).

    Per Memory-Regel: ≥720px Cover, kein Thumbnail. c-r-e liefert Originals
    wenn man `_NxN` aus dem Filenamen entfernt.
    """
    return _IMG_RESIZE_RE.sub(r"\1", url)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _fetch(client: httpx.Client, url: str) -> str:
    resp = client.get(url, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def _normalize_property_type(raw: str | None) -> str | None:
    if not raw:
        return None
    return _PROP_TYPE_MAP.get(raw.strip().lower())


def _extract_meta(html: str) -> dict[str, str]:
    """og:* + twitter:* meta-tags."""
    out: dict[str, str] = {}
    for prop in ("og:title", "og:image", "og:description"):
        m = re.search(
            rf'<meta[^>]*property="{re.escape(prop)}"[^>]*content="([^"]+)"',
            html,
        )
        if m:
            out[prop] = m.group(1)
    return out


def _extract_microdata(html: str) -> dict:
    """Microdata-Werte: price, currency, rooms, size_sqm, location, image."""
    out: dict = {}

    m = re.search(r'itemprop="price"[^>]*content="(\d+(?:\.\d+)?)"', html)
    if m:
        try:
            out["price"] = float(m.group(1))
        except ValueError:
            pass

    m = re.search(r'itemprop="priceCurrency"[^>]*content="([A-Z]{3})"', html)
    if m:
        out["currency"] = m.group(1)

    m = re.search(r'itemprop="numberOfBedrooms"[^>]*content="(\d+)"', html)
    if m:
        try:
            out["rooms"] = int(m.group(1))
        except ValueError:
            pass

    # floorSize → div mit itemprop="value" innerhalb der nächsten ~300 Zeichen
    m = re.search(
        r'itemprop="floorSize"[^>]*>.*?itemprop="value"[^>]*content="(\d+(?:\.\d+)?)"',
        html, re.DOTALL,
    )
    if m:
        try:
            sz = int(float(m.group(1)))
            if 5 < sz < 5000:
                out["size_sqm"] = sz
        except ValueError:
            pass

    # addressLocality — erstes nicht-leeres Vorkommen, Format "City, District"
    # oder nur "City"
    for m in re.finditer(
        r'itemprop="addressLocality"[^>]*content="([^"]*)"', html
    ):
        val = m.group(1).strip().strip(",").strip()
        if val:
            parts = [p.strip() for p in val.split(",") if p.strip()]
            if len(parts) >= 2:
                # Konvention bei c-r-e: "City, District" → city zuerst
                out["location_city"] = parts[0]
                out["location_district"] = ", ".join(parts[1:])
            else:
                out["location_city"] = parts[0]
            break

    # Cover via itemprop="image" (Original-Auflösung, kein Resize-Suffix)
    m = re.search(r'itemprop="image"[^>]*href="([^"]+)"', html)
    if m:
        out["cover_image"] = m.group(1).strip()

    return out


def _extract_gallery(html: str) -> list[str]:
    """Alle `<img src="https://storage1.cyprus-real.estate/...">`-URLs aus dem
    Gallery-Block. Resize-Suffix wird gestrippt → Original-Auflösung."""
    found: list[str] = []
    for m in re.finditer(
        r'<img[^>]*src="(https://storage1\.cyprus-real\.estate/[^"]+)"',
        html,
    ):
        url = _strip_resize_suffix(m.group(1).strip())
        if url not in found:
            found.append(url)
    return found


def _parse_og_title(og_title: str) -> dict:
    """og:title → property_type, deal, location, listing_id, specs."""
    out: dict = {}
    m = _OG_TITLE_RE.match(og_title.strip())
    if not m:
        return out

    ptype = (m.group("ptype") or "").strip().lower()
    out["property_type"] = _normalize_property_type(ptype)
    out["deal"] = m.group("deal").lower()  # rent|sale

    location = (m.group("location") or "").strip().rstrip(",").strip()
    if location:
        parts = [p.strip() for p in location.split(",") if p.strip()]
        if len(parts) >= 2:
            # Format "District, City" wie in og:title (z.B. "Aglandjia, Nicosia")
            out["location_district"] = parts[0]
            out["location_city"] = parts[-1]
        elif parts:
            out["location_city"] = parts[0]

    if m.group("id"):
        out["listing_id_from_title"] = m.group("id")

    specs = m.group("specs") or ""
    if specs:
        m2 = re.search(r"(\d+)\s*bedrooms?", specs, re.IGNORECASE)
        if m2:
            try:
                out["rooms"] = int(m2.group(1))
            except ValueError:
                pass
        m3 = re.search(r"(\d+)\s*m2|(\d+)\s*m²", specs)
        if m3:
            try:
                out["size_sqm"] = int(m3.group(1) or m3.group(2))
            except (ValueError, TypeError):
                pass

    return out


_TEL_HREF_RE = re.compile(r'href="tel:([^"]+)"', re.IGNORECASE)
_MAILTO_HREF_RE = re.compile(r'href="mailto:([^"?]+)', re.IGNORECASE)


def _extract_contact(html: str) -> dict[str, Optional[str]]:
    phone = email = None
    m = _TEL_HREF_RE.search(html)
    if m:
        phone = m.group(1).strip()
    m = _MAILTO_HREF_RE.search(html)
    if m:
        email = m.group(1).strip()
    return {"phone": phone, "email": email}


def parse_detail(html: str, sitemap_listing) -> Optional[ParsedListing]:
    """HTML + sitemap.ListingURL → ParsedListing.

    Mindestbedingung für Insert: price + (title oder location).
    """
    meta = _extract_meta(html)
    microdata = _extract_microdata(html)

    og_title = meta.get("og:title", "")
    if "Error 404" in og_title or "page not found" in html[:5000].lower():
        log.debug("404 page: %s", sitemap_listing.detail_url)
        return None

    title_data = _parse_og_title(og_title)

    price = microdata.get("price")
    currency = microdata.get("currency", "EUR")
    deal = title_data.get("deal")
    if not deal:
        # Fallback: Text-Search im HTML
        if re.search(r"\bfor\s+rent\b", html, re.IGNORECASE):
            deal = "rent"
        elif re.search(r"\bfor\s+sale\b", html, re.IGNORECASE):
            deal = "sale"

    if price is None or not deal:
        log.debug("skip: missing price/deal for %s", sitemap_listing.detail_url)
        return None

    parsed = ParsedListing(
        listing_id=sitemap_listing.listing_id,
        listing_type=deal,
        detail_url=sitemap_listing.detail_url,
        price=price,
        currency=currency,
        title=og_title or None,
        description=meta.get("og:description"),
    )

    # Microdata gewinnt für strukturierte Werte (genauer als Title-Regex)
    parsed.rooms = microdata.get("rooms") or title_data.get("rooms")
    parsed.size_sqm = microdata.get("size_sqm") or title_data.get("size_sqm")
    parsed.property_type = title_data.get("property_type")

    # Location: Microdata addressLocality first, dann og:title-Fallback.
    # c-r-e Microdata hat oft "City, District" — wir behandeln das im
    # _extract_microdata schon. Wenn fehlend → Title-Daten.
    parsed.location_city = (
        microdata.get("location_city") or title_data.get("location_city")
    )
    parsed.location_district = (
        microdata.get("location_district") or title_data.get("location_district")
    )

    # Bilder: Cover (Original) + Gallery (mit Resize-Strip)
    media: list[str] = []
    cover = microdata.get("cover_image") or meta.get("og:image")
    if cover:
        media.append(_strip_resize_suffix(cover))
    for img in _extract_gallery(html):
        if img not in media:
            media.append(img)
    parsed.media = media

    contact = _extract_contact(html)
    if contact["phone"]:
        from .contact import normalize_phone, country_prefix, compute_phone_hash
        norm = normalize_phone(contact["phone"])
        if norm:
            parsed.contact_phone = norm
            parsed.contact_phone_country = country_prefix(norm)
            parsed.phone_hash = compute_phone_hash(contact["phone"])
    if contact["email"] and "@" in contact["email"]:
        parsed.contact_email = contact["email"].lower().strip()

    return parsed


def fetch_and_parse(client: httpx.Client, sitemap_listing) -> Optional[ParsedListing]:
    try:
        html = _fetch(client, sitemap_listing.detail_url)
    except Exception as e:
        log.debug("fetch failed %s: %s", sitemap_listing.detail_url, e)
        return None
    return parse_detail(html, sitemap_listing)
