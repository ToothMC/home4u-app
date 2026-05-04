"""Geteilte Parser-Helper für alle CY-Bauträger-Module.

Aristo nutzt diese Helper noch nicht (eigene lokale Konstanten/Regexes), aber
Pafilia, Leptos, Cybarco, Korantina, Imperio teilen die gleiche
HTML-Struktur (og-Meta, Yoast/WP), darum DRY hier zentral.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Iterable
from urllib.parse import urlparse

import httpx
from selectolax.parser import HTMLParser


PRICE_RE = re.compile(r'(?:&euro;|€|EUR\s*)\s*([0-9][0-9,.\s]*)', re.I)
BEDROOMS_RE = re.compile(r'(\d+)(?:\s*[-–]\s*(\d+))?\s*Bedroom', re.I)
AREA_RE = re.compile(r'(?:Covered area|Internal area|Living area|Built area)\s*[:|]?\s*([0-9.,]+)\s*m', re.I)

# Standard CY-City-Hints: fängt 90% der URL-Slugs ab.
CITY_HINTS_DEFAULT = {
    "paphos": "Paphos", "pafos": "Paphos", "peyia": "Paphos", "polis": "Paphos",
    "mandria": "Paphos", "venusrock": "Paphos", "venus-rock": "Paphos",
    "akamas": "Paphos", "tala": "Paphos", "chloraka": "Paphos",
    "limassol": "Limassol", "lemesos": "Limassol", "amathounta": "Limassol",
    "amathos": "Limassol", "agios-tychon": "Limassol", "germasogeia": "Limassol",
    "nicosia": "Nicosia", "lefkosia": "Nicosia", "engomi": "Nicosia",
    "larnaca": "Larnaca", "larnaka": "Larnaca",
    "famagusta": "Famagusta", "ayianapa": "Famagusta", "protaras": "Famagusta",
    "ayia-napa": "Famagusta",
}


def meta(tree: HTMLParser, prop: str, attr: str = "property") -> str | None:
    """Liest <meta property="..."> oder <meta name="...">."""
    node = tree.css_first(f'meta[{attr}="{prop}"]')
    if not node:
        return None
    val = node.attributes.get("content")
    return val.strip() if val else None


def og(tree: HTMLParser, prop: str) -> str | None:
    """og:* Helper mit Fallback auf <meta name=...>."""
    return meta(tree, prop, "property") or meta(tree, prop.replace("og:", ""), "name")


def parse_price_eur(text: str) -> float | None:
    """€ 1.234.567 / EUR 1,200,000 → 1234567.0. Gibt None zurück bei keinem Match."""
    m = PRICE_RE.search(text)
    if not m:
        return None
    raw = m.group(1).replace(",", "").replace(" ", "").replace(".", "")
    if not raw or len(raw) < 4:  # < 1000 EUR ist sicher kein Property-Preis
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def parse_bedrooms_max(text: str) -> int | None:
    """'2-4 Bedrooms' → 4 (max), '3 Bedroom' → 3, sonst None."""
    m = BEDROOMS_RE.search(text)
    if not m:
        return None
    try:
        return int(m.group(2) or m.group(1))
    except (TypeError, ValueError):
        return None


def parse_area_sqm(text: str) -> int | None:
    """'Covered area: 123.45 m²' → 123 (int)."""
    m = AREA_RE.search(text)
    if not m:
        return None
    try:
        return int(float(m.group(1).replace(",", "")))
    except ValueError:
        return None


def guess_city(slug: str, title: str | None = None, hints: dict[str, str] | None = None) -> str | None:
    """City aus Slug + optional Titel raten. Erste Match gewinnt — Reihenfolge in CITY_HINTS prüfen."""
    s = (slug + " " + (title or "")).lower()
    table = hints if hints is not None else CITY_HINTS_DEFAULT
    for hint, city in table.items():
        if hint in s:
            return city
    return None


def guess_property_type(slug: str, title: str | None = None) -> str:
    """plot/land → 'plot', villa/house/residence → 'house', apartment/flat → 'apartment',
    Default 'house' (Bauträger = überwiegend Neubau-Häuser/Villen)."""
    pt = (slug + " " + (title or "")).lower()
    if "plot" in pt or "land for sale" in pt or "/land/" in pt:
        return "plot"
    if any(k in pt for k in ("villa", "house", "residence", "maisonette", "townhouse", "bungalow")):
        return "house"
    if any(k in pt for k in ("apartment", "flat", "penthouse", "studio", "loft")):
        return "apartment"
    return "house"


# Bilder mit diesen Substrings sind keine Property-Photos (Logo, Icon, Badge, Award).
IMG_BLOCKLIST = (
    "/logo", "logo.", "logo-", "/icon", "icon-", "icons-", "-icon",
    "favicon", "/footer",
    "fb.svg", "insta.svg", "you.svg", "loc.svg", "facebook", "instagram",
    "twitter", "youtube", "linkedin", "whatsapp",
    "award", "badge", "certif", "included.png", "golf.png", "pin-",
)


def _is_property_image(url: str) -> bool:
    u = url.lower()
    if any(b in u for b in IMG_BLOCKLIST):
        return False
    if u.endswith(".svg"):
        return False
    return True


def _largest_from_srcset(srcset: str) -> str | None:
    """'a.jpg 300w, b.jpg 1024w, c.jpg 1920w' → 'c.jpg' (größte Variante)."""
    best_url, best_w = None, 0
    for entry in srcset.split(","):
        parts = entry.strip().split()
        if not parts:
            continue
        url = parts[0]
        if len(parts) < 2 or not parts[1].endswith("w"):
            return url  # fixed width oder 1x/2x — nimm erstes
        try:
            w = int(parts[1][:-1])
        except ValueError:
            continue
        if w > best_w:
            best_w, best_url = w, url
    return best_url


def collect_property_images(
    tree: HTMLParser,
    *,
    cover: str | None = None,
    upload_substr: str = "/wp-content/uploads/",
    limit: int = 20,
    min_width: int = 720,
) -> list[str]:
    """Sammelt Property-Bilder aus allen <img> mit upload_substr im src/srcset.

    Liest srcset und wählt Variante ≥ min_width (Memory: feedback_image_quality.md).
    Cover wird vorne eingefügt wenn nicht schon dabei. Logos/Icons via IMG_BLOCKLIST raus.
    """
    media: list[str] = []
    seen: set[str] = set()
    if cover and _is_property_image(cover):
        media.append(cover)
        seen.add(cover)

    for img in tree.css('img'):
        # img-Tag-Attribute width/height filtern: <400px breit ist kein Property-Photo
        try:
            iw = int(img.attributes.get("width") or 0)
        except (TypeError, ValueError):
            iw = 0
        if 0 < iw < 400:
            continue
        srcset = img.attributes.get("srcset") or img.attributes.get("data-srcset")
        src = img.attributes.get("src") or img.attributes.get("data-src") or ""
        if upload_substr not in src and (not srcset or upload_substr not in srcset):
            continue
        chosen: str | None = None
        if srcset:
            # Versuche ≥min_width-Variante
            best_url, best_w = None, 0
            for entry in srcset.split(","):
                parts = entry.strip().split()
                if len(parts) < 2 or not parts[1].endswith("w"):
                    continue
                try:
                    w = int(parts[1][:-1])
                except ValueError:
                    continue
                if w >= min_width and w > best_w:
                    best_w, best_url = w, parts[0]
            chosen = best_url or _largest_from_srcset(srcset)
        if not chosen:
            chosen = src
        if not chosen or chosen in seen or not _is_property_image(chosen):
            continue
        seen.add(chosen)
        media.append(chosen)
        if len(media) >= limit:
            break
    return media


def fetch_sitemap_locs(client: httpx.Client, sitemap_url: str) -> list[str]:
    """Liefert alle <loc>-Einträge aus einer (XML-)Sitemap. Leere Liste bei Fehler."""
    try:
        resp = client.get(sitemap_url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
    except Exception:
        return []
    try:
        root = ET.fromstring(resp.content)
    except ET.ParseError:
        return []
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    locs = [loc.text for loc in root.findall(".//sm:loc", ns) if loc.text]
    if not locs:
        # Manche Sitemaps ohne Namespace
        locs = [loc.text for loc in root.iter() if loc.tag.endswith("loc") and loc.text]
    return [u.strip() for u in locs if u]


def is_english_path(url: str, locale_prefixes: Iterable[str] = ("/ru/", "/de/", "/zh/", "/zh-hans/", "/vi/", "/fr/", "/pl/", "/ar/", "/he/", "/el/")) -> bool:
    """True wenn URL keine bekannte Sprach-Subroute hat. EN ist die Default-Locale aller Bauträger."""
    path = urlparse(url).path
    return not any(path.startswith(p) for p in locale_prefixes)
