"""BSC-Crawler Entry-Point.

Flow:
  1. Sitemap-Discovery: alle 10 sub-sitemaps walken → ID-eindeutige Detail-URLs
     (~160k inkl. Archive bei BSC)
  2. Inkrementell: bekannte external_ids paketweise nachschlagen (RPC)
  3. Streaming-Detail-Fetch + Parse + pHash + Upsert pro BATCH_SIZE —
     erst neue Inserate, dann eine Scheibe bekannter zur Nachprüfung
     (Recheck): aktiv → Upsert frischt last_seen auf, archiviert →
     direkt stale. BSC lässt archivierte Inserate in der Sitemap, daher ist
     nur die Detailseite ein verlässliches Lebenszeichen.
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
  RECHECK_PER_RUN: bekannte Inserate pro Lauf nachprüfen (default 3500,
    0 = aus). Scheibe = GITHUB_RUN_NUMBER % Anzahl Scheiben → bei ~115k
    bekannten und 4 Läufen/Tag kommt jedes Inserat ~alle 8 Tage dran,
    sicher innerhalb des 14-Tage-Cutoffs von mark_stale.
"""
from __future__ import annotations

import logging
import math
import os
import sys
import time

import httpx
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential

from .dedup import compute_phash_from_url
from .detail import STATUS_ACTIVE, STATUS_ARCHIVED, ParsedListing, check_detail
from .http_client import BscSession
from .sitemap import ListingURL, discover_all_listings
from .writer import (
    lookup_known_ids,
    mark_stale_ids,
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


def _recheck_slice(known_ids: set[str], per_run: int) -> tuple[list[str], int, int]:
    """Deterministische Scheibe der bekannten IDs für diesen Lauf.

    Ohne Zustand in der DB: Scheibe = GITHUB_RUN_NUMBER % n. Jeder Lauf nimmt
    die nächste Scheibe, nach n Läufen ist jedes Inserat einmal geprüft.
    Lokal (ohne Run-Nummer) fällt es auf die 6-h-Uhrzeit-Scheibe zurück.
    """
    if per_run <= 0 or not known_ids:
        return [], 0, 0
    ids = sorted(known_ids)
    n = max(1, math.ceil(len(ids) / per_run))
    run_no = os.getenv("GITHUB_RUN_NUMBER", "").strip()
    seed = int(run_no) if run_no.isdigit() else int(time.time() // (6 * 3600))
    slot = seed % n
    return [lid for k, lid in enumerate(ids) if k % n == slot], slot, n


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
        # Gleiche Falle wie bei cre 2026-07-27 bis 2026-09-07 (Sitemaps
        # umbenannt, CI blieb 6 Wochen grün). Hier kommt die Sitemap-Liste
        # zwar hart kodiert aus sitemap.py, aber eine Cloudflare-Blockade
        # oder ein Format-Wechsel sieht identisch aus: 0 URLs. Bei >0 vorher
        # indexierten Listings ist das ein Fehler — CI muss das rot zeigen.
        log.error("0 Listings discovered — Abbruch (Sitemaps weg oder geblockt?)")
        return 1

    # Phase 2: inkrementell — bekannte IDs paketweise nachschlagen
    by_id: dict[str, ListingURL] = {u.listing_id: u for u in all_urls}
    recheck: list[ListingURL] = []
    if force_refetch:
        log.info("FORCE_REFETCH=1 — alle %d Listings werden gefetched", len(all_urls))
        todo: list[ListingURL] = all_urls
    else:
        log.info("Bekannte external_ids nachschlagen (Pakete à 1000) …")
        t_lookup = time.time()
        known, unresolved = lookup_known_ids(list(by_id))
        log.info("  bekannt: %d, neu: %d, ungeklärt: %d (%.1fs)",
                 len(known), len(by_id) - len(known) - len(unresolved),
                 len(unresolved), time.time() - t_lookup)
        if unresolved and len(unresolved) > len(by_id) // 2:
            # Mehr als die Hälfte nicht nachschlagbar = DB-Problem, kein
            # Grund, zehntausende Detailseiten blind neu zu holen.
            log.error("Nachschlagen für %d von %d IDs fehlgeschlagen — Abbruch",
                      len(unresolved), len(by_id))
            return 1
        todo = [u for u in all_urls
                if u.listing_id not in known and u.listing_id not in unresolved]
        recheck_per_run = int(os.getenv("RECHECK_PER_RUN", "3500").strip() or "0")
        slice_ids, slot, n_slices = _recheck_slice(known, recheck_per_run)
        recheck = [by_id[i] for i in slice_ids]
        log.info("Neu zu fetchen: %d von %d; Recheck: %d (Scheibe %d/%d)",
                 len(todo), len(all_urls), len(recheck), slot + 1, n_slices)

    if max_listings:
        todo = todo[:max_listings]
        recheck = recheck[:max_listings]
        log.info("MAX_LISTINGS=%d aktiv → %d neu, %d Recheck", max_listings, len(todo), len(recheck))

    if not todo and not recheck:
        log.info("Nichts zu tun.")
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
    total_errors = 0
    recheck_active = recheck_archived = recheck_errors = 0
    total_marked_stale = 0
    archived_known: list[str] = []
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

    def flush_archived() -> None:
        nonlocal archived_known, total_marked_stale
        if not archived_known:
            return
        if dry_run:
            log.info("  DRY_RUN — %d verifiziert archivierte NICHT stale gesetzt", len(archived_known))
        else:
            try:
                n = mark_stale_ids(archived_known)
                total_marked_stale += n
                log.info("  stale gesetzt (Detailseite archiviert): %d", n)
            except Exception as e:
                log.warning("mark_stale_ids(%d) fehlgeschlagen: %s", len(archived_known), e)
        archived_known = []

    work: list[tuple[ListingURL, bool]] = [(u, False) for u in todo] + [(u, True) for u in recheck]
    for idx, (sitemap_listing, is_recheck) in enumerate(work, start=1):
        elapsed = time.time() - started
        if elapsed > max_runtime_s:
            aborted_reason = (
                f"MAX_RUNTIME_S={max_runtime_s}s erreicht nach {elapsed:.0f}s "
                f"— sauberer Stopp bei Listing {idx}/{len(work)}"
            )
            log.warning(aborted_reason)
            all_done = False
            break
        status, p = check_detail(session, sitemap_listing)
        if status == STATUS_ACTIVE and p is not None:
            # Upsert frischt last_seen auf (und reaktiviert ggf. stale).
            batch.append(p)
            total_parsed += 1
            if is_recheck:
                recheck_active += 1
        elif status == STATUS_ARCHIVED:
            total_skipped_archived += 1
            if is_recheck:
                recheck_archived += 1
                archived_known.append(sitemap_listing.listing_id)
        else:
            total_errors += 1
            if is_recheck:
                recheck_errors += 1
        if len(batch) >= BATCH_SIZE:
            flush_batch()
        if len(archived_known) >= 200:
            flush_archived()
        if idx % 50 == 0:
            log.info(
                "  detail-progress %d/%d (parsed %d, archived %d, errors %d, %.1fs)",
                idx, len(work), total_parsed, total_skipped_archived, total_errors,
                time.time() - detail_started,
            )
        time.sleep(rate_limit)

    flush_batch()
    flush_archived()
    log.info(
        "Recheck: %d aktiv (last_seen frisch), %d archiviert (davon %d stale gesetzt), %d Fehler",
        recheck_active, recheck_archived, total_marked_stale, recheck_errors,
    )
    if recheck_errors and recheck_errors > (recheck_active + recheck_archived):
        log.warning("Recheck: mehr Fehler als Ergebnisse — Cloudflare/Netz prüfen")
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
