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

from .config import PROPERTY_SUBTYPES_BY_TYPE, RATE_LIMIT_SECONDS, env_int, env_str, selected_cities, selected_types
from datetime import datetime, timezone
from .crawler import RawListing, crawl_city, crawl_detail, fetch_disallowed_paths, with_browser
from .supabase_writer import (
    fetch_already_drilled_external_ids,
    fetch_already_phashed_external_ids,
    fetch_city_last_seen,
    fetch_drill_queue_below_media,
    fetch_known_external_ids_for_city_type,
    fetch_listings_below_media,
    mark_stale_old_listings,
    touch_last_seen,
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

    if os.getenv("BACKFILL_DRILL_QUEUE") == "1":
        return _run_backfill_drill_queue(log)

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

    # Smart-Backfill: nur Listings re-drillen die zu wenig Bilder haben.
    # 0 (default) = Standard-Verhalten. >0 = Whitelist via DB-Query.
    # Sinnvoll mit FORCE_FULL_DRILL=1 — sonst greift "schon gedrillt"-Skip
    # ohnehin und Backfill macht nichts.
    redrill_below_media = env_int("REDRILL_BELOW_MEDIA", 0)

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

    # Per-City Pass-1-Cap: keine einzelne City darf mehr als CITY_MAX_PCT
    # des Pass-1-Budgets schlucken. Default 35% — bei 45min Pass-1-Budget
    # heißt das ~15min pro City. Limassol-Sale braucht historisch ~20min
    # und hat damit alle anderen Cities verhungert; mit dem Cap wird die
    # Limassol-Subtypes-Tail (plots/prefab) zurückgestellt, dafür kommen
    # Nicosia/Famagusta sicher dran.
    city_max_pct = env_int("CITY_MAX_PCT", 35)
    city_max_pct = max(15, min(100, city_max_pct))

    # FAST_MODE: incrementeller Crawl mit Smart-Stop + Pre-Touch.
    # Standard ON, aber 1×/Tag automatisch OFF im 00-UTC-Slot (Full-Crawl),
    # damit mark_stale die echten Verschwundenen sauber erkennt.
    # Override via BAZARAKI_FAST_MODE: "0" = aus, "1" = ein, "auto" = stunden-
    # basiert. Workflow-Dispatch kann FORCE_FULL_DRILL=1 setzen → impliziert
    # auch fast_mode=False.
    fast_mode_env = env_str("BAZARAKI_FAST_MODE", "auto").lower()
    if fast_mode_env == "0" or force_full_drill:
        fast_mode = False
        fast_mode_reason = "ENV=0" if fast_mode_env == "0" else "force_full_drill"
    elif fast_mode_env == "1":
        fast_mode = True
        fast_mode_reason = "ENV=1"
    else:
        # Auto: full-crawl 1×/Tag im 00:00-UTC-Slot
        utc_hour = datetime.now(timezone.utc).hour
        fast_mode = utc_hour != 0
        fast_mode_reason = f"auto (UTC-Stunde={utc_hour})"
    log.info("FAST_MODE: %s (%s)", "ON" if fast_mode else "OFF", fast_mode_reason)

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
    # Per-City wall-clock-Budget (auf Pass-1 bezogen). Wird bei der ersten
    # Subtype dieser City als Startzeit gesetzt und limit greift sobald die
    # City `city_max_seconds` an Wall-Clock akkumuliert hat.
    pass1_budget_s = max(1, list_deadline_at - int(started))
    city_max_seconds = pass1_budget_s * city_max_pct / 100.0
    log.info(
        "Per-City Pass-1-Cap: %d%% von %ds = %.0fs pro City",
        city_max_pct, pass1_budget_s, city_max_seconds,
    )
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
    # Per-City Tracking: erste Subtype dieser City setzt den Start-Timestamp.
    # Sobald city_max_seconds überschritten, wird die City in capped_cities
    # aufgenommen und alle folgenden Subtypes werden geskippt.
    city_start_times: dict[str, float] = {}
    capped_cities: set[str] = set()

    # FAST_MODE Pre-Step: pro (City, Type) bekannte external_ids holen +
    # bulk-Touch last_seen. Damit kann crawl_city Smart-Stop machen, ohne
    # dass mark_stale die übersprungenen Listings fälschlich killt. Wir
    # touchen JETZT — selbst wenn der Job danach crasht, ist last_seen frisch.
    known_ids_by_city_type: dict[tuple[str, str], set[str]] = {}
    if fast_mode:
        log.info("=== FAST_MODE: Pre-Touch bekannter Listings ===")
        for city in cities_sorted:
            for ltype in types:
                key = (city.display, ltype)
                try:
                    ids = fetch_known_external_ids_for_city_type(city.display, ltype)
                except Exception as e:
                    log.warning("fetch_known(%s, %s) failed: %s — skip touch", city.display, ltype, e)
                    ids = set()
                known_ids_by_city_type[key] = ids
                if not ids:
                    continue
                try:
                    touched = touch_last_seen(list(ids))
                    log.info(
                        "  pre-touch %s/%s: %d known, %d touched",
                        city.display, ltype, len(ids), touched,
                    )
                except Exception as e:
                    log.warning("touch_last_seen(%s, %s) failed: %s", city.display, ltype, e)

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

                # Per-City Cap: skipt restliche Subtypes dieser City, sobald
                # ihr Wall-Clock-Budget verbraucht ist. Wichtig: Skip ist
                # silent (kein break) — so kommen nachfolgende Cities dran.
                if city.display in capped_cities:
                    continue
                if city.display not in city_start_times:
                    city_start_times[city.display] = time.time()
                city_elapsed = time.time() - city_start_times[city.display]
                if city_elapsed > city_max_seconds:
                    log.warning(
                        "  city-cap: %s hat %.0fs verbraucht (max %.0fs) — "
                        "skip restliche Subtypes dieser City",
                        city.display, city_elapsed, city_max_seconds,
                    )
                    capped_cities.add(city.display)
                    list_phase_complete = False
                    continue

                tag = f"{city.display}/{listing_type}/{subtype}"
                log.info(
                    "  list %s (elapsed %.0fs, city %.0fs/%.0fs, budget left %.0fs)",
                    tag, elapsed, city_elapsed, city_max_seconds,
                    effective_deadline - time.time(),
                )
                try:
                    items = list(crawl_city(
                        browser, city, listing_type, subtype, disallowed,
                        deadline_at=effective_deadline,
                        known_ids=(
                            known_ids_by_city_type.get((city.display, listing_type))
                            if fast_mode else None
                        ),
                    ))
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
                # Smart-Backfill-Whitelist: wenn REDRILL_BELOW_MEDIA gesetzt,
                # nur die external_ids re-drillen, deren media-Array unter der
                # Schwelle liegt. Sonst (default 0) → leere Whitelist = kein Filter.
                redrill_whitelist: set[str] | None = None
                if redrill_below_media > 0:
                    log.info(
                        "Smart-Backfill: hole external_ids mit media < %d ...",
                        redrill_below_media,
                    )
                    redrill_whitelist = fetch_listings_below_media(redrill_below_media)
                    log.info(
                        "Smart-Backfill: %d Listings sind unter Schwelle — Drill nur für diese",
                        len(redrill_whitelist),
                    )

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
                        # Smart-Backfill: zusätzlich auf Whitelist filtern.
                        # Greift orthogonal zu force_full_drill — Backfill-Run
                        # nutzt typisch BEIDE (force_full_drill + redrill_below).
                        if redrill_whitelist is not None:
                            before = len(to_drill)
                            to_drill = [it for it in to_drill if it.external_id in redrill_whitelist]
                            if before != len(to_drill):
                                log.info(
                                    "    smart-backfill: %d → %d (übersprungen: %d schon gut)",
                                    before, len(to_drill), before - len(to_drill),
                                )
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

    # mark_stale nur bei vollständigem List-Pass UND NICHT im FAST_MODE.
    # FAST_MODE hat per Pre-Touch alle bekannten Listings blind gerefresht
    # → mark_stale würde nichts finden (alle frisch) und echte verschwundene
    # Listings nie aussortieren. Die 1×/Tag Full-Crawl (fast_mode=False,
    # 00 UTC) macht das stattdessen.
    if dry_run:
        log.info("DRY_RUN — kein mark_stale.")
    elif fast_mode:
        log.info(
            "mark_stale übersprungen — FAST_MODE (Pre-Touch hat alle bekannten "
            "gerefresht). Full-Crawl im 00-UTC-Slot übernimmt Stale-Detection."
        )
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


def _run_backfill_drill_queue(log: logging.Logger) -> int:
    """Standalone-Backfill: lädt direkt aus DB Listings mit media < threshold,
    rekonstruiert RawListing-Objekte aus extracted_data.source_url und feuert
    NUR den Detail-Drill (kein Pass 1, kein mark_stale, kein pHash).

    Hintergrund: Pass 2 im regulären Crawl läuft nur über Listings die Pass 1
    im selben Run frisch gesammelt hat. Listings die in einem alten Run wegen
    Budget-Stop nur Cover-Bild bekommen haben, werden vom regulären Cron nie
    wieder besucht (sie tauchen auf den ersten 60 Pages nicht mehr auf).
    Dieser Modus schließt diese Lücke.

    Env:
      BACKFILL_DRILL_QUEUE=1     Aktiviert diesen Modus.
      BACKFILL_THRESHOLD=3       media-Länge unter der re-drilled wird (default 3).
      BACKFILL_LIMIT=             Max Listings pro Run (default 0 = unbegrenzt).
                                  Watchdog MAX_RUNTIME_S greift zusätzlich.
      MAX_RUNTIME_S=              Wall-Clock-Cap (default 5400 = 90min).
    """
    from .crawler import RawListing, crawl_detail, with_browser

    threshold = env_int("BACKFILL_THRESHOLD", 3)
    limit_raw = env_int("BACKFILL_LIMIT", 0)
    limit: int | None = limit_raw if limit_raw > 0 else None
    max_runtime_s = env_int("MAX_RUNTIME_S", 90 * 60)
    dry_run = os.getenv("DRY_RUN") == "1"

    log.info(
        "BACKFILL_DRILL_QUEUE: threshold=%d, limit=%s, MAX_RUNTIME_S=%ds",
        threshold, limit if limit else "unlimited", max_runtime_s,
    )

    log.info("Lade Drill-Queue aus DB …")
    queue = fetch_drill_queue_below_media(threshold, limit=limit)
    log.info("Queue: %d Listings (media < %d, source_url vorhanden)", len(queue), threshold)
    if not queue:
        log.info("Nichts zu tun.")
        return 0

    items: list[RawListing] = [
        RawListing(
            external_id=q["external_id"],
            listing_type=q["listing_type"] or "rent",
            city=q["city"] or "",
            price=float(q["price"]) if q["price"] is not None else 0.0,
            rooms=q["rooms"],
            image_url=q["image_url"],
            title=q["title"],
            detail_url=q["source_url"],
            property_type=q.get("property_type"),
        )
        for q in queue
    ]

    started = time.time()
    deadline_at = started + max_runtime_s
    ok = 0
    failed = 0
    upserted = 0
    inserted = updated = deduped = 0

    with with_browser() as p:
        browser = p.chromium.launch(headless=True)
        try:
            # Batch-Upserts alle 50 Drills — kein "1 RPC pro Listing", aber auch
            # nicht "alles am Ende" (Verlust bei Crash).
            BATCH_SIZE = 50
            batch: list[RawListing] = []

            for idx, it in enumerate(items, start=1):
                if time.time() > deadline_at:
                    log.warning(
                        "BACKFILL: Budget erreicht bei %d/%d (%.0fs) — stop",
                        idx - 1, len(items), time.time() - started,
                    )
                    break
                try:
                    crawl_detail(browser, it)
                except Exception as e:
                    failed += 1
                    log.warning("  drill-fail %s: %s", it.external_id, e)
                    continue

                # Erfolg = mehr Bilder als vorher. Dünn-bleibende Listings
                # (Detail-Page selbst hat <3 Bilder) zählen wir nicht als ok,
                # aber wir upserten sie trotzdem damit dedup_hash etc. frisch sind.
                if len(it.media) >= threshold:
                    ok += 1
                batch.append(it)

                if idx % 25 == 0:
                    log.info(
                        "  progress %d/%d (ok %d, fail %d, %.0fs)",
                        idx, len(items), ok, failed, time.time() - started,
                    )

                if len(batch) >= BATCH_SIZE:
                    if not dry_run:
                        try:
                            r = upsert_listings(batch)
                            inserted += int(r.get("inserted", 0))
                            updated += int(r.get("updated", 0))
                            deduped += int(r.get("deduped", 0))
                            upserted += len(batch)
                        except Exception as e:
                            log.warning("  batch-upsert fail: %s", e)
                    batch = []

                time.sleep(RATE_LIMIT_SECONDS)

            # Tail-Batch
            if batch and not dry_run:
                try:
                    r = upsert_listings(batch)
                    inserted += int(r.get("inserted", 0))
                    updated += int(r.get("updated", 0))
                    deduped += int(r.get("deduped", 0))
                    upserted += len(batch)
                except Exception as e:
                    log.warning("  tail-upsert fail: %s", e)
        finally:
            browser.close()

    elapsed = time.time() - started
    log.info(
        "BACKFILL ENDE: %d/%d gedrillt mit media>=%d, %d failed, %d upserted "
        "(ins=%d upd=%d dedup=%d) in %.0fs",
        ok, len(items), threshold, failed, upserted, inserted, updated, deduped, elapsed,
    )
    log.info(
        "RESULT: ok=true mode=backfill items=%d drilled_ok=%d failed=%d "
        "upserted=%d inserted=%d updated=%d deduped=%d elapsed=%.0fs",
        len(items), ok, failed, upserted, inserted, updated, deduped, elapsed,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
