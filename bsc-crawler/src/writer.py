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
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from .detail import ParsedListing

log = logging.getLogger(__name__)

# Klein halten: jede Zeile kostet in der RPC ~0,5 s pHash-Suche (+ ~3 s
# Marktposition ohne DEFER_MARKET_POSITION). 25 Zeilen bleiben sicher unter
# dem 120-s-statement_timeout der RPC.
CHUNK_SIZE = int(os.getenv("UPSERT_CHUNK_SIZE", "25").strip() or "25")
SOURCE = "bsc"

# Client wartet länger als der Server (statement_timeout 120 s). So bricht
# bei Überlast der Server sauber ab, statt dass der Client aufgibt und ein
# Retry mit dem noch laufenden ersten Versuch um dieselben Zeilen kämpft
# (2026-10-23..26: ShareLock-Warten, 3 Tage 0 Writes).
UPSERT_TIMEOUT_S = 150


def _defer_market() -> bool:
    return os.getenv("DEFER_MARKET_POSITION", "").strip() == "1"


def _is_transient(e: BaseException) -> bool:
    """Nur wiederholen, wenn der Server die Anfrage sicher nicht mehr
    bearbeitet: Verbindungsfehler oder Gateway-Fehler. KEIN Retry bei
    ReadTimeout (Server rechnet evtl. noch) und bei 500 (statement timeout
    — derselbe Block scheitert wieder gleich)."""
    if isinstance(e, httpx.ReadTimeout):
        return False
    if isinstance(e, httpx.TransportError):
        return True
    if isinstance(e, httpx.HTTPStatusError):
        return e.response.status_code in (502, 503, 504)
    return False


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
        # Anteils-Verkauf — Detail-Parser hat im Body Pattern wie
        # "share of an undivided" / "¼ share" / "1/4 share" gefunden.
        # RPC ist sticky: einmal true bleibt true bis Crawler explizit
        # false sendet UND keine andere Quelle es flippt.
        "is_share": item.is_share,
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


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=20),
    retry=retry_if_exception(_is_transient),
    reraise=True,
)
def _post_chunk(url: str, headers: dict, payload: list[dict]) -> dict:
    body: dict = {"p_source": SOURCE, "p_rows": payload}
    if _defer_market():
        # Marktposition nicht pro Zeile im Upsert rechnen, sondern am Ende
        # des Laufs gesammelt (recompute_market_positions_pending).
        body["p_defer_market"] = True
    resp = httpx.post(
        url,
        headers=headers,
        json=body,
        timeout=UPSERT_TIMEOUT_S,
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
            log.warning("chunk %d failed (%d Zeilen): %s: %s",
                        chunks + 1, len(chunk), type(e).__name__, e)
            # Pro Zeile zählen, sonst sieht "50 Zeilen verloren" aus wie 1.
            failed.extend(
                {"index": k, "chunk": chunks + 1, "reason": f"{type(e).__name__}: {e}"}
                for k in range(len(chunk))
            )
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


LOOKUP_BATCH = 1000


def _rpc(name: str, payload: dict, timeout: float = 90):
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    resp = httpx.post(
        f"{url_base}/rest/v1/rpc/{name}",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"{name} HTTP {resp.status_code}: {resp.text[:300]}")
    return resp.json()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _known_batch(ids: list[str]) -> list[str]:
    return _rpc("listings_known_external_ids",
                {"p_source": SOURCE, "p_external_ids": ids}) or []


def lookup_known_ids(listing_ids: list[str]) -> tuple[set[str], set[str]]:
    """Welche der Sitemap-IDs kennen wir schon? Paketweise (1000) über die
    RPC listings_known_external_ids — statt vorab alle ~115k IDs per
    Offset-Paging zu laden (das lief als Seq Scan ins Timeout, seit Mai).

    BSC lässt archivierte Inserate in der Sitemap stehen. Deshalb wird hier
    bewusst NICHT last_seen getoucht — "steht in der Sitemap" ist kein
    Lebenszeichen. Frisch gehalten werden bekannte Inserate über den
    Recheck in main.py (Detailseite prüfen).

    Returns (known, unresolved): unresolved = IDs aus Paketen, die auch nach
    Retries fehlschlugen. Die dürfen weder als neu noch als bekannt gelten.
    """
    known: set[str] = set()
    unresolved: set[str] = set()
    for i in range(0, len(listing_ids), LOOKUP_BATCH):
        batch = listing_ids[i : i + LOOKUP_BATCH]
        try:
            known.update(str(x) for x in _known_batch(batch))
        except Exception as e:
            log.warning("lookup_known_ids: Paket %d fehlgeschlagen: %s",
                        i // LOOKUP_BATCH + 1, e)
            unresolved.update(batch)
    return known, unresolved


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def mark_stale_ids(listing_ids: list[str]) -> int:
    """Auf der Detailseite VERIFIZIERT archivierte Inserate stilllegen
    (status='stale', reversibel — ein späterer Upsert reaktiviert)."""
    if not listing_ids:
        return 0
    return int(_rpc("mark_listings_stale_by_ids",
                    {"p_source": SOURCE, "p_external_ids": listing_ids}) or 0)


def recompute_market_pending(limit: int = 8000) -> dict:
    """Marktposition für Inserate nachrechnen, die mit p_defer_market
    angelegt wurden. Ein Durchlauf über die Vergleichsinserate (~0,03 s pro
    Inserat statt ~3 s im Trigger). Server-Timeout 600 s."""
    return _rpc("recompute_market_positions_pending", {"p_limit": limit},
                timeout=660) or {}
