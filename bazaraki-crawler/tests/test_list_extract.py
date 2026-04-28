"""Regression test: LIST_EXTRACT_JS muss beide Bazaraki-Pagination-Layouts handhaben.

Hintergrund:
- Page 1 enthält BOTH `li[itemtype*="Product"]` (organische schema.org-Cards)
  UND `.advert.js-item-listing` (organisch + promoted).
- Page 2+ enthält NUR `.advert.js-item-listing`, kein schema.org-Markup.

Vor 2026-04-28 nutzte LIST_EXTRACT_JS nur den schema.org-Selector → Page 2+
lieferte 0 Cards, jeder Page-Fetch lief ins 15s-Timeout × 3 Retries × 30 Pages
× 35 Combos. Run #9 verbrannte 3h GHA-Minuten ohne nutzbare Daten.

Dieser Test gegen echte Fixture-HTML beider Layouts soll Regressionen verhindern.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from src.crawler import LIST_EXTRACT_JS, _redirected_away_from_page

FIXTURE_DIR = Path(__file__).parent / "fixtures"
FIXTURE_P1 = FIXTURE_DIR / "list_p1_limassol_rent_apartments.html"
FIXTURE_P2 = FIXTURE_DIR / "list_p2_limassol_rent_apartments.html"


def _eval_against(fixture: Path) -> list[dict]:
    """Lade Fixture als file:// in Chromium, evaluiere LIST_EXTRACT_JS."""
    assert fixture.exists(), f"Fixture missing: {fixture}"
    url = f"file://{fixture.resolve()}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=20_000)
            page.wait_for_selector(".advert.js-item-listing", timeout=8_000)
            return page.evaluate(LIST_EXTRACT_JS)
        finally:
            browser.close()


@pytest.fixture(scope="module")
def cards_p1() -> list[dict]:
    return _eval_against(FIXTURE_P1)


@pytest.fixture(scope="module")
def cards_p2() -> list[dict]:
    return _eval_against(FIXTURE_P2)


def test_p1_extracts_minimum_cards(cards_p1):
    # Bazaraki rendert ≥45 organische + promoted Cards auf p1. Konservativ ≥30.
    assert len(cards_p1) >= 30, f"only {len(cards_p1)} cards on p1"


def test_p2_extracts_minimum_cards(cards_p2):
    # Pre-Fix war das 0 — der wichtigste Regressionstest dieses Files.
    assert len(cards_p2) >= 30, f"only {len(cards_p2)} cards on p2 (was the bug)"


def _assert_card_shape(c: dict) -> None:
    assert c["advId"] and c["advId"].isdigit(), f"bad advId: {c}"
    # URL: production hat https://, test-fixture hat file:// — beides ok solange
    # /adv/ enthalten und ohne ?p= Pagination-Query (das ist der relevante Cleanup).
    assert "/adv/" in c["url"], f"url not /adv/: {c['url']}"
    assert "?" not in c["url"], f"url has query string: {c['url']}"
    assert isinstance(c["price"], (int, float)) and c["price"] > 0, f"bad price: {c}"
    assert c["name"], f"missing name: {c}"


def test_p1_card_fields(cards_p1):
    for c in cards_p1[:5]:
        _assert_card_shape(c)


def test_p2_card_fields(cards_p2):
    for c in cards_p2[:5]:
        _assert_card_shape(c)


def test_p2_handles_german_thousand_separator(cards_p2):
    """Bazaraki rendert €4.800 (= 4800), kein €4 mit Dezimal-Tausender-Misread."""
    prices = [c["price"] for c in cards_p2]
    # Mindestens 80% der Preise müssen ≥ 100 sein (Mietpreise in EUR);
    # wenn der Parser '.' fälschlich als Dezimaltrenner liest würden viele
    # Werte unter 10 landen ("€4.800" → 4.8 statt 4800).
    realistic = sum(1 for p in prices if p >= 100)
    assert realistic / len(prices) >= 0.8, \
        f"only {realistic}/{len(prices)} prices realistic — parser könnte '.' falsch lesen"


def test_advids_unique_within_page(cards_p1, cards_p2):
    """Innerhalb einer Page keine Duplikate (verschiedene Pages haben Overlap, OK)."""
    for label, cards in [("p1", cards_p1), ("p2", cards_p2)]:
        ids = [c["advId"] for c in cards]
        # Bazaraki kann TOP-promoted Cards mit gleicher ID an die List-Position 0
        # und nochmal an organischer Position rendern. Etwas Toleranz erlauben.
        unique_ratio = len(set(ids)) / len(ids)
        assert unique_ratio >= 0.85, \
            f"{label}: nur {len(set(ids))}/{len(ids)} unique advIds"


# ---------- Redirect-Detection ----------


def test_redirect_detection_p1_no_query():
    """Page 1 ohne ?page= → kein Redirect."""
    assert _redirected_away_from_page(
        "https://www.bazaraki.com/real-estate-to-rent/apartments-flats/lemesos-district-limassol/",
        expected_page=1,
    ) is False


def test_redirect_detection_p2_clean():
    """?page=2 ankommt als ?page=2 → kein Redirect."""
    assert _redirected_away_from_page(
        "https://www.bazaraki.com/real-estate-to-rent/apartments-flats/lemesos-district-limassol/?page=2",
        expected_page=2,
    ) is False


def test_redirect_detection_past_end():
    """?page=999 endet als ?page=49 → Redirect erkannt."""
    assert _redirected_away_from_page(
        "https://www.bazaraki.com/real-estate-to-rent/apartments-flats/lemesos-district-limassol/?page=49",
        expected_page=999,
    ) is True


def test_redirect_detection_dropped_query():
    """?page=999 → / (komplett ohne Query) → auch Redirect."""
    assert _redirected_away_from_page(
        "https://www.bazaraki.com/real-estate-to-rent/apartments-flats/lemesos-district-limassol/",
        expected_page=999,
    ) is True
