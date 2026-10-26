"""BSC-Crawler Entry-Point.

Flow:
  1. Sitemap-Discovery: alle Sub-Sitemaps laut Index → ID-eindeutige
     Detail-URLs (~189k inkl. gelöschter, Stand 2026-10)
  2. Inkrementell: bekannte external_ids paketweise nachschlagen (RPC) →
     Neu-Schlange (minus lokal gemerkter gelöschter IDs)
  3. Recheck-Schlange aus der DB: aktive Inserate, die am längsten nicht
     gesehen wurden (listings_recheck_candidates), mit gespeicherter URL.
     NICHT aus der Sitemap: ~27 % der aktiven BSC-Inserate fehlen dort,
     sind aber live (Stichprobe 2026-10-26: 36 von 40).
  4. Beide Schlangen verschränkt nach Zeitanteil (RECHECK_SHARE), damit der
     Neu-Rückstau den Recheck nicht verdrängt (bis 2026-10-26 kam der
     Recheck nie dran: 0 von 3.420 pro Lauf).
     Recheck-Ergebnis: live + unverändert → nur last_seen antippen,
     live + Preis/URL neu → Upsert, gelöscht → direkt stale.
  5. mark_stale am Ende — nur wenn vollständig durchgelaufen

Gelöscht heißt: HTTP 404/410, Titel ohne €-Preis, oder 301 auf Such-/
Startseite (siehe detail.classify_redirect).

Watchdog (MAX_RUNTIME_S, default 90min): stoppt vor dem nächsten Listing,
sobald die Wall-Clock das Budget reißt. Workflow-timeout +25min Headroom.

Kapazität (gemessen 2026-10-26, Runner mac-mini):
  Detailseite ~1,3 s (inkl. 1,0 s Rate-Limit). Recheck unverändert ≈ 1,3 s
  (Touch gebündelt, ~0). Neues Inserat ≈ 4–5 s (pHash + Insert-RPC).
  Lauf 5400 s, davon ~5300 s Detailphase; 4 Läufe/Tag.
  RECHECK_SHARE=0.7 → ~2.850 Rechecks/Lauf ≈ 11.400/Tag; Neu ≈ 1.600 s/Lauf
  ≈ 350/Lauf ≈ 1.400/Tag. 115k aktive → ein Recheck-Umlauf ≈ 10 Tage
  (< 14-Tage-Cutoff von mark_stale). Sind keine Rechecks fällig
  (RECHECK_MIN_AGE_DAYS), bekommt Neu die ganze Zeit.

BSC-Spezifika:
- curl_cffi mit Chrome120-TLS-Fingerprint umgeht Cloudflare Managed Challenge
- Sitemap-`.xml.gz` ist eine Anti-Scraper-Falle (10-Byte-Stub), nur `.xml` nutzen
- Rate-Limit: 1.0s default, konservativer als andere Sources weil CF mitliest

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: Pflicht
  RATE_LIMIT_S: Pause pro Detail-Fetch (default 1.0)
  MAX_LISTINGS: Cap für Smoke-Tests, gilt je Schlange (default 0 = unbegrenzt)
  MAX_RUNTIME_S: Wall-Clock-Budget bevor sauberer Stopp (default 5400 = 90min)
  STREAM_BATCH_SIZE: Batch-Size für Streaming-Upsert (default 50)
  DRY_RUN=1: kein DB-Write, nur loggen
  SKIP_PHASH=1: pHash-Phase überspringen
  FORCE_REFETCH=1: auch bereits indexierte Listings nochmal fetchen (kein Recheck)
  UPSERT_CHUNK_SIZE: Zeilen pro Upsert-RPC (default 25)
  DEFER_MARKET_POSITION=1: Marktposition nicht pro Zeile im Upsert rechnen,
    sondern am Laufende gesammelt (recompute_market_positions_pending).
  RECHECK_PER_RUN: max. Recheck-Kandidaten pro Lauf (default 4500, 0 = aus;
    mehr als ~4.000 schafft ein 90-min-Lauf ohnehin nicht)
  RECHECK_MIN_AGE_DAYS: nur Inserate nachprüfen, die so lange nicht gesehen
    wurden (default 7)
  RECHECK_SHARE: Anteil der Laufzeit für Recheck, solange beide Schlangen
    Arbeit haben (default 0.7)
  RECHECK_MAX_GONE_SHARE: Notbremse — mehr als dieser Anteil "gelöscht"
    unter den Rechecks (ab 50 Stück) → nichts mehr stale setzen, Lauf rot
    (default 0.5; erwartet sind ~5–15 %)
  ARCHIVED_CACHE_TTL_DAYS: gelöschte Sitemap-IDs so lange nicht neu holen
    (default 60). Datei: $BSC_STATE_DIR/archived_ids.tsv
    (default ~/.cache/home4u-bsc/, bleibt auf dem self-hosted Runner liegen)
"""
from __future__ import annotations

import logging
import os
import sys
import time

import httpx
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential

from . import archived_cache
from .dedup import compute_phash_from_url
from .detail import STATUS_ACTIVE, STATUS_ARCHIVED, ParsedListing, check_detail
from .http_client import BscSession
from .sitemap import LISTING_URL_PATTERN, ListingURL, discover_all_listings
from .writer import (
    lookup_known_ids,
    mark_stale_ids,
    recheck_candidates,
    recompute_market_pending,
    touch_ids,
    upsert_listings,
)

SOURCE = "bsc"


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip().replace(",", ".")
    return float(raw) if raw else default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _mark_stale_rpc() -> int:
    """Stale-Markierung verwendet dieselbe RPC wie alle anderen Sources.
    Schwelle 14d, der Sweep-Gate prüft selbst ob der Crawler frisch genug
    war (mind. 1000 Listings in 24h gesehen)."""
    url_base = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{url_base}/rest/v1/rpc/mark_stale_listings"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    resp = httpx.post(
        url,
        headers=headers,
        json={"p_stale_days": 14, "p_source": SOURCE, "p_min_recent_seen": 1000},
        timeout=20,
    )
    if resp.status_code == 404:
        return 0
    resp.raise_for_status()
    return int(resp.json() or 0)


def build_recheck_items(
    candidates: list[dict], by_id: dict[str, ListingURL],
) -> tuple[list[ListingURL], dict[str, dict], int]:
    """RPC-Kandidaten → ListingURLs. URL aus der DB (source_url), sonst aus
    der Sitemap. Liefert (items, meta je ID, Anzahl ohne brauchbare URL)."""
    items: list[ListingURL] = []
    meta: dict[str, dict] = {}
    no_url = 0
    for c in candidates:
        lid = str(c.get("external_id") or "")
        if not lid or lid in meta:
            continue
        url = c.get("source_url") or ""
        m = LISTING_URL_PATTERN.match(url)
        if not m or m.group("id") != lid:
            sm = by_id.get(lid)
            if sm is None:
                no_url += 1
                continue
            items.append(sm)
        else:
            items.append(ListingURL(
                listing_id=lid, detail_url=url, city_slug=m.group("city"),
                district_slug=m.group("district"), type_slug=m.group("slug"),
            ))
        meta[lid] = {"price": c.get("price"), "source_url": url}
    return items, meta, no_url


def needs_upsert(p: ParsedListing, meta: dict | None) -> bool:
    """Recheck live: voller Upsert nur, wenn sich Preis oder URL geändert
    haben (oder wir den alten Stand nicht kennen). Sonst reicht Touch."""
    if not meta:
        return True
    old = meta.get("price")
    if old is None or p.price is None:
        return True
    try:
        if abs(float(old) - float(p.price)) >= 0.5:
            return True
    except (TypeError, ValueError):
        return True
    return (meta.get("source_url") or "") != p.detail_url


def pick_recheck(t_recheck: float, t_new: float, share: float,
                 has_recheck: bool, has_new: bool) -> bool:
    """Nächstes Item aus der Recheck-Schlange? Zeitanteil statt Stückzahl,
    weil ein neues Inserat (Insert ~3–5 s) viel teurer ist als ein Recheck."""
    if not has_recheck:
        return False
    if not has_new:
        return True
    return t_recheck <= share * (t_recheck + t_new)


def gone_share_exceeded(gone: int, alive: int, max_share: float, min_n: int = 50) -> bool:
    n = gone + alive
    return n >= min_n and gone > max_share * n


def main() -> int:
    load_dotenv()
    _setup_logging()
    log = logging.getLogger("bsc-crawler")

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein")
        return 1

    rate_limit = _env_float("RATE_LIMIT_S", 1.0)
    max_listings = _env_int("MAX_LISTINGS", 0) or None
    dry_run = os.getenv("DRY_RUN") == "1"
    skip_phash = os.getenv("SKIP_PHASH") == "1"
    force_refetch = os.getenv("FORCE_REFETCH") == "1"
    max_runtime_s = _env_int("MAX_RUNTIME_S", 5400)
    recheck_per_run = _env_int("RECHECK_PER_RUN", 4500)
    recheck_min_age = _env_float("RECHECK_MIN_AGE_DAYS", 7.0)
    recheck_share = min(1.0, max(0.0, _env_float("RECHECK_SHARE", 0.7)))
    max_gone_share = _env_float("RECHECK_MAX_GONE_SHARE", 0.5)
    cache_path = archived_cache.default_path()
    cache_ttl = _env_int("ARCHIVED_CACHE_TTL_DAYS", 60)

    started = time.time()
    session = BscSession()

    # Phase 1: Sitemap-Discovery
    log.info("Phase 1: sitemap-discovery …")
    all_urls = discover_all_listings(session)
    log.info("Discovery fertig: %d unique listings", len(all_urls))
    if not all_urls:
        # Gleiche Falle wie bei cre 2026-07-27 bis 2026-09-07 (Sitemaps
        # umbenannt, CI blieb 6 Wochen grün). Eine Cloudflare-Blockade oder
        # ein Format-Wechsel sieht identisch aus: 0 URLs → CI muss rot sein.
        log.error("0 Listings discovered — Abbruch (Sitemaps weg oder geblockt?)")
        return 1

    # Phase 2: Neu-Schlange (Sitemap minus bekannt) + Recheck-Schlange (DB)
    by_id: dict[str, ListingURL] = {u.listing_id: u for u in all_urls}
    recheck: list[ListingURL] = []
    recheck_meta: dict[str, dict] = {}
    if force_refetch:
        log.info("FORCE_REFETCH=1 — alle %d Listings werden gefetched", len(all_urls))
        todo: list[ListingURL] = all_urls
    else:
        log.info("Bekannte external_ids nachschlagen (Pakete à 1000) …")
        t_lookup = time.time()
        known, unresolved = lookup_known_ids(list(by_id))
        log.info("  bekannt: %d, neu: %d, ungeklärt: %d (%.1fs)",
                 len(known), len(by_id) - len(known) - len(unresolved),
                 len(unresolved), time.time() - t_lookup)
        if unresolved and len(unresolved) > len(by_id) // 2:
            # Mehr als die Hälfte nicht nachschlagbar = DB-Problem, kein
            # Grund, zehntausende Detailseiten blind neu zu holen.
            log.error("Nachschlagen für %d von %d IDs fehlgeschlagen — Abbruch",
                      len(unresolved), len(by_id))
            return 1
        cached_gone = archived_cache.load(cache_path, cache_ttl)
        todo = [u for u in all_urls
                if u.listing_id not in known and u.listing_id not in unresolved
                and u.listing_id not in cached_gone]
        log.info("Neu zu fetchen: %d von %d (%d als gelöscht gemerkt, %s)",
                 len(todo), len(all_urls), len(cached_gone), cache_path)

        rc_limit = recheck_per_run
        if max_listings and rc_limit > 0:
            rc_limit = min(rc_limit, max_listings)
        if rc_limit > 0:
            t_rc = time.time()
            try:
                cands = recheck_candidates(recheck_min_age, rc_limit)
            except Exception as e:
                # Ohne Recheck läuft der Lauf trotzdem (Neu-Schlange).
                log.warning("Recheck-Kandidaten nicht ladbar: %s", e)
                cands = []
            recheck, recheck_meta, no_url = build_recheck_items(cands, by_id)
            oldest = cands[0].get("last_seen") if cands else "-"
            log.info("Recheck: %d Kandidaten (älter als %.0f Tage, ältester last_seen %s), "
                     "%d ohne URL übersprungen (%.1fs)",
                     len(recheck), recheck_min_age, oldest, no_url, time.time() - t_rc)

    if max_listings:
        todo = todo[:max_listings]
        recheck = recheck[:max_listings]
        log.info("MAX_LISTINGS=%d aktiv → %d neu, %d Recheck", max_listings, len(todo), len(recheck))

    if not todo and not recheck:
        log.info("Nichts zu tun.")
        return 0

    # Phase 3: Detail-Fetch + Parse + pHash + Streaming-Upsert
    BATCH_SIZE = _env_int("STREAM_BATCH_SIZE", 50)
    log.info(
        "Phase 2: detail-fetch + streaming-upsert (rate %.1fs, batch %d, watchdog %ds, "
        "Recheck-Anteil %.0f %%) …",
        rate_limit, BATCH_SIZE, max_runtime_s, recheck_share * 100,
    )
    detail_started = time.time()
    batch: list[ParsedListing] = []
    total_parsed = 0
    total_skipped_archived = 0
    total_errors = 0
    rc_alive = rc_touch = rc_upsert = rc_gone = rc_errors = 0
    total_marked_stale = 0
    total_touched = 0
    gone_known: list[str] = []
    gone_new: list[str] = []
    touch_pending: list[str] = []
    gone_guard_tripped = False
    total_attempted = 0  # Zeilen, die an die Upsert-RPC gingen
    total_inserted = 0
    total_updated = 0
    total_deduped = 0
    total_failed = 0
    aborted_reason: str | None = None
    all_done = True

    def flush_batch() -> None:
        nonlocal batch, total_attempted, total_inserted, total_updated, total_deduped, total_failed
        if not batch:
            return
        if not skip_phash:
            phash_ok = 0
            for it in batch:
                cover = it.media[0] if it.media else None
                if not cover:
                    continue
                ph = compute_phash_from_url(cover)
                if ph is not None:
                    it.cover_phash = ph
                    phash_ok += 1
            log.info("  phash: %d/%d in batch", phash_ok, len(batch))
        if dry_run:
            log.info("  DRY_RUN — skip upsert (sample %s)",
                     batch[0].listing_id if batch else "")
        else:
            result = upsert_listings(batch)
            total_attempted += len(batch)
            total_inserted += int(result.get("inserted", 0))
            total_updated += int(result.get("updated", 0))
            total_deduped += int(result.get("deduped", 0))
            total_failed += len(result.get("failed", []) or [])
            log.info(
                "  flush: ins=%d upd=%d dedup=%d fail=%d (cumulative %d/%d/%d/%d)",
                result.get("inserted", 0), result.get("updated", 0),
                result.get("deduped", 0), len(result.get("failed", []) or []),
                total_inserted, total_updated, total_deduped, total_failed,
            )
        batch = []

    def flush_touch() -> None:
        nonlocal touch_pending, total_touched
        if not touch_pending:
            return
        if dry_run:
            log.info("  DRY_RUN — %d live+unverändert NICHT angetippt", len(touch_pending))
        else:
            try:
                n = touch_ids(touch_pending)
                total_touched += n
                log.info("  last_seen aufgefrischt (live, unverändert): %d von %d",
                         n, len(touch_pending))
            except Exception as e:
                log.warning("touch_ids(%d) fehlgeschlagen: %s", len(touch_pending), e)
        touch_pending = []

    def flush_gone() -> None:
        nonlocal gone_known, total_marked_stale, gone_guard_tripped
        if not gone_known:
            return
        if gone_share_exceeded(rc_gone, rc_alive, max_gone_share):
            if not gone_guard_tripped:
                log.error(
                    "NOTBREMSE: %d von %d Rechecks 'gelöscht' (> %.0f %%) — setze nichts "
                    "stale. BSC-Seitenformat/Redirects prüfen.",
                    rc_gone, rc_gone + rc_alive, max_gone_share * 100,
                )
            gone_guard_tripped = True
            gone_known = []
            return
        if dry_run:
            log.info("  DRY_RUN — %d verifiziert gelöschte NICHT stale gesetzt", len(gone_known))
        else:
            try:
                n = mark_stale_ids(gone_known)
                total_marked_stale += n
                log.info("  stale gesetzt (Detailseite: gelöscht): %d", n)
            except Exception as e:
                log.warning("mark_stale_ids(%d) fehlgeschlagen: %s", len(gone_known), e)
        gone_known = []

    t_spent = {True: 0.0, False: 0.0}
    qi = {True: 0, False: 0}
    queues = {True: recheck, False: todo}
    n_work = len(todo) + len(recheck)
    idx = 0
    while qi[True] < len(recheck) or qi[False] < len(todo):
        idx += 1
        elapsed = time.time() - started
        if elapsed > max_runtime_s:
            aborted_reason = (
                f"MAX_RUNTIME_S={max_runtime_s}s erreicht nach {elapsed:.0f}s "
                f"— sauberer Stopp bei Listing {idx}/{n_work}"
            )
            log.warning(aborted_reason)
            all_done = False
            break
        is_recheck = pick_recheck(
            t_spent[True], t_spent[False], recheck_share,
            qi[True] < len(recheck), qi[False] < len(todo),
        )
        item = queues[is_recheck][qi[is_recheck]]
        qi[is_recheck] += 1
        t0 = time.time()

        status, p = check_detail(session, item)
        if status == STATUS_ACTIVE and p is not None:
            total_parsed += 1
            if is_recheck:
                rc_alive += 1
                if needs_upsert(p, recheck_meta.get(item.listing_id)):
                    rc_upsert += 1
                    batch.append(p)
                else:
                    rc_touch += 1
                    touch_pending.append(item.listing_id)
            else:
                batch.append(p)
        elif status == STATUS_ARCHIVED:
            total_skipped_archived += 1
            if is_recheck:
                rc_gone += 1
                gone_known.append(item.listing_id)
            else:
                gone_new.append(item.listing_id)
        else:
            total_errors += 1
            if is_recheck:
                rc_errors += 1
        if len(batch) >= BATCH_SIZE:
            flush_batch()
        if len(touch_pending) >= 500:
            flush_touch()
        if len(gone_known) >= 200:
            flush_gone()
        if idx % 50 == 0:
            log.info(
                "  detail-progress %d/%d (neu %d/%d, recheck %d/%d; parsed %d, gelöscht %d, "
                "errors %d, %.1fs)",
                idx, n_work, qi[False], len(todo), qi[True], len(recheck),
                total_parsed, total_skipped_archived, total_errors,
                time.time() - detail_started,
            )
        time.sleep(rate_limit)
        t_spent[is_recheck] += time.time() - t0

    flush_batch()
    flush_touch()
    flush_gone()
    if gone_new and not dry_run:
        archived_cache.append(cache_path, gone_new)
    log.info(
        "Recheck: %d geprüft — %d live (%d angetippt, %d Upsert), %d gelöscht "
        "(%d stale gesetzt), %d Fehler; Zeit recheck/neu %.0fs/%.0fs",
        qi[True], rc_alive, rc_touch, rc_upsert, rc_gone, total_marked_stale,
        rc_errors, t_spent[True], t_spent[False],
    )
    log.info("Neu: %d geprüft, davon %d gelöscht (gemerkt, nächster Lauf überspringt)",
             qi[False], len(gone_new))
    if rc_errors and rc_errors > (rc_alive + rc_gone):
        log.warning("Recheck: mehr Fehler als Ergebnisse — Cloudflare/Netz prüfen")
    log.info(
        "Detail+Upsert-Phase fertig: %d parsed, %d archived/skip, %d ins, %d upd, "
        "%d dedup, %d failed in %.1fs",
        total_parsed, total_skipped_archived, total_inserted, total_updated,
        total_deduped, total_failed, time.time() - detail_started,
    )

    # mark_stale nur wenn vollständig
    if dry_run:
        log.info("DRY_RUN — kein mark_stale.")
    elif gone_guard_tripped:
        log.warning("mark_stale übersprungen — Notbremse ausgelöst")
    elif all_done:
        log.info("Mark stale (>14d unseen, min_recent_seen=1000) …")
        try:
            stale = _mark_stale_rpc()
            log.info("Stale-marked: %d", stale)
        except Exception as e:
            log.warning("mark_stale fehlgeschlagen (RPC-Gate?): %s", e)
    else:
        log.warning("mark_stale übersprungen — Lauf nicht vollständig (%s)",
                    aborted_reason or "siehe Errors")

    # Marktposition für die mit DEFER_MARKET_POSITION angelegten Inserate.
    # Läuft auch nach Watchdog-Abbruch; was hier scheitert, holt der
    # nächste Lauf nach (market_updated_at bleibt NULL).
    if os.getenv("DEFER_MARKET_POSITION", "").strip() == "1" and not dry_run:
        t_mp = time.time()
        try:
            mp = recompute_market_pending()
            log.info("Marktposition nachgerechnet: %s Inserate (%.1fs)",
                     mp.get("updated", 0), time.time() - t_mp)
        except Exception as e:
            log.warning("Marktposition nachrechnen fehlgeschlagen (%.1fs): %s",
                        time.time() - t_mp, e)

    log.info(
        "RESULT: ok=%s parsed=%d archived=%d inserted=%d updated=%d deduped=%d failed=%d "
        "recheck=%d touched=%d stale=%d elapsed=%.1fs aborted=%s",
        "true" if all_done else "partial",
        total_parsed, total_skipped_archived, total_inserted, total_updated,
        total_deduped, total_failed, qi[True], total_touched, total_marked_stale,
        time.time() - started, aborted_reason or "",
    )

    if gone_guard_tripped:
        return 1
    # Ein Lauf ohne Wirkung muss rot werden (2026-10-23..26: 4 Läufe/Tag
    # grün, 0 Writes, erst der Health-Check hat es nach 3 Tagen gemerkt).
    if not dry_run and total_attempted > 0:
        written = total_inserted + total_updated
        if written == 0:
            log.error("FEHLER: %d Zeilen an die DB geschickt, 0 geschrieben.",
                      total_attempted)
            return 1
        if total_failed * 2 > total_attempted:
            log.error("FEHLER: %d von %d Zeilen fehlgeschlagen (> 50 %%).",
                      total_failed, total_attempted)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
