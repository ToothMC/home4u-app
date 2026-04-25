"""Entry-Point: orchestriert robots.txt → Crawl aller Cities → Bulk-Upsert."""
from __future__ import annotations

import logging
import os
import sys
import time
from collections import defaultdict

from dotenv import load_dotenv

from .config import PROPERTY_SUBTYPES, selected_cities, selected_types
from .crawler import RawListing, crawl_city, fetch_disallowed_paths, with_browser
from .supabase_writer import mark_stale_old_listings, upsert_listings


def _setup_logging() -> None:
    level = logging.INFO if not os.getenv("DEBUG") else logging.DEBUG
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def main() -> int:
    load_dotenv()
    _setup_logging()
    log = logging.getLogger("crawler")

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein (siehe .env.example)")
        return 1

    cities = selected_cities()
    types = selected_types()
    log.info("Crawl-Plan: cities=%s, types=%s, subtypes=%s", [c.display for c in cities], types, PROPERTY_SUBTYPES)

    log.info("Lade robots.txt …")
    disallowed = fetch_disallowed_paths()
    log.info("Disallow-Pfade: %d", len(disallowed))

    started = time.time()
    all_items: list[RawListing] = []
    per_city_counts: dict[tuple[str, str], int] = defaultdict(int)

    with with_browser() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for city in cities:
                for listing_type in types:
                    for subtype in PROPERTY_SUBTYPES:
                        items = list(crawl_city(browser, city, listing_type, subtype, disallowed))
                        per_city_counts[(city.display, listing_type)] += len(items)
                        all_items.extend(items)
        finally:
            browser.close()

    log.info("Crawl-Ende: %d items in %.1fs", len(all_items), time.time() - started)
    for (city, t), n in sorted(per_city_counts.items()):
        log.info("  %s/%s: %d", city, t, n)

    if not all_items:
        log.warning("Keine Items gefunden — DB nicht geändert.")
        return 0

    if os.getenv("DRY_RUN") == "1":
        log.info("DRY_RUN=1 — kein Supabase-Write.")
        return 0

    log.info("Bulk-Upsert nach Supabase …")
    result = upsert_listings(all_items)
    log.info("Upsert: %s", result)

    log.info("Mark stale (>7d unseen) …")
    stale = mark_stale_old_listings(stale_days=7)
    log.info("Stale-marked: %d", stale)

    return 0


if __name__ == "__main__":
    sys.exit(main())
