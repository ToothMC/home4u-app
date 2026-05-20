"""Bulk-Upsert nach Supabase via generisches RPC `bulk_upsert_external_listings`
(Migration 0050) — gleicher Pfad wie INDEX.cy + zukünftige Crawler.

Liefert Cross-Source-Dedup (find_canonical_for_signals) und einheitlichen
deduped-Counter. Source wird als `p_source='bazaraki'` mitgegeben.

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
    # extracted_data um source_url erweitern — der Detail-URL-Slug ist auf
    # Bazaraki Pflicht: /adv/{id}/ ohne Slug redirected auf die Kategorie-
    # Übersicht. Mit Slug landet der Click auf dem Inserat. detail_url enthält
    # bereits die volle absolute URL aus dem List-Extractor (LIST_EXTRACT_JS).
    extracted = dict(item.extracted_data or {})
    if item.detail_url:
        extracted["source_url"] = item.detail_url
    row = {
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
        "extracted_data": extracted or None,
        # Score-Felder bewusst NICHT — Worker setzt scam_checked_at später.
        "dedup_hash": _build_dedup_hash(item.external_id),
    }
    # Dedup-Signale (optional): RPC ignoriert nullable Felder.
    # cover_phash kommt als string ins JSON, RPC casted zu bigint.
    if item.cover_phash is not None:
        row["cover_phash"] = str(item.cover_phash)
    if item.phone_hash:
        row["phone_hash"] = item.phone_hash
    # Kontakt-Klartext: Server-side encrypted (pgp_sym_encrypt) im RPC.
    # Nur senden wenn extrahiert. RPC ignoriert leere Strings.
    if item.contact_phone:
        row["contact_phone"] = item.contact_phone
    if item.contact_phone_country:
        row["contact_phone_country"] = item.contact_phone_country
    if item.contact_email:
        row["contact_email"] = item.contact_email
    # Provenance: Bazaraki-Phone wird aus Inserat selbst geklickt → "public"
    row["contact_source"] = "public"
    return row


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _post_chunk(url: str, headers: dict, payload: list[dict]) -> dict:
    """RPC-Call mit p_source + p_rows. Response: {ok, inserted, updated, deduped, failed}."""
    resp = httpx.post(
        url,
        headers=headers,
        json={"p_source": "bazaraki", "p_rows": payload},
        timeout=60,
    )
    if resp.status_code >= 400:
        log.error("RPC failed (%d): %s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
    return resp.json()


def upsert_listings(items: Iterable[RawListing]) -> dict[str, int]:
    """Bulk-Upsert via generisches RPC. Konfliktauflösung: on (source, dedup_hash)."""
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
        return {"chunks": 0, "rows_attempted": 0, "inserted": 0, "updated": 0, "deduped": 0, "failed": []}

    inserted = 0
    updated = 0
    deduped = 0
    chunks = 0
    failed: list = []
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        result = _post_chunk(url, headers, chunk)
        chunks += 1
        inserted += int(result.get("inserted", 0))
        updated += int(result.get("updated", 0))
        deduped += int(result.get("deduped", 0))
        chunk_failed = result.get("failed", []) or []
        failed.extend(chunk_failed)
        log.info(
            "  chunk %d: ins=%d upd=%d dedup=%d fail=%d",
            chunks,
            result.get("inserted", 0),
            result.get("updated", 0),
            result.get("deduped", 0),
            len(chunk_failed),
        )

    return {
        "chunks": chunks,
        "rows_attempted": len(rows),
        "inserted": inserted,
        "updated": updated,
        "deduped": deduped,
        "failed": failed,
    }


def fetch_drill_queue_below_media(threshold: int, limit: int | None = None) -> list[dict]:
    """Bazaraki-Listings mit media < threshold + ihre Detail-URLs.

    Für den Standalone-Backfill-Modus (BACKFILL_DRILL_QUEUE=1): Pass 1 wird
    übersprungen, Listings werden direkt aus der DB nach Cover-Mangel gewählt
    und Pass 2 läuft über sie. Der Detail-Pfad rekonstruiert sich aus
    `extracted_data->>'source_url'` — das wird seit Mai 2026 für jedes Listing
    gesetzt (siehe _to_row()).

    Returns: list of {external_id, source_url, listing_type, city, price,
    rooms, title, image_url}. Items ohne source_url werden geskippt (geloggt) —
    ohne URL kein Detail-Drill möglich.

    Sortiert nach `last_seen DESC NULLS LAST` damit der Backfill mit den
    aktivsten/sichtbarsten Listings beginnt: wenn der Watchdog vor dem
    Komplett-Durchlauf greift, sind die wichtigen schon durch.
    """
    if threshold <= 0:
        return []
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    queue: list[dict] = []
    skipped_no_url = 0
    offset = 0
    page_size = 1000
    while True:
        url = (
            f"{url_base}/rest/v1/listings"
            f"?source=eq.bazaraki"
            f"&status=eq.active"
            f"&select=external_id,type,location_city,price,rooms,title,media,extracted_data,last_seen,property_type"
            f"&order=last_seen.desc.nullslast"
        )
        try:
            resp = httpx.get(
                url,
                headers={
                    **headers,
                    "Range-Unit": "items",
                    "Range": f"{offset}-{offset + page_size - 1}",
                },
                timeout=60,
            )
            resp.raise_for_status()
        except Exception as e:
            log.warning("fetch_drill_queue failed at offset %d: %s — return partial", offset, e)
            return queue
        rows = resp.json() or []
        for row in rows:
            media = row.get("media") or []
            if len(media) >= threshold:
                continue
            ext = row.get("external_id")
            extracted = row.get("extracted_data") or {}
            source_url = extracted.get("source_url")
            if not ext:
                continue
            if not source_url:
                skipped_no_url += 1
                continue
            queue.append({
                "external_id": str(ext),
                "source_url": source_url,
                "listing_type": row.get("type"),
                "city": row.get("location_city"),
                "price": row.get("price"),
                "rooms": row.get("rooms"),
                "title": row.get("title"),
                "image_url": media[0] if media else None,
                "property_type": row.get("property_type"),
            })
            if limit is not None and len(queue) >= limit:
                if skipped_no_url:
                    log.warning("Backfill-Queue: %d Listings ohne source_url übersprungen", skipped_no_url)
                return queue
        if len(rows) < page_size:
            break
        offset += page_size
    if skipped_no_url:
        log.warning("Backfill-Queue: %d Listings ohne source_url übersprungen", skipped_no_url)
    return queue


def fetch_listings_below_media(threshold: int) -> set[str]:
    """Bazaraki external_ids deren media-Array < threshold Elemente hat.

    Für targeted Backfill nach DOM-Selector-Fix: wir wollen nur Listings
    re-drillen, die noch broken sind (z.B. 1-Bild aus pre-Fix-Ära), nicht
    die bereits hi-res-Galerie haben. Sonst würde FORCE_FULL_DRILL 5h lang
    die 12k schon-guten Listings nochmal drillen ohne Mehrwert.
    """
    if threshold <= 0:
        return set()
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    needs_drill: set[str] = set()
    offset = 0
    page_size = 1000
    while True:
        url = (
            f"{url_base}/rest/v1/listings"
            f"?source=eq.bazaraki"
            f"&status=eq.active"
            f"&select=external_id,media"
        )
        try:
            resp = httpx.get(
                url,
                headers={
                    **headers,
                    "Range-Unit": "items",
                    "Range": f"{offset}-{offset + page_size - 1}",
                },
                timeout=60,
            )
            resp.raise_for_status()
        except Exception as e:
            log.warning("fetch_listings_below_media failed at offset %d: %s", offset, e)
            return needs_drill  # was wir bis hier haben — besser als alles zu verlieren
        rows = resp.json() or []
        for row in rows:
            ext = row.get("external_id")
            media = row.get("media") or []
            if ext and len(media) < threshold:
                needs_drill.add(str(ext))
        if len(rows) < page_size:
            break
        offset += page_size
    return needs_drill


DRILLED_MEDIA_THRESHOLD = 3
"""Ab welcher media-Array-Länge ein Listing als 'erfolgreich gedrillt' gilt.

Vorher hingen wir an `district OR size_sqm` — aber `parse_address` setzt
`district` auch bei teilgescheiterten Detail-Pages, während die Galerie-
Extraktion auf `[image_url]` zurückfällt. Folge: Listings mit nur 1 Cover-Bild
wurden als 'gedrillt' markiert und nie wieder besucht (Inzident 2026-05-08).
Media-Array ist die einzige zuverlässige Indikation 'Detail-Page wurde wirklich
gegriffen'.
"""


def fetch_already_drilled_external_ids() -> set[str]:
    """Listings, die bereits erfolgreich Detail-Drilling durchlaufen haben.

    Heuristik: media-Array hat >= DRILLED_MEDIA_THRESHOLD Einträge. Re-Drills
    von dünnen Listings (nur Cover) sind erwünscht und werden NICHT geskippt.
    """
    return _fetch_external_ids_by_media(min_media=DRILLED_MEDIA_THRESHOLD)


def _fetch_external_ids_by_media(min_media: int) -> set[str]:
    """Pagination-Helper: alle aktiven Bazaraki-Listings mit media-Länge >= min_media.

    PostgREST kann `array_length(media,1)` nicht direkt filtern, also lesen
    wir `media` mit und filtern client-seitig. ~80k Rows bei 1000er Pages = 80
    Roundtrips, ~10s — günstiger als ein Detail-Re-Drill von zehntausenden
    falsch-positiv markierten Listings.
    """
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    drilled: set[str] = set()
    offset = 0
    page_size = 1000
    while True:
        url = (
            f"{url_base}/rest/v1/listings"
            f"?source=eq.bazaraki"
            f"&select=external_id,media"
        )
        try:
            resp = httpx.get(
                url,
                headers={
                    **headers,
                    "Range-Unit": "items",
                    "Range": f"{offset}-{offset + page_size - 1}",
                },
                timeout=60,
            )
            resp.raise_for_status()
        except Exception as e:
            log.warning("fetch_already_drilled failed at offset %d: %s — assume nothing drilled", offset, e)
            return set()
        rows = resp.json() or []
        for row in rows:
            ext = row.get("external_id")
            media = row.get("media") or []
            if ext and len(media) >= min_media:
                drilled.add(str(ext))
        if len(rows) < page_size:
            break
        offset += page_size
    return drilled


def fetch_already_phashed_external_ids() -> set[str]:
    """Bazaraki-Listings, die schon einen image_hashes-Eintrag haben.
    Daily-Crawl überspringt deren pHash-Compute — die teuersten Phase
    war pHash-Compute für 27k bestehende Items (~4h Image-Downloads).
    Backfill-Job sollte das initial füllen.
    """
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    phashed: set[str] = set()
    offset, page = 0, 1000
    # JOIN-trick via PostgREST embed: image_hashes(listing_id) → listings(external_id)
    # Einfacher: erst alle listing_ids aus image_hashes holen, dann mapping über
    # listings-Tabelle. Zwei Queries, aber jede simpel.
    listing_ids: set[str] = set()
    while True:
        try:
            resp = httpx.get(
                f"{url_base}/rest/v1/image_hashes?select=listing_id",
                headers={
                    **headers,
                    "Range-Unit": "items",
                    "Range": f"{offset}-{offset + page - 1}",
                },
                timeout=30,
            )
            resp.raise_for_status()
        except Exception as e:
            log.warning("fetch_already_phashed (image_hashes) failed: %s", e)
            return set()
        rows = resp.json() or []
        for r in rows:
            lid = r.get("listing_id")
            if lid:
                listing_ids.add(str(lid))
        if len(rows) < page:
            break
        offset += page

    if not listing_ids:
        return set()

    # Map listing_ids → external_ids in Bazaraki
    offset = 0
    ids_list = list(listing_ids)
    BATCH = 200  # PostgREST IN-Filter Länge
    while offset < len(ids_list):
        chunk = ids_list[offset : offset + BATCH]
        in_filter = ",".join(chunk)
        try:
            resp = httpx.get(
                f"{url_base}/rest/v1/listings?source=eq.bazaraki&id=in.({in_filter})&select=external_id",
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
        except Exception as e:
            log.warning("fetch_already_phashed (listings map) failed at offset %d: %s", offset, e)
            offset += BATCH
            continue
        for r in resp.json() or []:
            ext = r.get("external_id")
            if ext:
                phashed.add(str(ext))
        offset += BATCH
    return phashed


def fetch_known_external_ids_for_city_type(
    city_display: str, listing_type: str
) -> set[str]:
    """Alle bekannten external_ids für (source=bazaraki, location_city LIKE City%, type).

    Wird im FAST_MODE genutzt, damit crawl_city während der Pagination
    "all_known → break"-Smart-Stop machen kann. Granularität auf
    (city, type) statt (city, type, subtype) reicht: Subtype-Filterung ist
    eine Bazaraki-URL-Konvention, kein Listing-Field — beim Smart-Stop
    interessiert nur "ist diese Listing-ID schon in unserer DB".
    """
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    ids: set[str] = set()
    offset = 0
    page_size = 1000
    while True:
        url = (
            f"{url_base}/rest/v1/listings"
            f"?source=eq.bazaraki"
            f"&location_city=ilike.{city_display}*"
            f"&type=eq.{listing_type}"
            f"&select=external_id"
        )
        try:
            resp = httpx.get(
                url,
                headers={
                    **headers,
                    "Range-Unit": "items",
                    "Range": f"{offset}-{offset + page_size - 1}",
                },
                timeout=30,
            )
            resp.raise_for_status()
        except Exception as e:
            log.warning(
                "fetch_known_external_ids(%s, %s) failed at offset %d: %s — fallback empty",
                city_display, listing_type, offset, e,
            )
            return set()
        rows = resp.json() or []
        for row in rows:
            ext = row.get("external_id")
            if ext:
                ids.add(str(ext))
        if len(rows) < page_size:
            break
        offset += page_size
    return ids


def touch_last_seen(external_ids: list[str]) -> int:
    """Bulk-Update last_seen=NOW() für gegebene Bazaraki-Listings.

    Wird im FAST_MODE vor der Pagination aufgerufen: alle in unserer DB
    bekannten Listings einer (City, Type)-Kombination bekommen einen
    last_seen-Touch — auch wenn Smart-Stop die Pagination früh kappt,
    werden sie nicht fälschlich als stale markiert.

    RPC `touch_listings_last_seen(p_source, p_external_ids)` ist in der
    DB vorhanden (von cre-/index-/dev-crawler bereits genutzt).

    Returns: Anzahl tatsächlich getouchter Listings (RPC-Return).
    Batched in CHUNK_SIZE-Größen damit RPC-Args nicht überlaufen.
    """
    if not external_ids:
        return 0
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    url = f"{url_base}/rest/v1/rpc/touch_listings_last_seen"
    total = 0
    BATCH = 500
    for i in range(0, len(external_ids), BATCH):
        chunk = external_ids[i : i + BATCH]
        try:
            resp = httpx.post(
                url,
                headers=headers,
                json={"p_source": "bazaraki", "p_external_ids": chunk},
                timeout=30,
            )
            if resp.status_code == 404:
                log.info(
                    "RPC touch_listings_last_seen nicht vorhanden — Pre-Touch deaktiviert"
                )
                return 0
            resp.raise_for_status()
            total += int(resp.json() or 0)
        except Exception as e:
            log.warning(
                "touch_last_seen batch %d-%d failed: %s",
                i, i + len(chunk), e,
            )
    return total


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


def fetch_city_last_seen() -> dict[str, str | None]:
    """Pro Stadt das MAX(last_seen) für source='bazaraki'.

    Wird in main.py genutzt um den Plan nach Freshness zu sortieren —
    Cities mit ältestem (oder fehlendem) last_seen werden ZUERST gecrawlt.
    Bei Watchdog-Cap werden so die ältesten Lücken zuerst geschlossen.

    Returns: {"Famagusta": "2026-04-28T13:28:32+00", "Paphos": "...", ...}
    Cities ohne Listings → fehlen im Dict (= „nie gecrawlt, sofort dran").

    Implementation: Eine City pro PostgREST-Call mit
    `location_city=ilike.<display>*&select=last_seen.max()`. Frühere
    Implementation gruppierte global per location_city — dort enthält die
    Spalte aber "Limassol – Mesa Geitonia", "Paphos – Pegeia" usw. (Hunderte
    distinkte Sub-Strings); kein Lookup matchte den Display-Namen, alle
    Cities bekamen NULL und der Sort wurde wirkungslos. Folge: Cities am
    Ende der Default-Reihenfolge (Nicosia, Famagusta) wurden über Wochen
    nie erreicht, weil Pass-1-Budget bei Limassol/Paphos aufgebraucht war.

    Ebenfalls bewusst entfernt: `status=eq.active`. Für die Plan-Sortierung
    interessiert uns, wann eine City zuletzt überhaupt gecrawlt wurde —
    auch wenn ihre Listings inzwischen stale geworden sind. Sonst sehen
    wir bei Cities mit nur staled-Listings „nie gecrawlt" und unterstellen
    fälschlich Crawl-Bedarf, obwohl der eigentliche Defekt woanders liegt.
    """
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    # Lokaler Import vermeidet Circular-Reference mit config.CITIES
    from .config import CITIES

    out: dict[str, str | None] = {}
    for city in CITIES:
        # location_city enthält Sub-Strings wie "Paphos – Pegeia" → ilike-Prefix
        url = (
            f"{url_base}/rest/v1/listings"
            f"?source=eq.bazaraki"
            f"&location_city=ilike.{city.display}*"
            f"&select=last_seen.max()"
        )
        try:
            resp = httpx.get(url, headers=headers, timeout=20)
            resp.raise_for_status()
            rows = resp.json() or []
            ls = rows[0].get("max") if rows else None
            out[city.display] = ls
        except Exception as e:
            log.warning(
                "fetch_city_last_seen(%s) failed: %s — überspringe",
                city.display,
                e,
            )
    return out
