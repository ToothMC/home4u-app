"""Entry-Point: orchestriert robots.txt → Crawl aller Cities → Bulk-Upsert."""
from __future__ import annotations

import logging
import os
import sys
import time
from collections import defaultdict

from dotenv import load_dotenv

from .config import PROPERTY_SUBTYPES_BY_TYPE, RATE_LIMIT_SECONDS, selected_cities, selected_types
from .crawler import RawListing, crawl_city, crawl_detail, fetch_disallowed_paths, with_browser
from .supabase_writer import (
    fetch_already_drilled_external_ids,
    mark_stale_old_listings,
    upsert_listings,
)


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
    log.info(
        "Crawl-Plan: cities=%s, types=%s, subtypes=%s",
        [c.display for c in cities],
        types,
        {t: PROPERTY_SUBTYPES_BY_TYPE[t] for t in types},
    )

    log.info("Lade robots.txt …")
    disallowed = fetch_disallowed_paths()
    log.info("Disallow-Pfade: %d", len(disallowed))

    started = time.time()
    all_items: list[RawListing] = []
    per_city_counts: dict[tuple[str, str], int] = defaultdict(int)

    skip_details = os.getenv("SKIP_DETAILS") == "1"
    force_full_drill = os.getenv("FORCE_FULL_DRILL") == "1"

    with with_browser() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for city in cities:
                for listing_type in types:
                    for subtype in PROPERTY_SUBTYPES_BY_TYPE[listing_type]:
                        items = list(crawl_city(browser, city, listing_type, subtype, disallowed))
                        per_city_counts[(city.display, listing_type)] += len(items)
                        all_items.extend(items)

            list_done = time.time() - started
            log.info("List-Phase fertig: %d items in %.1fs", len(all_items), list_done)

            # Detail-Drilling: pro Listing district + size_sqm + Bilder + chars holen.
            # Inkrementell: nur Listings drillen, deren external_id noch NICHT in der
            # DB als "drilled" markiert ist (district oder size_sqm gesetzt).
            # Spart bei 30k bestehenden Listings ~25h pro Lauf.
            # FORCE_FULL_DRILL=1 → ignoriert die Filter, drillt alles (für Reparatur-
            # Läufe oder wenn Bazaraki-Felder sich geändert haben).
            if skip_details:
                log.info("SKIP_DETAILS=1 — Detail-Drilling übersprungen.")
            else:
                if force_full_drill:
                    items_to_drill = all_items
                    log.info(
                        "FORCE_FULL_DRILL=1 — drille alle %d Listings ohne Skip.",
                        len(items_to_drill),
                    )
                else:
                    log.info("Frage bereits gedrillte external_ids ab …")
                    drilled_ids = fetch_already_drilled_external_ids()
                    log.info("Schon gedrillt: %d", len(drilled_ids))
                    items_to_drill = [
                        item for item in all_items if item.external_id not in drilled_ids
                    ]
                    log.info(
                        "Detail-Drill: %d neue von %d Items (Rest schon enriched)",
                        len(items_to_drill), len(all_items),
                    )

                if not items_to_drill:
                    log.info("Keine neuen Listings zu drillen — überspringe Detail-Phase.")
                else:
                    log.info(
                        "Detail-Drilling für %d Listings (rate-limit %ds) …",
                        len(items_to_drill), RATE_LIMIT_SECONDS,
                    )
                    detail_started = time.time()
                    ok = 0
                    for idx, item in enumerate(items_to_drill, start=1):
                        crawl_detail(browser, item)
                        if item.district or item.size_sqm:
                            ok += 1
                        if idx % 25 == 0:
                            log.info(
                                "  detail-progress %d/%d (ok %d, %.1fs)",
                                idx, len(items_to_drill), ok, time.time() - detail_started,
                            )
                        time.sleep(RATE_LIMIT_SECONDS)
                    log.info(
                        "Detail-Phase fertig: %d/%d enriched in %.1fs",
                        ok, len(items_to_drill), time.time() - detail_started,
                    )
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
