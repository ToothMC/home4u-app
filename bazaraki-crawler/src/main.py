"""Entry-Point: orchestriert robots.txt → 2-Pass-Crawl pro (city, type, subtype) → Streaming-Upsert.

Architektur (2-Pass, Inzident 2026-05-06):

  Pass 1 (List, billig, breit): Für JEDEN (city, type, subtype) im Plan eine List-Page
    laufen. Jedes gefundene Listing wird sofort upgeserted — vor allem `last_seen`
    wird aktualisiert. Dieses Pass MUSS für alle Cities durchlaufen, sonst
    weiß der Stale-Sweep nicht welche Listings noch leben.

  Pass 2 (Drill+pHash, teuer, schmal): Über die in Pass 1 gesammelten Items
    iterieren — Detailseite ziehen + Cover-pHash. Sortierung in Plan-Reihenfolge
    (cities_sorted nach Freshness, älteste zuerst). Wenn Budget weg → break,
    aber Pass 1 ist da längst durch.

Vorgängerversion (1-Pass) hat Pass 1 und Pass 2 verzahnt: für jeden Subtype
erst List, dann sofort Drill, dann Upsert. Folge: Drill von Limassol/sale
verschluckt das gesamte 90-Min-Budget (728 Detail-Pages × 0.5s rate-limit ≈
6 Min pro 720 Items, plus pHash, plus Page-Loads), bevor Paphos/Larnaca/Nicosia/
Famagusta jemals erreicht werden. Die übersprungenen Cities haben kein
last_seen-Update gekriegt, der nächste Stale-Sweep hat sie pauschal als tot
markiert: 18.946 Listings auf einmal stale. Mit 2-Pass: List-Phase ist billig
(~5-10 Min für alle 35 Subtypes), Drill kann sich danach in Ruhe das Budget
auffressen — ohne dass der Stale-Sweep dadurch in die Irre läuft.

Watchdog: MAX_RUNTIME_S (default 4h) wird via `deadline_at` an alle inneren
Loops weitergereicht. Pass 1 hat wenige Sekunden Reaktionszeit, Pass 2 bricht
nach dem aktuellen Drill-Item ab. Bei Budget-Stop ist der List-Pass i.d.R.
durch — `list_phase_complete=True` → mark_stale darf laufen.

mark_stale läuft nur wenn Pass 1 komplett war. Zusätzlich schützen Guards
in der RPC (siehe migration 20260506110000_safe_stale_sweep.sql) gegen
"Crawler hat nichts gefunden, sweep killt alles" — Cap bei 10% des active-
Bestands, abort bei <p_min_recent_seen Listings/24h.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from collections import defaultdict

from dotenv import load_dotenv

from .config import PROPERTY_SUBTYPES_BY_TYPE, RATE_LIMIT_SECONDS, env_int, selected_cities, selected_types
from .crawler import RawListing, crawl_city, crawl_detail, fetch_disallowed_paths, with_browser
from .supabase_writer import (
    fetch_already_drilled_external_ids,
    fetch_already_phashed_external_ids,
    fetch_city_last_seen,
    mark_stale_old_listings,
    upsert_listings,
)


def _setup_logging() -> None:
    level = logging.INFO if not os.getenv("DEBUG") else logging.DEBUG
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def main() -> int:
    load_dotenv()
    _setup_logging()
    log = logging.getLogger("crawler")

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein (siehe .env.example)")
        return 1

    cities = selected_cities()
    types = selected_types()
    log.info(
        "Crawl-Plan: cities=%s, types=%s, subtypes=%s",
        [c.display for c in cities],
        types,
        {t: PROPERTY_SUBTYPES_BY_TYPE[t] for t in types},
    )

    log.info("Lade robots.txt …")
    disallowed = fetch_disallowed_paths()
    log.info("Disallow-Pfade: %d", len(disallowed))

    skip_details = os.getenv("SKIP_DETAILS") == "1"
    force_full_drill = os.getenv("FORCE_FULL_DRILL") == "1"
    skip_phash = os.getenv("SKIP_PHASH") == "1"
    force_rephash = os.getenv("FORCE_REPHASH") == "1"
    dry_run = os.getenv("DRY_RUN") == "1"

    # Watchdog: stoppt vor dem nächsten Subtype/Drill-Item, wenn Wall-Clock das
    # Budget überschreitet. Default 4h — gibt dem Workflow 240min Headroom unter
    # dem GH-Free-Cap (350) für sauberen exit 0.
    max_runtime_s = env_int("MAX_RUNTIME_S", 240 * 60)
    log.info("MAX_RUNTIME_S=%ds (~%.1fh)", max_runtime_s, max_runtime_s / 3600.0)

    # Pass-1-Cap (optional): wieviel des Gesamtbudgets darf Pass 1 maximal
    # verbrauchen, bevor wir in Pass 2 wechseln? Default 50%. Schutz für den
    # pathologischen Fall, dass List-Pagination unerwartet langsam ist —
    # wir wollen mindestens noch etwas Drill-Zeit haben.
    list_phase_pct = env_int("LIST_PHASE_PCT", 50)
    list_phase_pct = max(10, min(100, list_phase_pct))

    # Sets einmal am Anfang ziehen — danach lokal mitführen, damit nachfolgende
    # Subtypes nicht doppelt drillen/hashen wenn ein Listing in mehreren City-
    # Subtype-Buckets auftaucht (passiert bei border-Locations selten, schadet
    # aber nicht).
    if skip_details or force_full_drill:
        drilled_ids: set[str] = set()
    else:
        log.info("Frage bereits gedrillte external_ids ab …")
        drilled_ids = fetch_already_drilled_external_ids()
        log.info("Schon gedrillt: %d", len(drilled_ids))

    if skip_phash or force_rephash:
        phashed_ids: set[str] = set()
    else:
        log.info("Frage bereits gehashte external_ids ab …")
        phashed_ids = fetch_already_phashed_external_ids()
        log.info("Schon gehasht: %d", len(phashed_ids))

    started = time.time()
    deadline_at = started + max_runtime_s
    list_deadline_at = started + int(max_runtime_s * list_phase_pct / 100)
    grand_totals = {
        "inserted": 0, "updated": 0, "deduped": 0, "failed": 0,
        "items": 0, "list_subtypes": 0, "drill_subtypes": 0,
    }
    per_city_counts: dict[tuple[str, str], int] = defaultdict(int)

    # Plan nach Freshness sortieren: Cities mit ältestem last_seen zuerst.
    # Wenn Pass 2 mid-run kappt, werden die wichtigsten Drill-Lücken zuerst
    # geschlossen. Cities ohne Daten → ältest = "epoch", erste Position.
    log.info("Hole City-Freshness für Plan-Sortierung …")
    city_last_seen = fetch_city_last_seen()
    cities_sorted = sorted(
        cities,
        key=lambda c: city_last_seen.get(c.display) or "1970-01-01T00:00:00+00",
    )
    log.info(
        "City-Reihenfolge nach Freshness: %s",
        [(c.display, city_last_seen.get(c.display) or "never") for c in cities_sorted],
    )
    plan = [(c, t, s) for c in cities_sorted for t in types for s in PROPERTY_SUBTYPES_BY_TYPE[t]]
    log.info("Plan: %d (city, type, subtype)-Tupel", len(plan))
    log.info(
        "Pass-1-Budget: %ds (%d%% von %ds), danach Pass-2 mit Restbudget",
        list_deadline_at - int(started), list_phase_pct, max_runtime_s,
    )

    # collected[(city, type, subtype)] = list[RawListing] — Pass 1 füllt,
    # Pass 2 iteriert. Reihenfolge bleibt dict-insert-order = plan-order.
    collected: dict[tuple, list[RawListing]] = {}
    list_phase_complete = True
    aborted_reason: str | None = None

    with with_browser() as p:
        browser = p.chromium.launch(headless=True)
        try:
            # ────────────────────────────────────────────────────────────────
            # PASS 1: List-Phase für ALLE Subtypes. Schnell, billig.
            # Hauptzweck: last_seen für alle aktuell-existierenden Listings
            # auffrischen, damit der Stale-Sweep ein korrektes Bild hat.
            # ────────────────────────────────────────────────────────────────
            log.info("=== PASS 1: List-Phase (%d Subtypes) ===", len(plan))
            for city, listing_type, subtype in plan:
                elapsed = time.time() - started
                # Pass-1-Budget hat Vorrang vor Gesamt-Budget — wir wollen
                # rechtzeitig Pass 2 anfangen, nicht erst wenn alles weg ist.
                effective_deadline = min(list_deadline_at, deadline_at)
                if time.time() > effective_deadline:
                    aborted_reason = (
                        f"PASS 1 abort: Budget nach {elapsed:.0f}s erreicht "
                        f"vor {city.display}/{listing_type}/{subtype}"
                    )
                    log.warning(aborted_reason)
                    list_phase_complete = False
                    break

                tag = f"{city.display}/{listing_type}/{subtype}"
                log.info(
                    "  list %s (elapsed %.0fs, list-budget left %.0fs)",
                    tag, elapsed, effective_deadline - time.time(),
                )
                try:
                    items = list(crawl_city(browser, city, listing_type, subtype, disallowed,
                                            deadline_at=effective_deadline))
                except Exception as e:
                    log.exception("    List für %s gecrasht: %s — überspringe Subtype", tag, e)
                    list_phase_complete = False
                    continue

                per_city_counts[(city.display, listing_type)] += len(items)
                grand_totals["items"] += len(items)

                if not items:
                    log.info("    %s: 0 items", tag)
                    grand_totals["list_subtypes"] += 1
                    if time.time() > effective_deadline:
                        aborted_reason = f"PASS 1 abort: Budget während List {tag}"
                        log.warning(aborted_reason)
                        list_phase_complete = False
                        break
                    continue

                collected[(city, listing_type, subtype)] = items

                # Streaming-Upsert mit List-Page-Fields (insb. last_seen).
                # Pass 2 wird die gleichen Items nochmal upserten, dann mit
                # district/size_sqm/cover_phash. RPC merged via COALESCE.
                if dry_run:
                    log.info("    DRY_RUN — kein List-Upsert (sample %s)", items[0].external_id)
                else:
                    try:
                        result = upsert_listings(items)
                        grand_totals["inserted"] += int(result.get("inserted", 0))
                        grand_totals["updated"] += int(result.get("updated", 0))
                        grand_totals["deduped"] += int(result.get("deduped", 0))
                        grand_totals["failed"] += len(result.get("failed", []) or [])
                        log.info(
                            "    list-flush: %d items → ins=%d upd=%d dedup=%d fail=%d",
                            len(items),
                            result.get("inserted", 0), result.get("updated", 0),
                            result.get("deduped", 0), len(result.get("failed", []) or []),
                        )
                    except Exception as e:
                        log.exception("    List-Upsert für %s gecrasht: %s", tag, e)
                        list_phase_complete = False
                        continue

                grand_totals["list_subtypes"] += 1

            log.info(
                "PASS 1 Ende: %d/%d Subtypes durch, %d items in %.1fs",
                grand_totals["list_subtypes"], len(plan),
                grand_totals["items"], time.time() - started,
            )

            # ────────────────────────────────────────────────────────────────
            # PASS 2: Drill+pHash über die in Pass 1 gesammelten Items.
            # Reihenfolge = plan-Reihenfolge = cities_sorted nach Freshness.
            # ────────────────────────────────────────────────────────────────
            if skip_details and skip_phash:
                log.info("PASS 2 übersprungen (SKIP_DETAILS=1 + SKIP_PHASH=1).")
            elif not collected:
                log.info("PASS 2 übersprungen (Pass 1 hat keine items gesammelt).")
            else:
                total_pass2_items = sum(len(v) for v in collected.values())
                log.info(
                    "=== PASS 2: Drill+pHash (%d Subtypes, %d items, budget left %.0fs) ===",
                    len(collected), total_pass2_items, deadline_at - time.time(),
                )
                for (city, listing_type, subtype), items in collected.items():
                    elapsed = time.time() - started
                    if time.time() > deadline_at:
                        aborted_reason = (
                            f"PASS 2 abort: Budget nach {elapsed:.0f}s erreicht "
                            f"vor {city.display}/{listing_type}/{subtype}"
                        )
                        log.warning(aborted_reason)
                        break

                    tag = f"{city.display}/{listing_type}/{subtype}"
                    log.info(
                        "  drill %s (elapsed %.0fs, budget left %.0fs)",
                        tag, elapsed, deadline_at - time.time(),
                    )

                    drill_aborted = False
                    drilled_in_subtype = 0
                    if not skip_details:
                        if force_full_drill:
                            to_drill = items
                        else:
                            to_drill = [it for it in items if it.external_id not in drilled_ids]
                        if to_drill:
                            log.info("    drill: %d/%d neue (rate-limit %ds)",
                                     len(to_drill), len(items), RATE_LIMIT_SECONDS)
                            drill_started = time.time()
                            ok = 0
                            for idx, it in enumerate(to_drill, start=1):
                                if time.time() > deadline_at:
                                    drill_aborted = True
                                    aborted_reason = (
                                        f"PASS 2 abort: Budget während Drill {tag} "
                                        f"({idx - 1}/{len(to_drill)} drilled)"
                                    )
                                    log.warning(
                                        "    drill: budget reached at %d/%d — break",
                                        idx - 1, len(to_drill),
                                    )
                                    break
                                try:
                                    crawl_detail(browser, it)
                                except Exception as e:
                                    log.warning("      drill-fail %s: %s", it.external_id, e)
                                    continue
                                if it.district or it.size_sqm:
                                    ok += 1
                                drilled_ids.add(it.external_id)
                                drilled_in_subtype += 1
                                if idx % 25 == 0:
                                    log.info(
                                        "      drill-progress %d/%d (ok %d, %.1fs)",
                                        idx, len(to_drill), ok, time.time() - drill_started,
                                    )
                                time.sleep(RATE_LIMIT_SECONDS)
                            log.info(
                                "    drill: %d/%d enriched in %.1fs",
                                ok, len(to_drill), time.time() - drill_started,
                            )

                    # pHash: nur neue (oder force_rephash). Auch bei drill_aborted
                    # weglassen — wir wollen aus Pass 2 raus, nicht noch HTTP-GETs
                    # auf Cover-URLs absetzen.
                    phashed_in_subtype = 0
                    if not skip_phash and not drill_aborted:
                        from .dedup import compute_phash_from_url
                        if force_rephash:
                            phash_candidates = [it for it in items if it.cover_phash is None]
                        else:
                            phash_candidates = [
                                it for it in items
                                if it.cover_phash is None and it.external_id not in phashed_ids
                            ]
                        if phash_candidates:
                            phash_started = time.time()
                            for it in phash_candidates:
                                if time.time() > deadline_at:
                                    aborted_reason = aborted_reason or (
                                        f"PASS 2 abort: Budget während pHash {tag}"
                                    )
                                    log.warning("      phash: budget reached — break")
                                    drill_aborted = True
                                    break
                                cover = (it.media[0] if it.media else it.image_url)
                                if not cover:
                                    continue
                                try:
                                    ph = compute_phash_from_url(cover)
                                except Exception as e:
                                    log.warning("      phash-fail %s: %s", it.external_id, e)
                                    continue
                                if ph is not None:
                                    it.cover_phash = ph
                                    phashed_ids.add(it.external_id)
                                    phashed_in_subtype += 1
                            log.info(
                                "    phash: %d/%d in %.1fs",
                                phashed_in_subtype, len(phash_candidates),
                                time.time() - phash_started,
                            )

                    # Re-Upsert mit angereicherten Feldern. Nur wenn was passiert ist —
                    # sonst sparen wir den DB-Roundtrip.
                    if not dry_run and (drilled_in_subtype > 0 or phashed_in_subtype > 0):
                        try:
                            result = upsert_listings(items)
                            grand_totals["inserted"] += int(result.get("inserted", 0))
                            grand_totals["updated"] += int(result.get("updated", 0))
                            grand_totals["deduped"] += int(result.get("deduped", 0))
                            grand_totals["failed"] += len(result.get("failed", []) or [])
                            log.info(
                                "    drill-flush: %d items → ins=%d upd=%d dedup=%d fail=%d",
                                len(items),
                                result.get("inserted", 0), result.get("updated", 0),
                                result.get("deduped", 0), len(result.get("failed", []) or []),
                            )
                        except Exception as e:
                            log.exception("    Drill-Upsert für %s gecrasht: %s", tag, e)

                    grand_totals["drill_subtypes"] += 1

                    # Wenn Drill self-aborted hat (Budget weg), bringt es nichts
                    # zur nächsten City zu springen — die rennt sofort ins gleiche
                    # Limit. Sauber raus aus Pass 2.
                    if drill_aborted:
                        break
        finally:
            browser.close()

    log.info(
        "Crawl-Ende: %d items in %.1fs (list %d/%d, drill %d/%d Subtypes)",
        grand_totals["items"], time.time() - started,
        grand_totals["list_subtypes"], len(plan),
        grand_totals["drill_subtypes"], len(collected),
    )
    for (city, t), n in sorted(per_city_counts.items()):
        log.info("  %s/%s: %d", city, t, n)

    # mark_stale nur bei vollständigem List-Pass — sonst markieren wir Cities
    # als stale, die im aktuellen Run nie erreicht wurden. Zusätzlich schützen
    # die RPC-Guards (10% Cap, p_min_recent_seen) gegen Restrisiko.
    if dry_run:
        log.info("DRY_RUN — kein mark_stale.")
    elif list_phase_complete:
        log.info("Mark stale (>3d unseen) …")
        try:
            stale = mark_stale_old_listings(stale_days=3)
            log.info("Stale-marked: %d", stale)
        except Exception as e:
            # RPC-Guards können hier ABORTen (z.B. wenn doch Crawler-Lücke
            # erkannt wird) — das ist by design, nicht Fehler dieses Runs.
            log.warning("mark_stale RPC abort/fail: %s", e)
    else:
        log.warning(
            "mark_stale übersprungen — List-Pass nicht vollständig (%s)",
            aborted_reason or "siehe Subtype-Errors oben",
        )

    log.info(
        "RESULT: ok=%s items=%d inserted=%d updated=%d deduped=%d failed=%d "
        "list=%d/%d drill=%d/%d aborted=%s",
        "true" if list_phase_complete else "partial",
        grand_totals["items"], grand_totals["inserted"], grand_totals["updated"],
        grand_totals["deduped"], grand_totals["failed"],
        grand_totals["list_subtypes"], len(plan),
        grand_totals["drill_subtypes"], len(collected),
        aborted_reason or "",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
