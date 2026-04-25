"""Crawl-Konfiguration: Cities + URL-Pattern + Tuning."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class CityConfig:
    """Eine Stadt = (Anzeigename, URL-Slug)."""
    display: str  # so steht's in listings.location_city
    slug: str     # bazaraki URL-Komponente


# Bazaraki-URL-Konvention:
# /real-estate-{to-rent|for-sale}/{property-type}/{slug}-district-{display-lower}/
CITIES: list[CityConfig] = [
    CityConfig(display="Limassol", slug="lemesos"),
    CityConfig(display="Paphos", slug="pafos"),
    CityConfig(display="Larnaca", slug="larnaca"),
    CityConfig(display="Nicosia", slug="lefkosia"),
    CityConfig(display="Famagusta", slug="ammochostos"),
]

# Welche Listing-Typen + Property-Subtypen
LISTING_TYPES = ["rent", "sale"]

# Property-Subtypen pro Listing-Typ — Bazaraki trennt diese im Pfad
PROPERTY_SUBTYPES = ["apartments-flats", "houses"]

BASE_URL = "https://www.bazaraki.com"
ROBOTS_URL = f"{BASE_URL}/robots.txt"


def build_listing_url(city: CityConfig, listing_type: str, subtype: str, page: int = 1) -> str:
    """Baut die paginierte Listenseiten-URL."""
    deal = "to-rent" if listing_type == "rent" else "for-sale"
    # district-Slug: kleingeschrieben (e.g. "limassol", "paphos")
    district = city.display.lower()
    base = f"{BASE_URL}/real-estate-{deal}/{subtype}/{city.slug}-district-{district}/"
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
MAX_PAGES_PER_CITY = env_int("MAX_PAGES_PER_CITY", 10)
USER_AGENT = env_str("USER_AGENT", "Home4U-Indexer/0.1 (contact@home4u.ai)")


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
