"""BSC-Crawler Entry-Point.

Flow:
  1. Sitemap-Discovery: alle 10 sub-sitemaps walken → ID-eindeutige Detail-URLs
     (~160k inkl. Archive bei BSC)
  2. Inkrementell: schon-indexierte external_ids ausfiltern, last_seen touchen
  3. Streaming-Detail-Fetch + Parse + pHash + Upsert pro BATCH_SIZE
  4. mark_stale am Ende — nur wenn vollständig durchgelaufen

Watchdog (MAX_RUNTIME_S, default 90min): stoppt vor dem nächsten Listing,
sobald die Wall-Clock das Budget reißt. Workflow-timeout +10min Headroom.

BSC-Spezifika:
- curl_cffi mit Chrome120-TLS-Fingerprint umgeht Cloudflare Managed Challenge
- Sitemap-`.xml.gz` ist eine Anti-Scraper-Falle (10-Byte-Stub), nur `.xml` nutzen
- Detail-Page-Aktiv-Filter: Title ohne €-Preis = archived → skip
- Rate-Limit: 1.0s default, konservativer als andere Sources weil CF mitliest

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: Pflicht
  RATE_LIMIT_S: Pause pro Detail-Fetch (default 1.0)
  MAX_LISTINGS: Cap für Smoke-Tests (default 0 = unbegrenzt)
  MAX_RUNTIME_S: Wall-Clock-Budget bevor sauberer Stopp (default 5400 = 90min)
  STREAM_BATCH_SIZE: Batch-Size für Streaming-Upsert (default 50)
  DRY_RUN=1: kein DB-Write, nur loggen
  SKIP_PHASH=1: pHash-Phase überspringen
  FORCE_REFETCH=1: auch bereits indexierte Listings nochmal fetchen
"""
from __future__ import annotations

import logging
import os
import sys
import time

import httpx
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential

from .dedup import compute_phash_from_url
from .detail import ParsedListing, parse_detail
from .http_client import BscSession
from .sitemap import ListingURL, discover_all_listings
from .writer import (
    fetch_already_indexed,
    touch_last_seen,
    upsert_listings,
)

SOURCE = "bsc"


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _mark_stale_rpc() -> int:
    """Stale-Markierung verwendet dieselbe RPC wie alle anderen Sources.
    Schwelle 14d, der Sweep-Gate prüft selbst ob der Crawler frisch genug
    war (mind. 5000 Listings in 24h gesehen)."""
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/mark_stale_listings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    resp = httpx.post(
        url,
        headers=headers,
        json={"p_stale_days": 14, "p_source": SOURCE, "p_min_recent_seen": 1000},
        timeout=20,
    )
    if resp.status_code == 404:
        return 0
    resp.raise_for_status()
    return int(resp.json() or 0)


def main() -> int:
    load_dotenv()
    _setup_logging()
    log = logging.getLogger("bsc-crawler")

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein")
        return 1

    rate_limit = float(os.getenv("RATE_LIMIT_S", "1.0").replace(",", "."))
    max_listings = int(os.getenv("MAX_LISTINGS", "0").strip() or "0") or None
    dry_run = os.getenv("DRY_RUN") == "1"
    skip_phash = os.getenv("SKIP_PHASH") == "1"
    force_refetch = os.getenv("FORCE_REFETCH") == "1"
    max_runtime_s = int(os.getenv("MAX_RUNTIME_S", "5400").strip() or "5400")

    started = time.time()
    session = BscSession()

    # Phase 1: Sitemap-Discovery
    log.info("Phase 1: sitemap-discovery …")
    all_urls = discover_all_listings(session)
    log.info("Discovery fertig: %d unique listings", len(all_urls))
    if not all_urls:
        log.warning("0 Listings discovered — Abbruch")
        return 0

    # Phase 2: inkrementell — schon indexierte ausfiltern
    already_seen_ids: list[str] = []
    if force_refetch:
        log.info("FORCE_REFETCH=1 — alle %d Listings werden gefetched", len(all_urls))
        todo: list[ListingURL] = all_urls
    else:
        log.info("Lade Set bereits indexierter external_ids …")
        try:
            indexed = fetch_already_indexed()
            log.info("Schon indexiert: %d", len(indexed))
        except Exception as e:
            log.warning("fetch_already_indexed failed: %s — fallback full", e)
            indexed = set()
        todo = [u for u in all_urls if u.listing_id not in indexed]
        already_seen_ids = [u.listing_id for u in all_urls if u.listing_id in indexed]
        log.info("Neu zu fetchen: %d von %d", len(todo), len(all_urls))

    # last_seen für bekannte URLs touchen — sonst rostet das ein und der
    # mark_stale-Gate würde alle archivieren
    if already_seen_ids and not dry_run:
        touched = touch_last_seen(already_seen_ids)
        log.info("  %d/%d known URLs touched (last_seen refreshed)",
                 touched, len(already_seen_ids))

    if max_listings:
        todo = todo[:max_listings]
        log.info("MAX_LISTINGS=%d aktiv → %d zu fetchen", max_listings, len(todo))

    if not todo:
        log.info("Nichts zu tun — alle bekannten Listings schon indexiert.")
        return 0

    # Phase 3: Detail-Fetch + Parse + pHash + Streaming-Upsert
    BATCH_SIZE = int(os.getenv("STREAM_BATCH_SIZE", "50").strip() or "50")
    log.info(
        "Phase 2: detail-fetch + streaming-upsert (rate %.1fs, batch %d, watchdog %ds) …",
        rate_limit, BATCH_SIZE, max_runtime_s,
    )
    detail_started = time.time()
    batch: list[ParsedListing] = []
    total_parsed = 0
    total_skipped_archived = 0
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
        p = parse_detail(session, sitemap_listing)
        if p is not None:
            batch.append(p)
            total_parsed += 1
        else:
            total_skipped_archived += 1
        if len(batch) >= BATCH_SIZE:
            flush_batch()
        if idx % 50 == 0:
            log.info(
                "  detail-progress %d/%d (parsed %d, archived/skip %d, %.1fs)",
                idx, len(todo), total_parsed, total_skipped_archived,
                time.time() - detail_started,
            )
        time.sleep(rate_limit)

    flush_batch()
    log.info(
        "Detail+Upsert-Phase fertig: %d parsed, %d archived/skip, %d ins, %d upd, "
        "%d dedup, %d failed in %.1fs",
        total_parsed, total_skipped_archived, total_inserted, total_updated,
        total_deduped, total_failed, time.time() - detail_started,
    )

    # mark_stale nur wenn vollständig
    if dry_run:
        log.info("DRY_RUN — kein mark_stale.")
    elif all_done:
        log.info("Mark stale (>14d unseen, min_recent_seen=1000) …")
        try:
            stale = _mark_stale_rpc()
            log.info("Stale-marked: %d", stale)
        except Exception as e:
            log.warning("mark_stale fehlgeschlagen (RPC-Gate?): %s", e)
    else:
        log.warning("mark_stale übersprungen — Lauf nicht vollständig (%s)",
                    aborted_reason or "siehe Errors")

    log.info(
        "RESULT: ok=%s parsed=%d archived=%d inserted=%d updated=%d deduped=%d failed=%d elapsed=%.1fs aborted=%s",
        "true" if all_done else "partial",
        total_parsed, total_skipped_archived, total_inserted, total_updated,
        total_deduped, total_failed, time.time() - started,
        aborted_reason or "",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
