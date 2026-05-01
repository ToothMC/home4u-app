"""INDEX.cy-Crawler Entry-Point.

Flow:
  1. Sitemap-Discovery: alle aktiven Listing-URLs aus 20+ Sub-Sitemaps
  2. Inkrementell: bereits in DB indexierte external_ids ausfiltern
  3. Detail-Fetch + Parse + pHash + Streaming-Upsert pro BATCH_SIZE Listings
  4. mark_stale am Ende — nur wenn vollständig durchgelaufen

Watchdog (MAX_RUNTIME_S, default 90min): stoppt vor dem nächsten Listing,
sobald die Wall-Clock das Budget reißt. Workflow-timeout sollte +10min
Headroom bieten, dann liefert Python sauber exit 0 statt SIGTERM. Vorteil:
mehrere kürzere Runs pro Tag (cron alle paar Stunden) decken den Backfill
inkrementell ab — jeder Run grün, Daten landen, kein 5h-Job-der-cancelled-wird.

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: Pflicht
  RATE_LIMIT_S: Sekunden Pause pro Detail-Fetch (default 1.0)
  MAX_LISTINGS: Cap für Smoke-Tests (default 0 = unbegrenzt)
  MAX_RUNTIME_S: Wall-Clock-Budget bevor sauberer Stopp (default 5400 = 90min)
  STREAM_BATCH_SIZE: Batch-Size für Streaming-Upsert (default 50)
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
    # Watchdog: sauberer Stopp vor Wall-Clock-Cap. Workflow setzt timeout-
    # minutes auf MAX_RUNTIME_S/60 + ~10 für SIGTERM-freien exit 0.
    max_runtime_s = int(os.getenv("MAX_RUNTIME_S", "5400").strip() or "5400")

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

        # Phase 3: Detail-Fetch + Parse + pHash + Upsert STREAMING.
        # Wichtig: kein "alles parsen, dann hochladen" — bei 41k Listings
        # rennt der Workflow ins 350-min-Timeout bevor der finale Upsert kommt
        # und ALLES Geparste geht verloren. Stattdessen: alle BATCH_SIZE
        # parsed Listings sofort pHashen + upserten, dann Speicher freigeben.
        # Bei Timeout sind alle bis dahin geflushten Batches in der DB.
        BATCH_SIZE = int(os.getenv("STREAM_BATCH_SIZE", "50").strip() or "50")
        log.info(
            "Phase 2: detail-fetch + streaming-upsert (rate-limit %.1fs, batch %d, watchdog %ds) …",
            rate_limit, BATCH_SIZE, max_runtime_s,
        )
        detail_started = time.time()
        batch: list[ParsedListing] = []
        total_parsed = 0
        total_inserted = 0
        total_updated = 0
        total_deduped = 0
        total_failed = 0
        aborted_reason: str | None = None
        all_done = True

        def flush_batch() -> None:
            nonlocal batch, total_inserted, total_updated, total_deduped, total_failed
            if not batch:
                return
            if not skip_phash:
                phash_ok = 0
                for it in batch:
                    cover = it.media[0] if it.media else None
                    if not cover:
                        continue
                    ph = compute_phash_from_url(cover)
                    if ph is not None:
                        it.cover_phash = ph
                        phash_ok += 1
                log.info("  phash: %d/%d in batch", phash_ok, len(batch))
            if dry_run:
                log.info("  DRY_RUN — skip upsert (sample %s)",
                         batch[0].listing_id if batch else "")
            else:
                result = upsert_listings(batch)
                total_inserted += int(result.get("inserted", 0))
                total_updated += int(result.get("updated", 0))
                total_deduped += int(result.get("deduped", 0))
                total_failed += len(result.get("failed", []) or [])
                log.info(
                    "  flush: ins=%d upd=%d dedup=%d fail=%d (cumulative %d/%d/%d/%d)",
                    result.get("inserted", 0), result.get("updated", 0),
                    result.get("deduped", 0), len(result.get("failed", []) or []),
                    total_inserted, total_updated, total_deduped, total_failed,
                )
            batch = []

        for idx, sitemap_listing in enumerate(todo, start=1):
            elapsed = time.time() - started
            if elapsed > max_runtime_s:
                aborted_reason = (
                    f"MAX_RUNTIME_S={max_runtime_s}s erreicht nach {elapsed:.0f}s "
                    f"— sauberer Stopp bei Listing {idx}/{len(todo)}"
                )
                log.warning(aborted_reason)
                all_done = False
                break
            p = fetch_and_parse(client, sitemap_listing)
            if p is not None:
                batch.append(p)
                total_parsed += 1
            if len(batch) >= BATCH_SIZE:
                flush_batch()
            if idx % 50 == 0:
                log.info(
                    "  detail-progress %d/%d (parsed %d, %.1fs)",
                    idx, len(todo), total_parsed, time.time() - detail_started,
                )
            time.sleep(rate_limit)

        # Final flush für den Rest (auch bei Watchdog-Stopp — Batch persistieren)
        flush_batch()
        log.info(
            "Detail+Upsert-Phase fertig: %d parsed, %d inserted, %d updated, "
            "%d deduped, %d failed in %.1fs",
            total_parsed, total_inserted, total_updated, total_deduped,
            total_failed, time.time() - detail_started,
        )

    # mark_stale nur wenn ALLE todo-Listings erreicht — sonst markieren wir
    # Listings als stale, die der nächste Run noch nicht abarbeiten konnte.
    if dry_run:
        log.info("DRY_RUN — kein mark_stale.")
    elif all_done:
        log.info("Mark stale (>3d unseen) …")
        stale = mark_stale_old_listings(stale_days=3)
        log.info("Stale-marked: %d", stale)
    else:
        log.warning("mark_stale übersprungen — Lauf nicht vollständig (%s)", aborted_reason or "siehe Errors")

    log.info(
        "RESULT: ok=%s parsed=%d inserted=%d updated=%d deduped=%d failed=%d elapsed=%.1fs aborted=%s",
        "true" if all_done else "partial",
        total_parsed, total_inserted, total_updated, total_deduped, total_failed,
        time.time() - started,
        aborted_reason or "",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
