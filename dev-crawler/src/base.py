"""Gemeinsame Datenstrukturen + Protocols für Per-Developer-Module.

Jedes Developer-Modul (aristo.py, pafilia.py, …) liefert:
  - DEVELOPER: str — Slug fürs external_id-Prefix
  - BASE_URL: str — Für robots.txt + absolute URL-Joining
  - discover(client) -> Iterable[str] — Liste aller Detail-URLs
  - parse(client, url) -> ParsedListing | None — pro Detail-URL ein Listing

Der gemeinsame Orchestrator in main.py iteriert pro Developer:
  discover → filter (schon indexiert?) → streaming-fetch + parse + upsert.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Protocol

import httpx


@dataclass
class ParsedListing:
    """Pro Unit/Property eines Bauträgers — wird in writer.py auf RPC-Row gemappt."""
    listing_id: str         # Stable per-Developer-ID (URL-Slug oder UNIT-Code)
    listing_type: str       # "rent" | "sale" — Bauträger fast immer "sale"
    detail_url: str         # Original-URL für Bridge-Click

    location_city: str | None = None    # Limassol, Paphos, ...
    location_district: str | None = None
    price: float | None = None          # EUR
    currency: str = "EUR"
    rooms: int | None = None
    size_sqm: int | None = None
    property_type: str | None = None    # apartment | house | plot
    title: str | None = None
    description: str | None = None
    media: list[str] = field(default_factory=list)
    bathrooms: int | None = None

    # Cross-Source-Dedup-Signale
    cover_phash: int | None = None
    phone_hash: str | None = None
    contact_phone: str | None = None
    contact_phone_country: str | None = None
    contact_email: str | None = None


class DeveloperModule(Protocol):
    """Signatur die jedes Per-Developer-Modul implementieren muss."""
    DEVELOPER: str
    BASE_URL: str

    def discover(self, client: httpx.Client) -> Iterable[str]:
        """Alle aktuellen Detail-URLs (Properties for Sale + ggf. Rent)."""
        ...

    def parse(self, client: httpx.Client, url: str) -> ParsedListing | None:
        """Detail-Page → ParsedListing. None bei Parse-Fail (skip silently)."""
        ...
