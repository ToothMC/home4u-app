"""Bulk-Upsert nach Supabase via generischer RPC bulk_upsert_external_listings.

Identisch zu cre-crawler/writer, aber:
- p_source = 'cy_developer'
- dedup_hash-Format: 'cy_developer:{developer_slug}:{listing_id}'

Differenzierung der einzelnen Bauträger geschieht über das external_id-Prefix
und über extracted_data.developer (aristo, pafilia, leptos, …).
"""
from __future__ import annotations

import logging
import os
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import ParsedListing

log = logging.getLogger(__name__)

CHUNK_SIZE = 50
SOURCE = "cy_developer"


def _to_row(item: ParsedListing, developer: str) -> dict:
    row = {
        "external_id": f"{developer}:{item.listing_id}",
        "type": item.listing_type,
        "location_city": item.location_city,
        "location_district": item.location_district,
        "price": item.price,
        "currency": item.currency,
        "rooms": item.rooms,
        "size_sqm": item.size_sqm,
        "media": item.media,
        "raw_text": item.description,
        "title": item.title,
        "description": item.description,
        "language": "en",
        "property_type": item.property_type,
        # Bauträger-Sites sind strukturierte Quellen mit klar definierten
        # Spec-Tabellen. 0.9 wie bei cyprus-real.estate — etwas niedriger als
        # Bazaraki (gedrillt 0.85) wäre auch ok, aber Bauträger publizieren
        # offizielle Daten, daher 0.9 berechtigt.
        "confidence": 0.9,
        "extracted_data": {
            "source_url": item.detail_url,
            "developer": developer,
            "bathrooms": item.bathrooms,
        },
        "dedup_hash": f"{SOURCE}:{developer}:{item.listing_id}",
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


def upsert_listings(items: Iterable[ParsedListing], developer: str) -> dict:
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/bulk_upsert_external_listings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    rows = [_to_row(i, developer) for i in items]
    if not rows:
        return {"chunks": 0, "rows_attempted": 0, "inserted": 0, "updated": 0, "deduped": 0, "failed": []}

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
        if chunk_failed:
            # Ohne diese Zeile sieht man nur "fail=N" — ein cy_developer-Inzident
            # 2026-05-06 hat 28 stille Failures produziert (Leptos GR-Listings
            # ohne CY-City), niemand wusste warum. Top-3 Reasons reichen für
            # Pattern-Erkennung; full list bei Bedarf via DRY_RUN.
            sample = chunk_failed[:3]
            log.warning(
                "  chunk %d: %d row failures, sample reasons: %s",
                chunks, len(chunk_failed),
                "; ".join(f"#{f.get('index')} {f.get('reason', '?')[:120]}" for f in sample),
            )
        failed.extend(chunk_failed)
    return {
        "chunks": chunks,
        "rows_attempted": len(rows),
        "inserted": inserted,
        "updated": updated,
        "deduped": deduped,
        "failed": failed,
    }


def touch_last_seen(developer: str, listing_ids: list[str]) -> int:
    """Aktualisiert last_seen für bestehende cy_developer-Listings ohne Re-Fetch.

    Wird vom main-Loop für URLs gerufen, die in discover() wieder auftauchen
    aber bereits vollständig indexiert sind — sonst rostet last_seen ein und
    mark_stale_old_listings würde sie nach 7d als tot markieren.
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
    external_ids = [f"{developer}:{lid}" for lid in listing_ids]
    try:
        resp = httpx.post(
            url, headers=headers,
            json={"p_source": SOURCE, "p_external_ids": external_ids},
            timeout=30,
        )
        resp.raise_for_status()
        return int(resp.json() or 0)
    except Exception as e:
        log.warning("touch_last_seen(%s, %d ids) failed: %s", developer, len(external_ids), e)
        return 0


def fetch_already_indexed(developer: str) -> set[str]:
    """Holt alle bisherigen external_ids für diesen Developer.

    external_id ist im Format `{developer}:{listing_id}` gespeichert.
    Wir filtern auf source=cy_developer + external_id.like '{developer}:*'
    und liefern nur den listing_id-Teil zurück, damit das Per-Developer-
    Modul ohne Prefix-Wissen filtern kann.
    """
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    indexed: set[str] = set()
    offset, page = 0, 1000
    prefix = f"{developer}:"
    while True:
        url = (
            f"{url_base}/rest/v1/listings"
            f"?source=eq.cy_developer"
            f"&external_id=like.{prefix}*"
            f"&select=external_id"
        )
        try:
            resp = httpx.get(
                url,
                headers={
                    **headers,
                    "Range-Unit": "items",
                    "Range": f"{offset}-{offset + page - 1}",
                },
                timeout=30,
            )
            resp.raise_for_status()
        except Exception as e:
            log.warning("fetch_already_indexed(%s) failed: %s", developer, e)
            return set()
        rows = resp.json() or []
        for r in rows:
            ext = r.get("external_id") or ""
            if ext.startswith(prefix):
                indexed.add(ext[len(prefix):])
        if len(rows) < page:
            break
        offset += page
    return indexed


def mark_stale_old_listings(developer: str, stale_days: int = 7) -> int:
    """mark_stale_listings RPC mit p_source filter. Best-Effort."""
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/mark_stale_listings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    try:
        resp = httpx.post(
            url, headers=headers,
            json={"p_stale_days": stale_days, "p_source": SOURCE},
            timeout=20,
        )
        if resp.status_code == 404:
            log.info("RPC mark_stale_listings nicht vorhanden — skip")
            return 0
        resp.raise_for_status()
        return int(resp.json() or 0)
    except Exception as e:
        log.warning("mark_stale_listings(%s) failed: %s", developer, e)
        return 0
