"""Bulk-Upsert nach Supabase via REST API (PostgREST)."""
from __future__ import annotations

import logging
import os
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .crawler import RawListing

log = logging.getLogger(__name__)

CHUNK_SIZE = 50  # PostgREST verträgt deutlich mehr, aber so bleibt ein Fehler isoliert


def _build_dedup_hash(external_id: str) -> str:
    """Konsistent mit lib/import/dedup.ts — Bazaraki-IDs sind stabil."""
    return f"bazaraki:{external_id}"


def _to_row(item: RawListing) -> dict:
    media = [item.image_url] if item.image_url else []
    return {
        "source": "bazaraki",
        "external_id": item.external_id,
        "type": item.listing_type,
        "status": "active",
        "location_city": item.city,
        "price": item.price,
        "currency": "EUR",
        "price_period": "month" if item.listing_type == "rent" else "total",
        "rooms": item.rooms,
        "media": media,
        "language": "en",
        "dedup_hash": _build_dedup_hash(item.external_id),
        # first_seen wird vom Default gesetzt; last_seen wird via Conflict-Update neu gesetzt
    }


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _post_chunk(url: str, headers: dict, payload: list[dict]) -> int:
    """POST mit on-conflict=resolution=merge-duplicates → upsert auf (source, dedup_hash)."""
    resp = httpx.post(url, headers=headers, json=payload, timeout=30)
    if resp.status_code >= 400:
        log.error("POST failed (%d): %s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
    # PostgREST liefert mit Prefer: return=representation die Rows zurück
    return len(resp.json())


def upsert_listings(items: Iterable[RawListing]) -> dict[str, int]:
    """Bulk-Upsert. Konfliktauflösung: on (source, dedup_hash) → update last_seen + price + status."""
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/listings?on_conflict=source,dedup_hash"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        # merge-duplicates → INSERT … ON CONFLICT … DO UPDATE für ALLE übergebenen Spalten
        "Prefer": "resolution=merge-duplicates,return=representation",
    }

    rows = [_to_row(i) for i in items]
    if not rows:
        return {"chunks": 0, "rows_attempted": 0, "rows_written": 0}

    written = 0
    chunks = 0
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        n = _post_chunk(url, headers, chunk)
        written += n
        chunks += 1
        log.info("  chunk %d: %d/%d rows", chunks, n, len(chunk))

    return {"chunks": chunks, "rows_attempted": len(rows), "rows_written": written}


def mark_stale_old_listings(stale_days: int = 7) -> int:
    """Listings, die seit N Tagen nicht mehr gesehen wurden → status='stale'.

    Best-Effort, blockiert Crawl-Run nicht bei Fehler.
    """
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/mark_stale_listings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = httpx.post(url, headers=headers, json={"p_stale_days": stale_days, "p_source": "bazaraki"}, timeout=20)
        if resp.status_code == 404:
            log.info("RPC mark_stale_listings nicht vorhanden — skip (Migration 0011 noch nicht ausgespielt)")
            return 0
        resp.raise_for_status()
        return int(resp.json() or 0)
    except Exception as e:
        log.warning("mark_stale_listings failed: %s", e)
        return 0
