"""Entry-Point: orchestriert CDP-Attach → Tab-Scan → Klassifikator → Extraktor → Upsert.

Modi:
  --once     Ein einziger Scan-Pass über alle aktuell offenen Group-Tabs
  --watch    Endlosschleife mit POLL_INTERVAL_SECONDS Pause; Ctrl-C beendet
  (default = --once)
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time

from dotenv import load_dotenv

from . import config
from .cdp_attach import attached_browser, extract_posts_from_page, list_group_pages
from .classify import classify_posts
from .dedup import filter_unseen, mark_classified, mark_upserted, open_state, stats
from .extract import extract_listing
from .supabase_writer import UpsertItem, mark_stale_old_listings, upsert_fb_listings


def _setup_logging() -> None:
    level = logging.INFO if not os.getenv("DEBUG") else logging.DEBUG
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def _check_env(log: logging.Logger) -> bool:
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein (siehe .env.example)")
        return False
    if not os.getenv("ANTHROPIC_API_KEY") and not config.SKIP_LLM:
        log.error("ANTHROPIC_API_KEY fehlt (oder SKIP_LLM=1 setzen)")
        return False
    return True


def _scan_pass(log: logging.Logger, conn) -> dict[str, int]:
    """Ein Pass: Tabs scannen → neue Posts klassifizieren → rent/sale extrahieren → upserten."""
    counts = {
        "tabs": 0, "raw_posts": 0, "new_posts": 0,
        "classified_rent": 0, "classified_sale": 0,
        "classified_wanted": 0, "classified_other": 0,
        "extracted_ok": 0, "extracted_skip": 0,
        "upsert_inserted": 0, "upsert_updated": 0, "upsert_opted_out": 0,
    }

    with attached_browser(config.CDP_PORT) as (_, browser):
        tabs = list_group_pages(browser)
        counts["tabs"] = len(tabs)
        if not tabs:
            log.info("Kein offener FB-Group-Tab gefunden — nichts zu tun.")
            return counts

        # Group-Tabs einsammeln + parallel parsen
        all_posts = []  # (RawPost, GroupConfig)
        for page, group in tabs:
            log.info("→ Tab %s (Gruppe %s, Stadt %s)", page.url[:80], group.name, group.city)
            posts = extract_posts_from_page(page)
            log.info("  %d Posts im DOM", len(posts))
            for p in posts:
                all_posts.append((p, group))

        counts["raw_posts"] = len(all_posts)
        if not all_posts:
            return counts

        # Dedup gegen seen-State
        post_ids = [p.post_id for p, _ in all_posts]
        unseen_ids = filter_unseen(conn, post_ids)
        unseen = [(p, g) for p, g in all_posts if p.post_id in unseen_ids]
        counts["new_posts"] = len(unseen)
        log.info("Neu seit letztem Scan: %d/%d", len(unseen), len(all_posts))

        if not unseen:
            return counts

        # Klassifikator
        if config.SKIP_LLM:
            log.info("SKIP_LLM=1 — überspringe Klassifikator/Extraktor/Upsert")
            for p, _ in unseen:
                log.debug("[skip-llm] %s: %s…", p.post_id, p.text[:120].replace("\n", " "))
            return counts

        log.info("Klassifiziere %d Posts (Haiku 4.5) …", len(unseen))
        classifications = classify_posts([p for p, _ in unseen])
        cls_by_id = {c.post_id: c for c in classifications}

        # Mark all classified in state, count categories
        to_extract: list[tuple] = []  # (RawPost, GroupConfig, Classification)
        for p, g in unseen:
            c = cls_by_id.get(p.post_id)
            if c is None:
                continue
            counts[f"classified_{c.category}"] = counts.get(f"classified_{c.category}", 0) + 1
            mark_classified(conn, p.post_id, c.category)
            if c.category in ("rent", "sale") and c.confidence >= 0.6:
                to_extract.append((p, g, c))

        if not to_extract:
            log.info("Keine rent/sale-Inserate in diesem Pass.")
            return counts

        # Extraktor: pro Post ein Call
        log.info("Extrahiere %d rent/sale-Inserate (Haiku 4.5) …", len(to_extract))
        upsert_items: list[UpsertItem] = []
        language_by_id: dict[str, str] = {}
        for p, g, c in to_extract:
            ext = extract_listing(p, c, city_hint=g.city)
            if ext is None:
                counts["extracted_skip"] += 1
                continue
            counts["extracted_ok"] += 1
            upsert_items.append(UpsertItem(post=p, extraction=ext))
            if c.language in ("de", "en", "ru", "el"):
                language_by_id[p.post_id] = c.language

        if not upsert_items:
            return counts

        if config.DRY_RUN:
            log.info("DRY_RUN=1 — kein Supabase-Write. %d Items würden upserted.", len(upsert_items))
            return counts

        log.info("Bulk-Upsert %d Items …", len(upsert_items))
        result = upsert_fb_listings(upsert_items, language_by_post_id=language_by_id)
        counts["upsert_inserted"] = result.get("inserted", 0)
        counts["upsert_updated"] = result.get("updated", 0)
        counts["upsert_opted_out"] = result.get("opted_out", 0)

        # State: nur upserted_at setzen für Items, die NICHT in failed[] sind
        failed_indices = {f.get("index") for f in result.get("failed", [])}
        for idx, it in enumerate(upsert_items):
            if idx not in failed_indices:
                mark_upserted(conn, it.post.post_id)

        if result.get("failed"):
            log.warning("Upsert-Fehler: %s", result["failed"][:5])

    return counts


def _log_counts(log: logging.Logger, counts: dict[str, int]) -> None:
    parts = [f"{k}={v}" for k, v in counts.items() if v]
    log.info("Pass-Stats: %s", ", ".join(parts) or "(leer)")


_stop_requested = False


def _install_sigint_handler() -> None:
    def handler(signum, frame):
        global _stop_requested
        _stop_requested = True
        print("\n[Ctrl-C] Beende nach aktuellem Pass …")
    signal.signal(signal.SIGINT, handler)


def main() -> int:
    load_dotenv()
    _setup_logging()
    log = logging.getLogger("fb-crawler")

    parser = argparse.ArgumentParser(description="Home4U FB-Crawler (CDP-Attach)")
    parser.add_argument("--watch", action="store_true", help="Endlos-Polling (Ctrl-C beendet)")
    parser.add_argument("--once", action="store_true", help="Ein einziger Pass (Default)")
    parser.add_argument("--mark-stale", action="store_true",
                        help="Nach Pass: stale-Listings markieren (>14d unseen)")
    args = parser.parse_args()

    if not _check_env(log):
        return 1

    groups = config.selected_groups()
    if not groups:
        log.warning(
            "Keine Gruppen aktiv. Pflege src/groups.json (REPLACE_ME_* ersetzen) "
            "oder setze GROUP_IDS / CITIES."
        )
        # Trotzdem laufen — wir erkennen Tabs auch ohne Filter (find_group_for_path)

    log.info(
        "Konfig: cities=%s, cdp_port=%d, dry_run=%s, skip_llm=%s, state=%s",
        sorted({g.city for g in groups}) or "(alle)",
        config.CDP_PORT, config.DRY_RUN, config.SKIP_LLM, config.STATE_DB_PATH,
    )

    _install_sigint_handler()

    with open_state(config.STATE_DB_PATH) as conn:
        if args.watch:
            log.info("Watch-Modus: Pass alle %ds. Ctrl-C beendet.", config.POLL_INTERVAL_SECONDS)
            while not _stop_requested:
                try:
                    counts = _scan_pass(log, conn)
                    _log_counts(log, counts)
                except Exception as e:
                    log.exception("Pass fehlgeschlagen: %s", e)
                if _stop_requested:
                    break
                time.sleep(config.POLL_INTERVAL_SECONDS)
        else:
            counts = _scan_pass(log, conn)
            _log_counts(log, counts)

        log.info("State-Stats: %s", stats(conn))

        if args.mark_stale:
            log.info("Mark stale (>14d unseen) …")
            n = mark_stale_old_listings(stale_days=14)
            log.info("Stale-marked: %d", n)

    return 0


if __name__ == "__main__":
    sys.exit(main())
