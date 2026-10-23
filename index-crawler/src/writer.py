"""Bulk-Upsert nach Supabase via generischer RPC bulk_upsert_external_listings.

Identische Struktur wie bazaraki-crawler/supabase_writer, aber:
- p_source = 'index_cy' (statt hardcoded bazaraki)
- dedup_hash-Format: 'index_cy:{listing_id}'
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
SOURCE = "index_cy"


def _to_row(item: ParsedListing) -> dict:
    row = {
        "external_id": item.listing_id,
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
        "confidence": 0.9,  # strukturierte JSON-LD-Quelle, hohe Sicherheit
        "extracted_data": {
            "source_url": item.detail_url,
            "bathrooms": item.bathrooms,
        },
        "dedup_hash": f"index_cy:{item.listing_id}",
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

    return {
        "chunks": chunks,
        "rows_attempted": len(rows),
        "inserted": inserted,
        "updated": updated,
        "deduped": deduped,
        "failed": failed,
    }


def mark_stale_old_listings(stale_days: int = 3) -> int:
    """Listings die seit N Tagen nicht mehr im Crawl auftauchten → status='stale'.

    Best-Effort: blockiert Crawl-Run nicht bei Fehler.
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
        resp = httpx.post(
            url,
            headers=headers,
            json={"p_stale_days": stale_days, "p_source": SOURCE},
            timeout=20,
        )
        if resp.status_code == 404:
            log.info("RPC mark_stale_listings nicht vorhanden — skip")
            return 0
        resp.raise_for_status()
        return int(resp.json() or 0)
    except Exception as e:
        log.warning("mark_stale_listings failed: %s", e)
        return 0


LOOKUP_BATCH = 1000


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _touch_known_batch(client: httpx.Client, ids: list[str], touch: bool = True) -> list[str]:
    rpc = "touch_known_listings" if touch else "listings_known_external_ids"
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    resp = client.post(
        f"{url_base}/rest/v1/rpc/{rpc}",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        json={"p_source": SOURCE, "p_external_ids": ids},
        timeout=90,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"{rpc} HTTP {resp.status_code}: {resp.text[:300]}")
    return resp.json() or []


def touch_known_ids(
    client: httpx.Client, listing_ids: list[str], touch: bool = True,
) -> tuple[set[str], set[str]]:
    """Bekannte Sitemap-IDs nachschlagen UND last_seen auffrischen, paketweise
    (1000) über die RPC touch_known_listings.

    Vorher: alle ~44k IDs vorab per Range-Paging laden (Seq Scan → Timeout
    → "fallback full") und dann 33k IDs in EINEM Touch-Call (Read-Timeout).
    Folge: last_seen wurde seit Mai nicht aufgefrischt, mark-stale-Gate brach
    täglich ab. Die RPC touched höchstens einmal pro ~20 h pro Zeile.

    touch=False: nur nachschlagen (DRY_RUN), nichts schreiben.

    Returns (known, unresolved): unresolved = IDs aus Paketen, die auch nach
    Retries fehlschlugen — weder neu noch bekannt.
    """
    known: set[str] = set()
    unresolved: set[str] = set()
    for i in range(0, len(listing_ids), LOOKUP_BATCH):
        batch = listing_ids[i : i + LOOKUP_BATCH]
        try:
            known.update(str(x) for x in _touch_known_batch(client, batch, touch))
        except Exception as e:
            log.warning("touch_known_ids: Paket %d fehlgeschlagen: %s",
                        i // LOOKUP_BATCH + 1, e)
            unresolved.update(batch)
    return known, unresolved
