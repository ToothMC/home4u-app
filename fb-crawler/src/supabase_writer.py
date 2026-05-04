"""Bulk-Upsert nach Supabase via RPC `bulk_upsert_fb_listings` (Migration 0021).

Anders als bazaraki-crawler/supabase_writer.py rufen wir nicht direkt /rest/v1/listings
auf, weil wir Phone- und Raw-Text-Encryption brauchen — das macht der RPC.
"""
from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .extract import Extraction
from .parser import RawPost

log = logging.getLogger(__name__)

CHUNK_SIZE = 50


@dataclass
class UpsertItem:
    """Pre-RPC-Tupel: alles was bulk_upsert_fb_listings braucht."""
    post: RawPost
    extraction: Extraction


def _build_dedup_hash(post_id: str) -> str:
    return f"fb:{post_id}"


def _phone_hash(phone_e164: str | None) -> str | None:
    """sha256(E.164-Phone) — gegen fb_contact_blacklist matchbar."""
    if not phone_e164:
        return None
    return hashlib.sha256(phone_e164.encode("utf-8")).hexdigest()


def _to_row(item: UpsertItem) -> dict:
    p, e = item.post, item.extraction
    # extracted_data: Container für Re-Processing ohne Re-Crawl.
    # Indexer-Spec v2.0 §2.1. Score-Worker fügt später unter "scam"
    # seinen Sub-Key hinzu (siehe lib/scam/worker.ts).
    extracted_data: dict = {}
    if e.raw_extraction:
        extracted_data["llm_extraction"] = e.raw_extraction
    if e.note:
        extracted_data["note"] = e.note
    # Verlinkungs-Handles fürs Bridge-Pattern auf der Listing-Detail-Seite.
    # `source_url` = Konvention aller Crawler (siehe memory: reference_source_url),
    # zusätzlich permalink/group_token/post_id für Reconstruction-Fallbacks.
    extracted_data["source_url"] = p.permalink
    extracted_data["permalink"] = p.permalink
    extracted_data["group_token"] = p.group_token
    extracted_data["post_id"] = p.post_id

    return {
        "external_id": p.post_id,
        "type": e.type,
        "location_city": e.location_city,
        "location_district": e.location_district,
        "price": e.price,
        "currency": e.currency,
        "rooms": e.rooms if e.rooms is not None else 0,
        "size_sqm": e.size_sqm,
        "contact_name": e.contact_name,
        "contact_phone": e.contact_phone,
        # contact_phone_hash hat zwei Verwendungen:
        # 1) Blacklist-Check gegen fb_contact_blacklist (Migration 0021)
        # 2) Cross-Listing-Image-Match (Indexer-Spec v2.0 §6.2 duplicate_images,
        #    seit Migration 0022 wird der Hash auch in listings persistiert)
        "contact_phone_hash": _phone_hash(e.contact_phone),
        "contact_channel": e.contact_channel,
        # Sprache aus Extraction nicht direkt verfügbar — Caller setzt sie
        # vorher in Extraction.note/extra; hier optional weglassen.
        "language": None,
        # Media kommt aus Post (nicht aus LLM): wir trauen unserem Parser mehr
        # als der LLM-Halluzination
        "media": p.images,
        "raw_text": p.text,
        "fb_user_id": p.author_id,
        "dedup_hash": _build_dedup_hash(p.post_id),
        # Indexer-Spec v2.0 §2.2: confidence + extracted_data
        # scam_checked_at NICHT setzen — das macht der Score-Worker
        # (Sticky-Pattern, Migration 0028).
        "confidence": e.confidence,
        "extracted_data": extracted_data if extracted_data else None,
    }


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _post_chunk(url: str, headers: dict, payload: list[dict]) -> dict:
    resp = httpx.post(url, headers=headers, json={"p_rows": payload}, timeout=60)
    if resp.status_code >= 400:
        log.error("RPC failed (%d): %s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
    return resp.json()


def upsert_fb_listings(items: Iterable[UpsertItem], language_by_post_id: dict[str, str] | None = None) -> dict:
    """Bulk-Upsert via RPC. Setzt sprach-Hint aus Klassifikator-Output ein,
    falls vom Caller mitgegeben."""
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/bulk_upsert_fb_listings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    rows = []
    for it in items:
        row = _to_row(it)
        if language_by_post_id:
            lang = language_by_post_id.get(it.post.post_id)
            if lang in ("de", "en", "ru", "el"):
                row["language"] = lang
        rows.append(row)

    if not rows:
        return {"chunks": 0, "inserted": 0, "updated": 0, "opted_out": 0, "failed": []}

    inserted = updated = opted_out = chunks = 0
    failed: list = []
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        result = _post_chunk(url, headers, chunk)
        chunks += 1
        inserted += int(result.get("inserted", 0))
        updated += int(result.get("updated", 0))
        opted_out += int(result.get("opted_out", 0))
        chunk_failed = result.get("failed", []) or []
        failed.extend(chunk_failed)
        log.info(
            "  chunk %d: ins=%d upd=%d opted=%d fail=%d",
            chunks, result.get("inserted", 0), result.get("updated", 0),
            result.get("opted_out", 0), len(chunk_failed),
        )

    return {
        "chunks": chunks,
        "inserted": inserted,
        "updated": updated,
        "opted_out": opted_out,
        "failed": failed,
    }


def mark_stale_old_listings(stale_days: int = 14) -> int:
    """FB-Listings, die seit N Tagen nicht mehr in einem Scroll-Pass auftauchten.

    Höhere Schwelle als Bazaraki (14 vs 7 Tage), weil FB-Crawl unregelmäßiger
    läuft (User-Browser-abhängig)."""
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
            json={"p_stale_days": stale_days, "p_source": "fb"},
            timeout=20,
        )
        if resp.status_code == 404:
            log.info("RPC mark_stale_listings nicht vorhanden — skip")
            return 0
        resp.raise_for_status()
        return int(resp.json() or 0)
    except Exception as e:
        log.warning("mark_stale_listings(fb) failed: %s", e)
        return 0
