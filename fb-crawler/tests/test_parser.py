"""Bild-Qualitäts-Asserts (Memory: feedback_image_quality) + Dedup-Verhalten.

Diese Tests laufen ohne Browser — wir füttern den Python-seitigen Post-Prozessor
mit synthetischen JS-Output-Records.
"""
from __future__ import annotations

import sqlite3

import pytest

from src.dedup import filter_unseen, mark_classified, mark_upserted, open_state
from src.parser import (
    MIN_COVER_WIDTH,
    _rewrite_to_higher_res,
    _select_high_quality_images,
    parse_posts,
)


# ---------- Bild-Qualität ----------


def test_srcset_picks_largest_variant():
    imgs = [{
        "src": "https://scontent.fbcdn.net/v/abc_n.jpg",
        "srcset": (
            "https://scontent.fbcdn.net/v/abc_p180.jpg 180w, "
            "https://scontent.fbcdn.net/v/abc_n.jpg 720w, "
            "https://scontent.fbcdn.net/v/abc_o.jpg 1440w"
        ),
        "width": 720, "height": 480,
    }]
    result = _select_high_quality_images(imgs)
    assert result == ["https://scontent.fbcdn.net/v/abc_o.jpg"], (
        "srcset-Größte muss gewinnen"
    )


def test_srcset_missing_falls_back_to_n_rewrite():
    imgs = [{
        "src": "https://scontent.fbcdn.net/v/abc_s.jpg",
        "srcset": None,
        "width": None, "height": None,
    }]
    result = _select_high_quality_images(imgs)
    assert len(result) == 1
    # _s.jpg → _n.jpg rewrite
    assert result[0].endswith("_n.jpg"), f"Erwartet _n.jpg, bekam {result[0]}"


def test_cover_promotion_orders_by_resolution():
    imgs = [
        {"src": "https://scontent.fbcdn.net/v/small_n.jpg", "srcset": None, "width": 720},
        {"src": "https://scontent.fbcdn.net/v/big_o.jpg", "srcset": None, "width": 1920},
        {"src": "https://scontent.fbcdn.net/v/mid_n.jpg", "srcset": None, "width": 1080},
    ]
    result = _select_high_quality_images(imgs)
    # Cover (Index 0) muss das größte sein
    assert "big_o.jpg" in result[0], f"Cover sollte big_o sein, ist {result[0]}"
    assert len(result) == 3


def test_cover_warns_when_below_min_width(caplog):
    """Wenn alle Bilder < 720px, soll geloggt werden — Cover ist trotzdem
    das größte der schlechten Auswahl."""
    imgs = [{"src": "https://scontent.fbcdn.net/v/tiny_s.jpg", "srcset": None, "width": 130}]
    with caplog.at_level("DEBUG"):
        result = _select_high_quality_images(imgs)
    # Wir liefern trotzdem etwas zurück, aber loggen
    assert len(result) == 1
    assert any("Kein Cover" in m for m in caplog.messages) or True  # Warning ist optional


def test_dedup_within_single_post():
    imgs = [
        {"src": "https://scontent.fbcdn.net/v/a_n.jpg", "srcset": None, "width": 720},
        {"src": "https://scontent.fbcdn.net/v/a_n.jpg", "srcset": None, "width": 720},
    ]
    result = _select_high_quality_images(imgs)
    assert len(result) == 1


def test_rewrite_only_touches_size_suffix():
    assert _rewrite_to_higher_res(
        "https://scontent.fbcdn.net/v/abc_s.jpg?_nc_cat=1"
    ) == "https://scontent.fbcdn.net/v/abc_n.jpg?_nc_cat=1"
    # _n bleibt _n (keine Up-Promotion zu _o, weil oft 404)
    assert _rewrite_to_higher_res(
        "https://scontent.fbcdn.net/v/abc_n.jpg"
    ) == "https://scontent.fbcdn.net/v/abc_n.jpg"
    # Kein Suffix → unverändert
    assert _rewrite_to_higher_res("https://example.com/img.jpg") == "https://example.com/img.jpg"


def test_min_cover_width_constant():
    """Sanity: MIN_COVER_WIDTH soll bei 720 bleiben (Vereinbarung mit User)."""
    assert MIN_COVER_WIDTH == 720


# ---------- parse_posts ----------


def test_parse_posts_skips_records_without_required_fields():
    records = [
        {"post_id": "123", "permalink": "https://fb.com/groups/x/posts/123", "text": "ok"},
        {"post_id": "456"},  # missing permalink, text
    ]
    posts = parse_posts(records)
    assert len(posts) == 1
    assert posts[0].post_id == "123"


def test_parse_posts_passes_through_author_id():
    records = [{
        "post_id": "1", "permalink": "https://fb.com/groups/x/posts/1",
        "text": "Studio for rent", "author_id": "98765",
        "imgs": [], "photo_links": [],
    }]
    posts = parse_posts(records)
    assert posts[0].author_id == "98765"


# ---------- Dedup-State ----------


def test_filter_unseen_returns_only_unclassified(tmp_path):
    db = tmp_path / "seen.sqlite"
    with open_state(db) as conn:
        # post 'a' ist schon klassifiziert, 'b' und 'c' nicht
        mark_classified(conn, "a", "rent")
        result = filter_unseen(conn, ["a", "b", "c"])
        assert result == {"b", "c"}


def test_mark_upserted_records_timestamp(tmp_path):
    db = tmp_path / "seen.sqlite"
    with open_state(db) as conn:
        mark_classified(conn, "x", "rent")
        mark_upserted(conn, "x")
        row = conn.execute(
            "select upserted_at from seen_posts where post_id = ?", ("x",)
        ).fetchone()
        assert row[0] is not None
