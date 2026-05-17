"""Bulk-Upsert nach Supabase via generischer RPC bulk_upsert_external_listings.

Identische Struktur wie index-crawler/writer.py, aber:
- p_source = 'bsc'
- dedup_hash-Format: 'bsc:{listing_id}'

httpx (nicht curl_cffi) reicht hier — Supabase hat keinen CF-Challenge.
"""
from __future__ import annotations

import logging
import os
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .detail import ParsedListing

log = logging.getLogger(__name__)

CHUNK_SIZE = 50
SOURCE = "bsc"


def _smallint_or_none(v):
    """RPC castet rooms + size_sqm zu smallint (Range -32768..32767). Float-
    Werte ("75.0") und Out-of-Range-Werte (Industrial-Plots, pathologische
    rooms aus dem Title-Regex) brechen die Row sonst in failed[]."""
    if v is None:
        return None
    try:
        n = int(round(v))
    except (TypeError, ValueError):
        return None
    if n < -32768 or n > 32767:
        return None
    return n


def _to_row(item: ParsedListing) -> dict:
    row = {
        "external_id": item.listing_id,
        "type": item.listing_type,
        "location_city": item.location_city,
        "location_district": item.location_district,
        "price": item.price,
        "currency": item.currency,
        "rooms": _smallint_or_none(item.rooms),
        "size_sqm": _smallint_or_none(item.size_sqm),
        "media": item.media,
        "raw_text": item.description,
        "title": item.title,
        "description": item.description,
        "language": "en",
        "property_type": item.property_type,
        "confidence": 0.85,  # Title-Pattern ist solide, etwas unter JSON-LD
        "extracted_data": {
            "source_url": item.detail_url,
            "bathrooms": item.bathrooms,
        },
        "dedup_hash": f"{SOURCE}:{item.listing_id}",
    }
    if item.cover_phash is not None:
        row["cover_phash"] = str(item.cover_phash)
    if item.phone_hash:
        row["phone_hash"] = item.phone_hash
    if item.contact_phone:
        row["contact_phone"] = item.contact_phone
    if item.contact_phone_country:
        row["contact_phone_country"] = item.contact_phone_country
    if item.contact_email:
        row["contact_email"] = item.contact_email
    row["contact_source"] = "public"
    return row


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _post_chunk(url: str, headers: dict, payload: list[dict]) -> dict:
    resp = httpx.post(
        url,
        headers=headers,
        json={"p_source": SOURCE, "p_rows": payload},
        timeout=60,
    )
    if resp.status_code >= 400:
        log.error("RPC failed (%d): %s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
    return resp.json()


def upsert_listings(items: Iterable[ParsedListing]) -> dict:
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/bulk_upsert_external_listings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    rows = [_to_row(i) for i in items]
    if not rows:
        return {"chunks": 0, "rows_attempted": 0, "inserted": 0, "updated": 0, "deduped": 0}

    inserted = updated = deduped = chunks = 0
    failed: list = []
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        try:
            result = _post_chunk(url, headers, chunk)
        except Exception as e:
            log.warning("chunk %d failed: %s", chunks + 1, e)
            failed.append({"chunk": chunks + 1, "error": str(e)})
            chunks += 1
            continue
        chunks += 1
        inserted += int(result.get("inserted", 0))
        updated += int(result.get("updated", 0))
        deduped += int(result.get("deduped", 0))
        chunk_failed = result.get("failed", []) or []
        failed.extend(chunk_failed)
        log.info(
            "  chunk %d: ins=%d upd=%d dedup=%d fail=%d",
            chunks, result.get("inserted", 0), result.get("updated", 0),
            result.get("deduped", 0), len(chunk_failed),
        )
        # Ohne diese Sichtbarkeit war ein per-row-cast-Bug nur an "fail=99 in
        # einem Chunk" erkennbar — jetzt steht die Reason direkt im Log inkl.
        # external_id der Row (über chunk-Index in den Source-Rows).
        if chunk_failed:
            reasons: dict[str, list[str]] = {}
            for f in chunk_failed:
                r = (f or {}).get("reason") or "unknown"
                idx = (f or {}).get("index")
                ext_id = "?"
                if isinstance(idx, int) and 0 <= idx < len(chunk):
                    ext_id = chunk[idx].get("external_id", "?")
                reasons.setdefault(r, []).append(str(ext_id))
            for r, ids in sorted(reasons.items(), key=lambda x: -len(x[1]))[:5]:
                sample = ",".join(ids[:5])
                log.warning("    failed-reason (%d×): %s  ids=[%s%s]",
                            len(ids), r[:160], sample,
                            "..." if len(ids) > 5 else "")

    return {
        "chunks": chunks,
        "rows_attempted": len(rows),
        "inserted": inserted,
        "updated": updated,
        "deduped": deduped,
        "failed": failed,
    }


def touch_last_seen(listing_ids: list[str]) -> int:
    """last_seen für bestehende bsc-Listings aktualisieren, ohne sie neu zu
    fetchen. Sonst rostet last_seen ein und mark_stale-Gate würde alle
    bekannten Listings nach 14d archivieren.
    """
    if not listing_ids:
        return 0
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/touch_listings_last_seen"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = httpx.post(
            url, headers=headers,
            json={"p_source": SOURCE, "p_external_ids": listing_ids},
            timeout=30,
        )
        resp.raise_for_status()
        return int(resp.json() or 0)
    except Exception as e:
        log.warning("touch_last_seen(%d ids) failed: %s", len(listing_ids), e)
        return 0


def fetch_already_indexed() -> set[str]:
    """Set aller external_ids die wir schon haben — für inkrement-Filter.

    PostgREST paginieren wir per `limit`/`offset`-Query (statt Range-Header)
    plus deterministisches Order auf external_id. Range hat in der vorigen
    Variante HTTP 400 geworfen; konkreter Error-JSON wird jetzt geloggt.
    """
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    seen: set[str] = set()
    offset, page = 0, 1000
    with httpx.Client(timeout=30) as client:
        while True:
            url = (
                f"{url_base}/rest/v1/listings"
                f"?source=eq.{SOURCE}"
                f"&select=external_id"
                f"&order=external_id.asc"
                f"&limit={page}&offset={offset}"
            )
            resp = client.get(url, headers=headers)
            if resp.status_code >= 400:
                log.warning("fetch_already_indexed HTTP %d: %s",
                            resp.status_code, resp.text[:300])
                resp.raise_for_status()
            rows = resp.json() or []
            for r in rows:
                ext = r.get("external_id")
                if ext:
                    seen.add(str(ext))
            if len(rows) < page:
                break
            offset += page
    return seen
