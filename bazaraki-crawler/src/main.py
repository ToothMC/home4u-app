"""Entry-Point: orchestriert robots.txt → Crawl pro (city, type, subtype) → Streaming-Upsert.

Streaming-Architektur (analog index-crawler/cre-crawler):

  Pro Subtype-Tupel: List → Drill (nur neue) → pHash (nur neue) → Upsert direkt.
  Keine "alles am Ende"-Phase mehr — bei Job-Timeout sind alle bis dahin
  abgearbeiteten Subtypes persistiert. Vorgängerversion verlor bei 5h50min-
  Timeout den kompletten Lauf, weil der Bulk-Upsert das letzte Statement war.

Watchdog: MAX_RUNTIME_S (default 4h) wird via `deadline_at` an alle inneren
Loops weitergereicht — List-Pagination, Drill und pHash brechen ab sobald die
Wall-Clock das Budget überschreitet, NICHT erst zwischen Subtypes. Ein einzelner
Subtype kann sonst 15-20min laufen und das Budget um Stunden sprengen, bevor
die äußere Schleife wieder ans Steuer kommt → GH-timeout-minutes killt SIGTERM
statt sauberem exit 0 → Run rot. Mit Inner-Loop-Watchdog: Abbruch innerhalb
weniger Sekunden, partielles Flush, exit 0 → Run grün (auch wenn ok=partial).

mark_stale läuft nur wenn ALLE Subtypes durch sind — ein abgebrochener Lauf
darf nicht 27k Listings als stale markieren, nur weil Famagusta nicht mehr
erreicht wurde.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from collections import defaultdict

from dotenv import load_dotenv

from .config import PROPERTY_SUBTYPES_BY_TYPE, RATE_LIMIT_SECONDS, env_int, selected_cities, selected_types
from .crawler import RawListing, crawl_city, crawl_detail, fetch_disallowed_paths, with_browser
from .supabase_writer import (
    fetch_already_drilled_external_ids,
    fetch_already_phashed_external_ids,
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

    skip_details = os.getenv("SKIP_DETAILS") == "1"
    force_full_drill = os.getenv("FORCE_FULL_DRILL") == "1"
    skip_phash = os.getenv("SKIP_PHASH") == "1"
    force_rephash = os.getenv("FORCE_REPHASH") == "1"
    dry_run = os.getenv("DRY_RUN") == "1"

    # Watchdog: stoppt vor dem nächsten Subtype, wenn Wall-Clock das Budget
    # überschreitet. Default 4h — gibt dem Workflow 240min Headroom unter dem
    # GH-Free-Cap (350) für sauberen exit 0.
    max_runtime_s = env_int("MAX_RUNTIME_S", 240 * 60)
    log.info("MAX_RUNTIME_S=%ds (~%.1fh)", max_runtime_s, max_runtime_s / 3600.0)

    # Sets einmal am Anfang ziehen — danach lokal mitführen, damit nachfolgende
    # Subtypes nicht doppelt drillen/hashen wenn ein Listing in mehreren City-
    # Subtype-Buckets auftaucht (passiert bei border-Locations selten, schadet
    # aber nicht).
    if skip_details or force_full_drill:
        drilled_ids: set[str] = set()
    else:
        log.info("Frage bereits gedrillte external_ids ab …")
        drilled_ids = fetch_already_drilled_external_ids()
        log.info("Schon gedrillt: %d", len(drilled_ids))

    if skip_phash or force_rephash:
        phashed_ids: set[str] = set()
    else:
        log.info("Frage bereits gehashte external_ids ab …")
        phashed_ids = fetch_already_phashed_external_ids()
        log.info("Schon gehasht: %d", len(phashed_ids))

    started = time.time()
    deadline_at = started + max_runtime_s
    grand_totals = {"inserted": 0, "updated": 0, "deduped": 0, "failed": 0, "subtypes": 0, "items": 0}
    per_city_counts: dict[tuple[str, str], int] = defaultdict(int)
    all_subtypes_done = True
    aborted_reason: str | None = None

    plan = [(c, t, s) for c in cities for t in types for s in PROPERTY_SUBTYPES_BY_TYPE[t]]
    log.info("Streaming-Plan: %d (city, type, subtype)-Tupel", len(plan))

    with with_browser() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for city, listing_type, subtype in plan:
                elapsed = time.time() - started
                if time.time() > deadline_at:
                    aborted_reason = (
                        f"MAX_RUNTIME_S={max_runtime_s}s erreicht nach {elapsed:.0f}s "
                        f"— sauberer Stopp vor {city.display}/{listing_type}/{subtype}"
                    )
                    log.warning(aborted_reason)
                    all_subtypes_done = False
                    break

                tag = f"{city.display}/{listing_type}/{subtype}"
                log.info("=== Subtype %s (elapsed %.0fs, budget left %.0fs) ===",
                         tag, elapsed, deadline_at - time.time())
                try:
                    items = list(crawl_city(browser, city, listing_type, subtype, disallowed,
                                            deadline_at=deadline_at))
                except Exception as e:
                    log.exception("List-Phase für %s gecrasht: %s — überspringe Subtype", tag, e)
                    all_subtypes_done = False
                    continue

                per_city_counts[(city.display, listing_type)] += len(items)
                grand_totals["items"] += len(items)
                if not items:
                    log.info("  %s: 0 items", tag)
                    grand_totals["subtypes"] += 1
                    # List-Phase brach möglicherweise wegen Budget ab — nicht weitermachen.
                    if time.time() > deadline_at:
                        aborted_reason = (
                            f"MAX_RUNTIME_S={max_runtime_s}s während List-Phase {tag}"
                        )
                        log.warning(aborted_reason)
                        all_subtypes_done = False
                        break
                    continue

                drill_aborted = False
                # Drill: nur neue (oder force_full_drill)
                if not skip_details:
                    if force_full_drill:
                        to_drill = items
                    else:
                        to_drill = [it for it in items if it.external_id not in drilled_ids]
                    if to_drill:
                        log.info("  drill: %d/%d neue (rate-limit %ds)", len(to_drill), len(items), RATE_LIMIT_SECONDS)
                        drill_started = time.time()
                        ok = 0
                        for idx, it in enumerate(to_drill, start=1):
                            if time.time() > deadline_at:
                                drill_aborted = True
                                aborted_reason = (
                                    f"MAX_RUNTIME_S={max_runtime_s}s während Drill {tag} "
                                    f"({idx - 1}/{len(to_drill)} drilled)"
                                )
                                log.warning("  drill: budget reached at %d/%d — break, flush partial",
                                            idx - 1, len(to_drill))
                                all_subtypes_done = False
                                break
                            try:
                                crawl_detail(browser, it)
                            except Exception as e:
                                log.warning("    drill-fail %s: %s", it.external_id, e)
                                continue
                            if it.district or it.size_sqm:
                                ok += 1
                            drilled_ids.add(it.external_id)
                            if idx % 25 == 0:
                                log.info(
                                    "    drill-progress %d/%d (ok %d, %.1fs)",
                                    idx, len(to_drill), ok, time.time() - drill_started,
                                )
                            time.sleep(RATE_LIMIT_SECONDS)
                        log.info("  drill: %d/%d enriched in %.1fs", ok, len(to_drill), time.time() - drill_started)

                # pHash: nur neue (oder force_rephash) — auch bei drill_aborted noch durchziehen
                # für die items die wir schon haben (cheap, nur HTTP-GET der Cover-URL).
                phash_aborted = False
                if not skip_phash and not drill_aborted:
                    from .dedup import compute_phash_from_url
                    if force_rephash:
                        phash_candidates = [it for it in items if it.cover_phash is None]
                    else:
                        phash_candidates = [
                            it for it in items
                            if it.cover_phash is None and it.external_id not in phashed_ids
                        ]
                    if phash_candidates:
                        phash_started = time.time()
                        phash_ok = 0
                        for it in phash_candidates:
                            if time.time() > deadline_at:
                                phash_aborted = True
                                aborted_reason = aborted_reason or (
                                    f"MAX_RUNTIME_S={max_runtime_s}s während pHash {tag}"
                                )
                                log.warning("    phash: budget reached — break")
                                all_subtypes_done = False
                                break
                            cover = (it.media[0] if it.media else it.image_url)
                            if not cover:
                                continue
                            try:
                                ph = compute_phash_from_url(cover)
                            except Exception as e:
                                log.warning("    phash-fail %s: %s", it.external_id, e)
                                continue
                            if ph is not None:
                                it.cover_phash = ph
                                phashed_ids.add(it.external_id)
                                phash_ok += 1
                        log.info(
                            "  phash: %d/%d in %.1fs",
                            phash_ok, len(phash_candidates), time.time() - phash_started,
                        )

                # Streaming-Upsert: dieses Subtype sofort persistieren — auch bei
                # drill_aborted/phash_aborted, damit die bereits angereicherten
                # Items nicht verloren gehen. Nicht-gedrillte Items werden mit
                # ihren List-Page-Feldern upgeserted; die DB-RPC merged via COALESCE.
                if dry_run:
                    log.info("  DRY_RUN — kein Upsert (sample %s)", items[0].external_id)
                else:
                    try:
                        result = upsert_listings(items)
                        grand_totals["inserted"] += int(result.get("inserted", 0))
                        grand_totals["updated"] += int(result.get("updated", 0))
                        grand_totals["deduped"] += int(result.get("deduped", 0))
                        grand_totals["failed"] += len(result.get("failed", []) or [])
                        log.info(
                            "  flush: ins=%d upd=%d dedup=%d fail=%d (cum %d/%d/%d/%d)",
                            result.get("inserted", 0), result.get("updated", 0),
                            result.get("deduped", 0), len(result.get("failed", []) or []),
                            grand_totals["inserted"], grand_totals["updated"],
                            grand_totals["deduped"], grand_totals["failed"],
                        )
                    except Exception as e:
                        log.exception("Upsert für %s gecrasht: %s", tag, e)
                        all_subtypes_done = False
                        continue

                grand_totals["subtypes"] += 1

                # Wenn drill/phash wegen Budget abgebrochen sind, partielles Flush
                # ist passiert — jetzt sauber raus aus der Plan-Schleife, nicht
                # noch einen Subtype anfangen.
                if drill_aborted or phash_aborted:
                    break
        finally:
            browser.close()

    log.info("Crawl-Ende: %d items in %.1fs (subtypes %d/%d)",
             grand_totals["items"], time.time() - started,
             grand_totals["subtypes"], len(plan))
    for (city, t), n in sorted(per_city_counts.items()):
        log.info("  %s/%s: %d", city, t, n)

    # mark_stale nur bei vollständigem Lauf — sonst markieren wir Cities als
    # stale, die im aktuellen Run nie erreicht wurden (Watchdog-Stop, Crash).
    if dry_run:
        log.info("DRY_RUN — kein mark_stale.")
    elif all_subtypes_done:
        log.info("Mark stale (>3d unseen) …")
        stale = mark_stale_old_listings(stale_days=3)
        log.info("Stale-marked: %d", stale)
    else:
        log.warning(
            "mark_stale übersprungen — Lauf nicht vollständig (%s)",
            aborted_reason or "siehe Subtype-Errors oben",
        )

    log.info(
        "RESULT: ok=%s items=%d inserted=%d updated=%d deduped=%d failed=%d subtypes=%d/%d aborted=%s",
        "true" if all_subtypes_done else "partial",
        grand_totals["items"], grand_totals["inserted"], grand_totals["updated"],
        grand_totals["deduped"], grand_totals["failed"],
        grand_totals["subtypes"], len(plan),
        aborted_reason or "",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
