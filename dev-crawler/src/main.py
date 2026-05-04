"""dev-crawler Entry-Point: orchestriert alle CY-Bauträger-Crawler.

Pro Developer: discover() → filter (schon indexiert) → streaming-fetch +
parse + (pHash) + upsert. Watchdog stoppt sauber vor dem nächsten Listing
sobald MAX_RUNTIME_S erreicht ist. Identische Architektur wie cre-crawler /
index-crawler — Streaming heißt: bei Job-Timeout sind alle bis dahin
geflushten Batches in der DB.

DEVELOPERS-Liste in DEVELOPER_MODULES wird sequenziell abgearbeitet. Per env
DEVELOPERS=aristo,leptos limitiert man auf eine Auswahl (für Smoke-Tests).

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: Pflicht
  RATE_LIMIT_S: Sekunden Pause pro Detail-Fetch (default 1.0)
  MAX_LISTINGS: Cap pro Developer (default 0 = unbegrenzt)
  MAX_RUNTIME_S: Wall-Clock-Budget bevor sauberer Stopp (default 5400 = 90min)
  STREAM_BATCH_SIZE: Batch-Size für Streaming-Upsert (default 50)
  DEVELOPERS: kommagetrennte Auswahl (default = alle implementierten)
  DRY_RUN=1: kein DB-Write, nur loggen
  SKIP_PHASH=1: pHash-Phase überspringen
  FORCE_REFETCH=1: auch bekannte Listings nochmal fetchen
"""
from __future__ import annotations

import logging
import os
import sys
import time
from typing import Callable

import httpx
from dotenv import load_dotenv

from . import aristo, imperio, korantina, leptos, pafilia
from .base import ParsedListing
from .dedup import compute_phash_from_url
from .writer import fetch_already_indexed, mark_stale_old_listings, upsert_listings


# 5 CY-Bauträger live. Cybarco rausgenommen — WAF blockt GH-Action-IPs (Sitemap
# 403, Project-Pages 403). Lokal mit Wohn-IP würde laufen, aber für ~15
# Luxus-Limassol-Projekte lohnt sich kein Residential-Proxy.
DEVELOPER_MODULES: list = [
    aristo,
    pafilia,
    leptos,
    korantina,
    imperio,
]


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def _select_developers(env_value: str | None) -> list:
    if not env_value or not env_value.strip():
        return DEVELOPER_MODULES
    wanted = {s.strip().lower() for s in env_value.split(",") if s.strip()}
    return [m for m in DEVELOPER_MODULES if m.DEVELOPER in wanted]


def main() -> int:
    load_dotenv()
    _setup_logging()
    log = logging.getLogger("dev-crawler")

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein")
        return 1

    rate_limit = float(os.getenv("RATE_LIMIT_S", "1.0").replace(",", "."))
    max_listings = int(os.getenv("MAX_LISTINGS", "0").strip() or "0") or None
    max_runtime_s = int(os.getenv("MAX_RUNTIME_S", "5400").strip() or "5400")
    batch_size = int(os.getenv("STREAM_BATCH_SIZE", "50").strip() or "50")
    dry_run = os.getenv("DRY_RUN") == "1"
    skip_phash = os.getenv("SKIP_PHASH") == "1"
    force_refetch = os.getenv("FORCE_REFETCH") == "1"
    selected = _select_developers(os.getenv("DEVELOPERS"))

    log.info(
        "dev-crawler start: developers=%s, rate_limit=%.1fs, max_runtime=%ds, batch=%d, dry_run=%s",
        [m.DEVELOPER for m in selected], rate_limit, max_runtime_s, batch_size, dry_run,
    )

    started = time.time()
    grand = {"developers": 0, "discovered": 0, "parsed": 0,
             "inserted": 0, "updated": 0, "deduped": 0, "failed": 0}
    all_done = True
    aborted_reason: str | None = None

    headers = {
        "User-Agent": "Home4U-Aggregator/0.1 (+https://home4u.ai/about)",
        "Accept-Language": "en-US,en;q=0.9",
    }

    with httpx.Client(headers=headers, follow_redirects=True) as client:
        for module in selected:
            elapsed = time.time() - started
            if elapsed > max_runtime_s:
                aborted_reason = (
                    f"MAX_RUNTIME_S={max_runtime_s}s erreicht nach {elapsed:.0f}s "
                    f"— sauberer Stopp vor Developer {module.DEVELOPER}"
                )
                log.warning(aborted_reason)
                all_done = False
                break

            developer = module.DEVELOPER
            log.info("=== Developer %s (elapsed %.0fs) ===", developer, elapsed)

            try:
                all_urls = list(module.discover(client))
            except Exception as e:
                log.exception("discover(%s) gecrasht: %s", developer, e)
                all_done = False
                continue

            if not all_urls:
                log.info("  %s: 0 URLs (Stub oder leer)", developer)
                continue

            log.info("  %s: %d URLs discovered", developer, len(all_urls))
            grand["discovered"] += len(all_urls)

            if force_refetch:
                todo = all_urls
            else:
                indexed = fetch_already_indexed(developer)
                # listing_id (= URL-Slug) wird per Modul gemacht; wir matchen
                # über die letzte Path-Komponente der URL
                todo = [u for u in all_urls if u.rstrip("/").rsplit("/", 1)[-1] not in indexed]
                log.info("  %s: %d schon indexiert, %d neu zu fetchen",
                         developer, len(indexed), len(todo))

            if max_listings:
                todo = todo[:max_listings]

            if not todo:
                log.info("  %s: nichts Neues", developer)
                grand["developers"] += 1
                continue

            batch: list[ParsedListing] = []
            dev_inserted = dev_updated = dev_deduped = dev_failed = 0
            dev_parsed = 0

            def flush() -> None:
                nonlocal dev_inserted, dev_updated, dev_deduped, dev_failed
                if not batch:
                    return
                if not skip_phash:
                    for it in batch:
                        if it.cover_phash is not None:
                            continue
                        cover = it.media[0] if it.media else None
                        if not cover:
                            continue
                        try:
                            ph = compute_phash_from_url(cover)
                        except Exception:
                            ph = None
                        if ph is not None:
                            it.cover_phash = ph
                if dry_run:
                    log.info("  DRY_RUN — skip upsert (%d items, sample %s)",
                             len(batch), batch[0].listing_id)
                else:
                    result = upsert_listings(batch, developer)
                    dev_inserted += int(result.get("inserted", 0))
                    dev_updated += int(result.get("updated", 0))
                    dev_deduped += int(result.get("deduped", 0))
                    dev_failed += len(result.get("failed", []) or [])
                    log.info(
                        "  flush(%s): ins=%d upd=%d dedup=%d fail=%d",
                        developer,
                        result.get("inserted", 0), result.get("updated", 0),
                        result.get("deduped", 0), len(result.get("failed", []) or []),
                    )
                batch.clear()

            # Per-Module Rate-Limit-Override — Cybarco hat robots.txt Crawl-delay 10s.
            # Default: globaler RATE_LIMIT_S aus env.
            mod_rate_limit = float(getattr(module, "RATE_LIMIT_S", rate_limit))
            if mod_rate_limit != rate_limit:
                log.info("  %s: rate_limit override %.1fs (default %.1fs)",
                         developer, mod_rate_limit, rate_limit)

            for idx, url in enumerate(todo, start=1):
                # Watchdog auch innerhalb eines Developers — stoppt mid-Liste sauber
                if time.time() - started > max_runtime_s:
                    aborted_reason = (
                        f"MAX_RUNTIME_S={max_runtime_s}s erreicht "
                        f"— Stopp bei {developer} {idx}/{len(todo)}"
                    )
                    log.warning(aborted_reason)
                    all_done = False
                    break
                try:
                    p = module.parse(client, url)
                except Exception as e:
                    log.warning("parse fail %s: %s", url, e)
                    p = None
                if p is not None:
                    batch.append(p)
                    dev_parsed += 1
                if len(batch) >= batch_size:
                    flush()
                if idx % 50 == 0:
                    log.info("  %s detail-progress %d/%d (parsed %d)",
                             developer, idx, len(todo), dev_parsed)
                time.sleep(mod_rate_limit)

            flush()
            log.info(
                "  %s done: parsed=%d inserted=%d updated=%d deduped=%d failed=%d",
                developer, dev_parsed, dev_inserted, dev_updated, dev_deduped, dev_failed,
            )
            grand["parsed"] += dev_parsed
            grand["inserted"] += dev_inserted
            grand["updated"] += dev_updated
            grand["deduped"] += dev_deduped
            grand["failed"] += dev_failed
            grand["developers"] += 1

            if not all_done:
                break  # äußere Watchdog-Schleife sauber verlassen

    if dry_run:
        log.info("DRY_RUN — kein mark_stale.")
    elif all_done:
        # Pro Developer separat stale-markieren — sonst markiert ein
        # einzelner partial Lauf nicht alle Developer als unseen.
        for module in selected:
            try:
                stale = mark_stale_old_listings(module.DEVELOPER, stale_days=7)
                if stale:
                    log.info("mark_stale(%s): %d", module.DEVELOPER, stale)
            except Exception as e:
                log.warning("mark_stale(%s) failed: %s", module.DEVELOPER, e)
    else:
        log.warning("mark_stale übersprungen — Lauf nicht vollständig (%s)",
                    aborted_reason or "siehe Errors")

    log.info(
        "RESULT: ok=%s developers=%d discovered=%d parsed=%d "
        "inserted=%d updated=%d deduped=%d failed=%d elapsed=%.1fs aborted=%s",
        "true" if all_done else "partial",
        grand["developers"], grand["discovered"], grand["parsed"],
        grand["inserted"], grand["updated"], grand["deduped"], grand["failed"],
        time.time() - started,
        aborted_reason or "",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
