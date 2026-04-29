"""INDEX.cy-Crawler Entry-Point.

Flow:
  1. Sitemap-Discovery: alle aktiven Listing-URLs aus 20+ Sub-Sitemaps
  2. Inkrementell: bereits in DB indexierte external_ids ausfiltern
  3. Detail-Fetch + Parse für die NEUEN Listings (httpx, kein Browser)
  4. pHash-Compute für Cover-Bilder
  5. Bulk-Upsert via bulk_upsert_external_listings RPC
     (mit automatischem canonical-Match gegen Bazaraki und alle
     anderen Sources — Cross-Source-Dedup ist da geschenkt)

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: Pflicht
  RATE_LIMIT_S: Sekunden Pause pro Detail-Fetch (default 1.0)
  MAX_LISTINGS: Cap für Smoke-Tests (default 0 = unbegrenzt)
  DRY_RUN=1: kein DB-Write, nur loggen
  SKIP_PHASH=1: pHash-Phase überspringen (5x schneller, kein Cross-Source-Match)
  FORCE_REFETCH=1: auch bereits indexierte Listings nochmal fetchen
"""
from __future__ import annotations

import logging
import os
import sys
import time

import httpx
from dotenv import load_dotenv

from .dedup import compute_phash_from_url
from .detail import ParsedListing, fetch_and_parse
from .sitemap import discover_all_listings
from .writer import fetch_already_indexed, mark_stale_old_listings, upsert_listings


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def main() -> int:
    load_dotenv()
    _setup_logging()
    log = logging.getLogger("index-crawler")

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein")
        return 1

    # Robust gegen Komma-Locale (DE/CY tippt "0,5" statt "0.5")
    rate_limit = float(os.getenv("RATE_LIMIT_S", "1.0").replace(",", "."))
    max_listings = int(os.getenv("MAX_LISTINGS", "0").strip() or "0") or None
    dry_run = os.getenv("DRY_RUN") == "1"
    skip_phash = os.getenv("SKIP_PHASH") == "1"
    force_refetch = os.getenv("FORCE_REFETCH") == "1"

    started = time.time()
    headers = {"User-Agent": "Home4U-Aggregator/0.1 (+https://home4u.ai/about)"}

    with httpx.Client(headers=headers, follow_redirects=True) as client:
        # Phase 1: Sitemap-Discovery
        log.info("Phase 1: sitemap-discovery …")
        all_urls = discover_all_listings(client)
        log.info("Discovery fertig: %d unique listings", len(all_urls))

        if not all_urls:
            log.warning("0 Listings discovered — Abbruch")
            return 0

        # Phase 2: inkrementell — schon indexierte ausfiltern
        if force_refetch:
            log.info("FORCE_REFETCH=1 — alle %d Listings werden gefetched", len(all_urls))
            todo = all_urls
        else:
            log.info("Lade Set bereits indexierter external_ids …")
            try:
                indexed = fetch_already_indexed(client)
                log.info("Schon indexiert: %d", len(indexed))
            except Exception as e:
                log.warning("fetch_already_indexed failed: %s — fallback full", e)
                indexed = set()
            todo = [u for u in all_urls if u.listing_id not in indexed]
            log.info("Neu zu fetchen: %d von %d", len(todo), len(all_urls))

        if max_listings:
            todo = todo[:max_listings]
            log.info("MAX_LISTINGS=%d aktiv → %d zu fetchen", max_listings, len(todo))

        if not todo:
            log.info("Nichts zu tun — alle bekannten Listings schon indexiert.")
            return 0

        # Phase 3: Detail-Fetch + Parse
        log.info("Phase 2: detail-fetch (rate-limit %.1fs) …", rate_limit)
        parsed: list[ParsedListing] = []
        detail_started = time.time()
        for idx, sitemap_listing in enumerate(todo, start=1):
            p = fetch_and_parse(client, sitemap_listing)
            if p is not None:
                parsed.append(p)
            if idx % 50 == 0:
                log.info(
                    "  detail-progress %d/%d (parsed %d, %.1fs)",
                    idx, len(todo), len(parsed), time.time() - detail_started,
                )
            time.sleep(rate_limit)
        log.info(
            "Detail-Phase fertig: %d/%d geparsed in %.1fs",
            len(parsed), len(todo), time.time() - detail_started,
        )

        if not parsed:
            log.warning("0 Listings geparsed — DB nicht geändert")
            return 0

        # Phase 4: pHash
        if skip_phash:
            log.info("SKIP_PHASH=1 — pHash-Berechnung übersprungen")
        else:
            log.info("Phase 3: pHash für %d Cover-Bilder …", len(parsed))
            phash_started = time.time()
            ok = 0
            for idx, item in enumerate(parsed, start=1):
                cover = item.media[0] if item.media else None
                if not cover:
                    continue
                ph = compute_phash_from_url(cover)
                if ph is not None:
                    item.cover_phash = ph
                    ok += 1
                if idx % 100 == 0:
                    log.info(
                        "  phash-progress %d/%d (ok %d, %.1fs)",
                        idx, len(parsed), ok, time.time() - phash_started,
                    )
            log.info(
                "pHash-Phase fertig: %d/%d in %.1fs",
                ok, len(parsed), time.time() - phash_started,
            )

    # Phase 5: Upsert
    if dry_run:
        log.info("DRY_RUN=1 — kein Supabase-Write. Sample:")
        for p in parsed[:3]:
            log.info("  %s | %s %s | €%s | %s rooms | %s m² | %s",
                     p.listing_id, p.listing_type, p.property_type,
                     p.price, p.rooms, p.size_sqm, p.location_city)
        return 0

    log.info("Phase 4: Bulk-Upsert nach Supabase …")
    result = upsert_listings(parsed)
    log.info("Upsert: %s", result)

    log.info("Mark stale (>3d unseen) …")
    stale = mark_stale_old_listings(stale_days=3)
    log.info("Stale-marked: %d", stale)

    log.info("Crawl-Ende: %.1fs total", time.time() - started)
    return 0


if __name__ == "__main__":
    sys.exit(main())
