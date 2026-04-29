"""One-shot Backfill: cover_phash + canonical-Merge für bestehende
Bazaraki-Listings.

Für jedes aktive Bazaraki-Listing OHNE Eintrag in image_hashes:
  1. Cover-URL aus media[0] holen
  2. pHash berechnen (compute_phash_from_url)
  3. image_hashes-Row schreiben
  4. find_canonical_for_signals callen (excluding self)
  5. Wenn Match: canonical_id setzen

Idempotent: kann beliebig oft laufen, überspringt Listings die bereits
ein image_hashes-Eintrag haben.

Concurrency: synchron mit kleinem Sleep — wir wollen Bazaraki nicht
beleidigen mit 27k parallel Requests. ~0.5s pro Listing × 27k = ~3-4h
Laufzeit. Reichen 6h GitHub-Actions-Limit komfortabel.

Usage:
  BACKFILL_LIMIT=200 python -m src.backfill_phash      # Test mit 200
  python -m src.backfill_phash                          # Voller Lauf
"""
from __future__ import annotations

import logging
import os
import sys
import time

import httpx
from dotenv import load_dotenv

from .dedup import compute_phash_from_url

log = logging.getLogger(__name__)

PAGE_SIZE = 200
RATE_LIMIT = float(os.getenv("BACKFILL_RATE_LIMIT_S", "0.3"))


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def fetch_pending_listings(client: httpx.Client, headers: dict, offset: int) -> list[dict]:
    """Listings die noch keinen image_hashes-Eintrag haben + ein Cover haben."""
    # PostgREST-Filter: media nicht leer + nicht in image_hashes (via RPC oder Subquery).
    # Einfachste Lösung: alle aktiven Bazaraki holen, client-side filtern was schon
    # gehasht ist. Für 27k OK.
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    url = (
        f"{url_base}/rest/v1/listings"
        f"?source=eq.bazaraki&status=eq.active"
        f"&select=id,price,location_city,type,property_type,rooms,size_sqm,media,canonical_id"
        f"&order=updated_at.desc"
    )
    resp = client.get(
        url,
        headers={
            **headers,
            "Range-Unit": "items",
            "Range": f"{offset}-{offset + PAGE_SIZE - 1}",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json() or []


def fetch_already_hashed(client: httpx.Client, headers: dict) -> set[str]:
    """Set aller listing_ids die bereits image_hashes haben."""
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    hashed: set[str] = set()
    offset = 0
    page = 1000
    while True:
        url = f"{url_base}/rest/v1/image_hashes?select=listing_id"
        resp = client.get(
            url,
            headers={
                **headers,
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page - 1}",
            },
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json() or []
        for r in rows:
            lid = r.get("listing_id")
            if lid:
                hashed.add(str(lid))
        if len(rows) < page:
            break
        offset += page
    return hashed


def write_image_hash(
    client: httpx.Client, headers: dict, listing_id: str, phash: int, media_url: str | None
) -> bool:
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    url = f"{url_base}/rest/v1/image_hashes"
    payload = {"listing_id": listing_id, "phash": phash, "media_url": media_url}
    resp = client.post(
        url,
        headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=payload,
        timeout=15,
    )
    if resp.status_code >= 400:
        log.warning("write_image_hash failed listing=%s: %d %s", listing_id, resp.status_code, resp.text[:200])
        return False
    return True


def find_canonical(
    client: httpx.Client, headers: dict, listing: dict, phash: int
) -> str | None:
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    url = f"{url_base}/rest/v1/rpc/find_canonical_for_signals"
    payload = {
        "p_phash": phash,
        "p_phone_hash": None,
        "p_price": float(listing["price"]) if listing.get("price") is not None else None,
        "p_city": listing.get("location_city"),
        "p_type": listing.get("type"),
        "p_property_type": listing.get("property_type"),
        "p_rooms": listing.get("rooms"),
        "p_size_sqm": listing.get("size_sqm"),
        "p_exclude_id": listing["id"],
    }
    resp = client.post(
        url,
        headers={**headers, "Content-Type": "application/json"},
        json=payload,
        timeout=20,
    )
    if resp.status_code >= 400:
        log.warning("find_canonical failed listing=%s: %d %s", listing["id"], resp.status_code, resp.text[:200])
        return None
    return resp.json()  # uuid string oder null


def set_canonical(client: httpx.Client, headers: dict, listing_id: str, canonical_id: str) -> bool:
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    url = f"{url_base}/rest/v1/listings?id=eq.{listing_id}"
    resp = client.patch(
        url,
        headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json={"canonical_id": canonical_id},
        timeout=15,
    )
    if resp.status_code >= 400:
        log.warning("set_canonical failed listing=%s: %d %s", listing_id, resp.status_code, resp.text[:200])
        return False
    return True


def main() -> int:
    load_dotenv()
    _setup_logging()

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein")
        return 1

    headers = {
        "apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f'Bearer {os.environ["SUPABASE_SERVICE_ROLE_KEY"]}',
    }

    limit = int(os.getenv("BACKFILL_LIMIT", "0")) or None  # 0 = unbegrenzt

    started = time.time()
    with httpx.Client(follow_redirects=True) as client:
        log.info("Lade Set bereits gehashter Listings …")
        already = fetch_already_hashed(client, headers)
        log.info("Bereits gehasht: %d", len(already))

        offset = 0
        processed = 0
        hashed_new = 0
        merged = 0
        skipped_no_cover = 0
        skipped_phash_failed = 0

        while True:
            batch = fetch_pending_listings(client, headers, offset)
            if not batch:
                break

            for listing in batch:
                if limit and processed >= limit:
                    break
                processed += 1
                lid = str(listing["id"])
                if lid in already:
                    continue
                media = listing.get("media") or []
                if not media:
                    skipped_no_cover += 1
                    continue
                cover = media[0]
                if not cover:
                    skipped_no_cover += 1
                    continue

                ph = compute_phash_from_url(cover)
                if ph is None:
                    skipped_phash_failed += 1
                    time.sleep(RATE_LIMIT)
                    continue

                if write_image_hash(client, headers, lid, ph, cover):
                    hashed_new += 1
                    already.add(lid)

                # canonical_match nur wenn aktuelles Listing noch keinen hat
                if not listing.get("canonical_id"):
                    match = find_canonical(client, headers, listing, ph)
                    if match and match != lid:
                        if set_canonical(client, headers, lid, match):
                            merged += 1

                time.sleep(RATE_LIMIT)

                if processed % 100 == 0:
                    elapsed = time.time() - started
                    rate = processed / max(elapsed, 1)
                    log.info(
                        "  progress: processed=%d hashed_new=%d merged=%d "
                        "no_cover=%d phash_fail=%d (%.1f items/s)",
                        processed, hashed_new, merged,
                        skipped_no_cover, skipped_phash_failed, rate,
                    )

            if limit and processed >= limit:
                break
            offset += PAGE_SIZE

    elapsed = time.time() - started
    log.info(
        "BACKFILL DONE in %.1fs: processed=%d, hashed_new=%d, merged=%d, "
        "skipped_no_cover=%d, phash_failed=%d",
        elapsed, processed, hashed_new, merged, skipped_no_cover, skipped_phash_failed,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
