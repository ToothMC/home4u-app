"""Platzhalter-Module für die noch nicht implementierten Bauträger.

Jeder Stub liefert leere `discover()`-Liste — der Orchestrator skipped sie
graceful. Wenn ein Stub implementiert wird: Datei nach src/{name}.py
verschieben, in main.py DEVELOPER_MODULES registrieren.

Implementierungs-Hinweise pro Bauträger (siehe Sitemaps + ToS-Recherche):

PAFILIA — pafilia.com (WP, Yoast, sitemap_index.xml mit RU/VI/ZH-Subsitemaps).
  Property-URLs: /properties/{slug}. Verkauft Premium (ONE Limassol etc.).
  Empfehlung: sitemap_index → properties.xml lesen, dann pro Slug parsen.

LEPTOS — leptosestates.com (WP, Yoast). 60-Jahre-Brand, Multi-Sprach.
  Property-URLs: /property/{slug}/. Limassol + Paphos Schwerpunkt.

CYBARCO — cybarco.com (WP, Yoast, Crawl-delay 10s respektieren).
  ~7 Flagship-Projekte (Limassol Marina, Trilogy etc.) — kein paginiertes
  Inventory, sondern projektzentriert. Vermutlich nur ~10-30 Listings.
  Empfehlung: /developments/ Index-Page parsen, kein klassisches Listing-Modell.

KORANTINA — korantinahomes.com (Django?, simple sitemap.xml).
  /projects/{slug}/ — 23+ Projekte, primär Cap St Georges, Royal Bay etc. Pap.

IMPERIO — imperioproperties.com (WP, sitemap.xml).
  6+ Flagship-Projekte, Limassol-only Luxus.
  Empfehlung: /our-projects/ + /developments/ parsen.
"""
from __future__ import annotations

import logging
from typing import Iterable

import httpx

from .base import ParsedListing

log = logging.getLogger(__name__)


def _make_stub(developer: str, base_url: str):
    class StubModule:
        DEVELOPER = developer
        BASE_URL = base_url

        @staticmethod
        def discover(client: httpx.Client) -> Iterable[str]:
            log.info("%s stub — discover not implemented", developer)
            return []

        @staticmethod
        def parse(client: httpx.Client, url: str) -> ParsedListing | None:
            return None
    return StubModule


pafilia = _make_stub("pafilia", "https://www.pafilia.com")
leptos = _make_stub("leptos", "https://www.leptosestates.com")
cybarco = _make_stub("cybarco", "https://www.cybarco.com")
korantina = _make_stub("korantina", "https://korantinahomes.com")
imperio = _make_stub("imperio", "https://www.imperioproperties.com")
