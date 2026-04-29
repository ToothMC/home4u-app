"""INDEX.cy Detail-Page-Extraktion.

Quellen pro Listing:
1. JSON-LD RealEstateListing (description, price, image-Cover)
2. og:* / twitter:* Meta-Tags (Backup für price/title)
3. Custom HTML-Block mit Bedrooms/Bathrooms/Area-Icons + Werten
4. URL-Pattern + Title-Regex (rooms, type, location)

Output: ParsedListing — passt direkt ins bulk_upsert_external_listings-Schema.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)


@dataclass
class ParsedListing:
    listing_id: str
    listing_type: str  # rent|sale
    detail_url: str

    # Pflicht für Insert
    price: float | None = None
    currency: str = "EUR"

    # Optional, für Match-Qualität wichtig
    title: str | None = None
    description: str | None = None
    rooms: int | None = None
    bathrooms: int | None = None
    size_sqm: int | None = None
    property_type: str | None = None  # apartment|house|room|plot
    location_city: str | None = None
    location_district: str | None = None
    media: list[str] = field(default_factory=list)

    # Dedup-Signal: wird im main.py post-extract berechnet
    cover_phash: int | None = None

    # Klartext-Kontaktdaten für Outreach (encrypted server-side im RPC).
    # Werden aus Detail-HTML extrahiert wenn sichtbar — INDEX zeigt phone
    # häufig direkt im Anbieter-Block, email seltener.
    contact_phone: str | None = None
    contact_phone_country: str | None = None
    contact_email: str | None = None
    phone_hash: str | None = None  # für Cross-Source-Dedup


# Title-Pattern: "3 Bedroom Apartment for Sale in Oroklini, Larnaca District €415000"
# oder "Studio for Rent in Limassol €1500" / "Plot for Sale in Paphos €120000"
_TITLE_RE = re.compile(
    r"^(?:(?P<rooms>\d+|Studio)\s+(?P<rtype>Bedroom|Studio)\s+)?"
    r"(?P<ptype>[A-Za-z]+)\s+for\s+(?P<sale>Sale|Rent)\s+"
    r"in\s+(?P<location>[^€]+?)\s*(?:€\s*(?P<price>[\d,.]+))?\s*$",
    re.IGNORECASE,
)

# Schema.org property-type → Home4U taxonomy
_PROP_TYPE_MAP = {
    "apartment": "apartment",
    "studio": "apartment",
    "penthouse": "apartment",
    "maisonette": "apartment",
    "flat": "apartment",
    "house": "house",
    "villa": "house",
    "townhouse": "house",
    "bungalow": "house",
    "detached": "house",
    "semi-detached": "house",
    "terraced": "house",
    "room": "room",
    "studio-room": "room",
    "plot": "plot",
    "land": "plot",
    "field": "plot",
    "parcel": "plot",
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _fetch(client: httpx.Client, url: str) -> str:
    resp = client.get(url, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def _extract_jsonld(html: str) -> dict[str, Any] | None:
    """Sucht das RealEstateListing-JSON-LD im HTML. Liefert das geparste
    dict oder None wenn keine RealEstateListing-Variante gefunden wurde."""
    for m in re.finditer(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    ):
        try:
            data = json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("@type") == "RealEstateListing":
            return data
    return None


def _normalize_property_type(raw: str | None) -> str | None:
    if not raw:
        return None
    return _PROP_TYPE_MAP.get(raw.strip().lower())


def _parse_title(title: str) -> dict[str, Any]:
    """Holt rooms + property_type + location aus Titel-Pattern."""
    out: dict[str, Any] = {}
    m = _TITLE_RE.match(title.strip())
    if not m:
        return out
    rooms_raw = m.group("rooms")
    if rooms_raw:
        if rooms_raw.lower() == "studio":
            out["rooms"] = 0
        else:
            try:
                out["rooms"] = int(rooms_raw)
            except ValueError:
                pass
    ptype_token = (m.group("ptype") or "").lower()
    out["property_type"] = _normalize_property_type(ptype_token)
    # "Studio for Sale/Rent in X" → property_type=apartment + rooms=0
    if "rooms" not in out and ptype_token == "studio":
        out["rooms"] = 0
    location = (m.group("location") or "").strip().rstrip(",")
    if location:
        # "Oroklini, Larnaca District" → city = Larnaca, district = Oroklini
        parts = [p.strip() for p in location.split(",")]
        if len(parts) >= 2:
            district = parts[0]
            city_raw = parts[-1]
            # "Larnaca District" → "Larnaca"
            city = re.sub(r"\s+District$", "", city_raw, flags=re.IGNORECASE)
            out["location_district"] = district
            out["location_city"] = city
        else:
            out["location_city"] = parts[0]
    return out


def _extract_specs(html: str) -> dict[str, Any]:
    """Extrahiert Bedrooms / Bathrooms / Area aus dem custom Listing-Specs-
    Block. INDEX.cy nutzt Elementor-Repeater mit aria-label-Pattern."""
    out: dict[str, Any] = {}

    # Bedrooms — `aria-label="Bedrooms" ... ts-action-con">...</i>{N}<`
    m = re.search(
        r'aria-label="Bedrooms"[^>]*>.*?ts-action-con">.*?</i>\s*(\d+)\s*<',
        html, re.DOTALL,
    )
    if m:
        try:
            out["rooms"] = int(m.group(1))
        except ValueError:
            pass

    # Bathrooms (analog)
    m = re.search(
        r'aria-label="Bathrooms"[^>]*>.*?ts-action-con">.*?</i>\s*(\d+)\s*<',
        html, re.DOTALL,
    )
    if m:
        try:
            out["bathrooms"] = int(m.group(1))
        except ValueError:
            pass

    # Area: `Area: <b>100 m²</b>`
    m = re.search(r"Area:\s*<b>\s*([\d.,]+)\s*m²\s*</b>", html)
    if m:
        try:
            sz = int(float(m.group(1).replace(",", ".")))
            if 5 < sz < 5000:
                out["size_sqm"] = sz
        except ValueError:
            pass

    return out


def _extract_meta(html: str) -> dict[str, Any]:
    """Holt og:image + og:title als Backup."""
    out: dict[str, Any] = {}
    m = re.search(r'<meta[^>]*property="og:title"[^>]*content="([^"]+)"', html)
    if m:
        out["og_title"] = m.group(1)
    m = re.search(r'<meta[^>]*property="og:image"[^>]*content="([^"]+)"', html)
    if m:
        out["og_image"] = m.group(1)
    return out


_TEL_HREF_RE = re.compile(r'href="tel:([^"]+)"', re.IGNORECASE)
_MAILTO_HREF_RE = re.compile(r'href="mailto:([^"?]+)', re.IGNORECASE)
_PHONE_TEXT_RE = re.compile(r"\+?\d[\d\s().\-]{7,}\d")


def _extract_contact(html: str) -> dict[str, Optional[str]]:
    """Phone+Email aus dem Anbieter-Block. Best-effort, kein Click-Reveal nötig."""
    phone = None
    email = None
    m = _TEL_HREF_RE.search(html)
    if m:
        phone = m.group(1).strip()
    if not phone:
        # Fallback: Plaintext-Pattern in spezifischen Blocks (data-phone-Attribut etc.)
        m = re.search(r'data-phone(?:-number)?="([^"]+)"', html, re.IGNORECASE)
        if m:
            phone = m.group(1).strip()
    m = _MAILTO_HREF_RE.search(html)
    if m:
        email = m.group(1).strip()
    return {"phone": phone, "email": email}


def parse_detail(html: str, sitemap_listing) -> Optional[ParsedListing]:
    """Hauptmethode: HTML + sitemap.ListingURL → ParsedListing.

    sitemap_listing ist aus sitemap.ListingURL (forward-typed um zirkulären
    import zu vermeiden).
    """
    jsonld = _extract_jsonld(html)
    meta = _extract_meta(html)

    title = None
    description = None
    price = None
    currency = "EUR"
    cover = None

    if jsonld:
        title = jsonld.get("name")
        description = jsonld.get("description")
        cover = jsonld.get("image")
        offers = jsonld.get("offers")
        if isinstance(offers, dict):
            try:
                price = float(offers.get("price"))
            except (TypeError, ValueError):
                pass
            currency = offers.get("priceCurrency") or "EUR"

    title = title or meta.get("og_title")
    cover = cover or meta.get("og_image")

    # Price-Fallback aus Title
    if price is None and title:
        m = re.search(r"€\s*([\d,.]+)", title)
        if m:
            try:
                price = float(m.group(1).replace(",", "").replace(".", ""))
                # NB: bei Titeln wie "€415000" kein Tausender-Trenner —
                # einfach alle nicht-Ziffern entfernen.
            except ValueError:
                pass

    if price is None or not title:
        log.debug("skip: missing price/title for %s", sitemap_listing.detail_url)
        return None

    parsed = ParsedListing(
        listing_id=sitemap_listing.listing_id,
        listing_type=sitemap_listing.listing_type,
        detail_url=sitemap_listing.detail_url,
        price=price,
        currency=currency,
        title=title,
        description=description,
    )

    # Bilder: aus Sitemap (mehrere) + Cover-Fallback
    if sitemap_listing.image_urls:
        parsed.media = list(sitemap_listing.image_urls)
    elif cover:
        parsed.media = [cover]

    # Rooms / property_type / location aus Title
    title_data = _parse_title(title)
    if "rooms" in title_data:
        parsed.rooms = title_data["rooms"]
    parsed.property_type = title_data.get("property_type")
    parsed.location_city = title_data.get("location_city")
    parsed.location_district = title_data.get("location_district")

    # Specs aus HTML override Title-Werte (genauer)
    specs = _extract_specs(html)
    if "rooms" in specs:
        parsed.rooms = specs["rooms"]
    if "bathrooms" in specs:
        parsed.bathrooms = specs["bathrooms"]
    if "size_sqm" in specs:
        parsed.size_sqm = specs["size_sqm"]

    # Kontaktdaten — best-effort aus dem Detail-HTML.
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
