"""Bulk-Upsert nach Supabase via RPC `bulk_upsert_bazaraki_listings` (Migration 0029).

Vorher: PostgREST `/rest/v1/listings?on_conflict=...` mit Klartext-raw_text.
Jetzt: RPC mit serverseitiger pgp_sym_encrypt-Verschlüsselung von raw_text
(analog FB, Indexer-Spec v2.0 §4.2 / §6).

Score-Felder werden NICHT mitgeschickt — der Async-Score-Worker
(lib/scam/worker.ts) holt sich Listings mit scam_checked_at IS NULL und
scort sie nachträglich (Sticky-Pattern via Migration 0028).
"""
from __future__ import annotations

import logging
import os
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .crawler import RawListing

log = logging.getLogger(__name__)

CHUNK_SIZE = 50


def _build_dedup_hash(external_id: str) -> str:
    """Konsistent mit lib/import/dedup.ts — Bazaraki-IDs sind stabil."""
    return f"bazaraki:{external_id}"


def _to_row(item: RawListing) -> dict:
    # Media: Detail-Page-Galerie wenn gedrillt, sonst Listenseiten-Cover
    media = item.media if item.media else ([item.image_url] if item.image_url else [])
    return {
        "external_id": item.external_id,
        "type": item.listing_type,
        "location_city": item.city,
        "location_district": item.district,
        "price": item.price,
        "currency": "EUR",
        "rooms": item.rooms,
        "size_sqm": item.size_sqm,
        # Spec §4.2: alle Bilder ≥720px (gefiltert via DETAIL_EXTRACT_JS,
        # verifiziert durch tests/test_detail_extract.py).
        "media": media,
        # raw_text wird im RPC pgp_sym_encrypt'd in raw_text_enc.
        # Detail-Page liefert die volle Beschreibung; Fallback ist None,
        # dann bleibt raw_text_enc NULL.
        "raw_text": item.description,
        "title": item.title,
        "description": item.description,
        "language": "en",
        "energy_class": item.energy_class,
        "furnishing": item.furnishing,
        "pets_allowed": item.pets_allowed,
        "property_type": item.property_type,
        # Spec §2.2: confidence + extracted_data
        "confidence": item.confidence,
        "extracted_data": item.extracted_data,
        # Score-Felder bewusst NICHT — Worker setzt scam_checked_at später.
        "dedup_hash": _build_dedup_hash(item.external_id),
    }


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _post_chunk(url: str, headers: dict, payload: list[dict]) -> dict:
    """RPC-Call mit p_rows JSON-Array. Response: {ok, inserted, updated, failed}."""
    resp = httpx.post(url, headers=headers, json={"p_rows": payload}, timeout=60)
    if resp.status_code >= 400:
        log.error("RPC failed (%d): %s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
    return resp.json()


def upsert_listings(items: Iterable[RawListing]) -> dict[str, int]:
    """Bulk-Upsert via RPC. Konfliktauflösung: on (source='bazaraki', dedup_hash)."""
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/bulk_upsert_bazaraki_listings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    rows = [_to_row(i) for i in items]
    if not rows:
        return {"chunks": 0, "rows_attempted": 0, "inserted": 0, "updated": 0, "failed": []}

    inserted = 0
    updated = 0
    chunks = 0
    failed: list = []
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        result = _post_chunk(url, headers, chunk)
        chunks += 1
        inserted += int(result.get("inserted", 0))
        updated += int(result.get("updated", 0))
        chunk_failed = result.get("failed", []) or []
        failed.extend(chunk_failed)
        log.info(
            "  chunk %d: ins=%d upd=%d fail=%d",
            chunks, result.get("inserted", 0), result.get("updated", 0), len(chunk_failed),
        )

    return {
        "chunks": chunks,
        "rows_attempted": len(rows),
        "inserted": inserted,
        "updated": updated,
        "failed": failed,
    }


def fetch_already_drilled_external_ids() -> set[str]:
    """Listings, die bereits Detail-Drilling durchlaufen haben — erkennbar
    daran dass district ODER size_sqm gesetzt wurde.

    Wird genutzt um beim Daily-Crawl nur NEUE Listings zu drillen.
    Detail-Daten (district, m², Galerie) ändern sich auf Bazaraki praktisch
    nie nachträglich — Re-Drill bringt im Schnitt 0 neue Information bei
    100% Kosten. Re-Drills passieren über separates Weekly-Workflow oder
    FORCE_FULL_DRILL=1.
    """
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    drilled: set[str] = set()
    # Pagination via Range-Header — PostgREST returned max 1000 pro Call
    # ohne explizites Range-Limit (oder 100 default je nach Setup).
    offset = 0
    page_size = 1000
    while True:
        url = (
            f"{url_base}/rest/v1/listings"
            f"?source=eq.bazaraki"
            f"&or=(location_district.not.is.null,size_sqm.not.is.null)"
            f"&select=external_id"
        )
        try:
            resp = httpx.get(
                url,
                headers={
                    **headers,
                    "Range-Unit": "items",
                    "Range": f"{offset}-{offset + page_size - 1}",
                    "Prefer": "count=exact",
                },
                timeout=30,
            )
            resp.raise_for_status()
        except Exception as e:
            log.warning("fetch_already_drilled failed: %s — assume nothing drilled", e)
            return set()
        rows = resp.json() or []
        for row in rows:
            ext = row.get("external_id")
            if ext:
                drilled.add(str(ext))
        if len(rows) < page_size:
            break
        offset += page_size
    return drilled


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
