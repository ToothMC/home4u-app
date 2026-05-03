"""Crawl-Konfiguration: Cities + URL-Pattern + Tuning."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class CityConfig:
    """Eine Stadt = (Anzeigename, expliziter Bazaraki-URL-Pfad).

    `district_path` wurde 2026-04 von `slug + display` Auto-Stitching auf
    explizit umgestellt, weil Bazaraki je Stadt unterschiedlich routet:
    Larnaca nutzt griechische Transliteration `larnaka` (mit „k"), Famagusta
    hat gar keinen `-{display}`-Suffix. Die alte Auto-Logik produzierte für
    diese beiden Cities 404 → Crawler hat sie monatelang nicht aktualisiert.
    """
    display: str         # so steht's in listings.location_city
    district_path: str   # Bazaraki-URL-Komponente, z.B. "lemesos-district-limassol"


# Bazaraki-URL-Konvention:
# /real-estate-{to-rent|for-sale}/{property-type}/{district_path}/
CITIES: list[CityConfig] = [
    CityConfig(display="Limassol",  district_path="lemesos-district-limassol"),
    CityConfig(display="Paphos",    district_path="pafos-district-paphos"),
    CityConfig(display="Larnaca",   district_path="larnaka-district-larnaca"),
    CityConfig(display="Nicosia",   district_path="lefkosia-district-nicosia"),
    CityConfig(display="Famagusta", district_path="ammochostos-district"),
]

# Welche Listing-Typen + Property-Subtypen
LISTING_TYPES = ["rent", "sale"]

# Bazaraki-Top-Kategorien pro Listing-Typ. Gefiltert auf Home4U-Zielgruppe
# (Endkunden-Wohnen, kein Gewerbe, keine Investoren-Pakete).
# Rent ohne short-term/plots/commercial; Sale ohne residential-buildings/commercial.
PROPERTY_SUBTYPES_BY_TYPE: dict[str, list[str]] = {
    "rent": ["apartments-flats", "houses", "rooms-flatmates"],
    "sale": ["apartments-flats", "houses", "plots-of-land", "prefabricated-houses"],
}

# Bazaraki-Slug → Home4U-Taxonomie. Bazaraki mischt Bauweise (prefab),
# Deal-Modell (rooms) und Use-Case (plots) — wir normalisieren für die
# Match-Engine auf 4 Buckets: apartment, house, room, plot.
HOME4U_PROPERTY_TYPE_BY_SUBTYPE: dict[str, str] = {
    "apartments-flats": "apartment",
    "houses": "house",
    "prefabricated-houses": "house",
    "rooms-flatmates": "room",
    "plots-of-land": "plot",
}


def home4u_property_type(bazaraki_subtype: str) -> str | None:
    return HOME4U_PROPERTY_TYPE_BY_SUBTYPE.get(bazaraki_subtype)

BASE_URL = "https://www.bazaraki.com"
ROBOTS_URL = f"{BASE_URL}/robots.txt"


def build_listing_url(city: CityConfig, listing_type: str, subtype: str, page: int = 1) -> str:
    """Baut die paginierte Listenseiten-URL."""
    deal = "to-rent" if listing_type == "rent" else "for-sale"
    base = f"{BASE_URL}/real-estate-{deal}/{subtype}/{city.district_path}/"
    if page > 1:
        return f"{base}?page={page}"
    return base


def env_int(key: str, default: int) -> int:
    raw = os.getenv(key, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_str(key: str, default: str) -> str:
    return os.getenv(key, "").strip() or default


def env_list(key: str) -> list[str] | None:
    raw = os.getenv(key, "").strip()
    if not raw:
        return None
    return [s.strip().lower() for s in raw.split(",") if s.strip()]


# Runtime-Config aus Env
RATE_LIMIT_SECONDS = env_int("RATE_LIMIT_SECONDS", 3)
MAX_PAGES_PER_CITY = env_int("MAX_PAGES_PER_CITY", 60)
USER_AGENT = env_str("USER_AGENT", "Home4U-Indexer/0.1 (info@home4u.ai)")


def selected_cities() -> list[CityConfig]:
    filter_ = env_list("CITIES")
    if filter_ is None:
        return CITIES
    return [c for c in CITIES if c.display.lower() in filter_]


def selected_types() -> list[str]:
    filter_ = env_list("TYPES")
    if filter_ is None:
        return LISTING_TYPES
    return [t for t in LISTING_TYPES if t in filter_]
