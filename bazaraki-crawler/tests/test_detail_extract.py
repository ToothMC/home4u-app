"""Regression test: DETAIL_EXTRACT_JS muss hochauflösende Bild-URLs liefern.

Lädt eine echte Bazaraki-Detail-HTML als file:// in Chromium, evaluiert die
echte Extract-JS aus crawler.py und prüft per HEAD-Probe, dass die Cover-URL
sowie eine Stichprobe der Galerie-URLs mindestens 720 px breit sind.

Hintergrund: Bazaraki hat kein srcset; das Slick-Carousel speichert das
hi-res Bild im data-src, während src oft nur ein 160×104-Placeholder ist.
Falsche Selektor-/Attribut-Wahl liefert daher Mini-Thumbnails — was vorher
in der Home4U-UI die Bild-Vergrößerung kaputt gemacht hat.
"""
from __future__ import annotations

import struct
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import sync_playwright

from src.crawler import DETAIL_EXTRACT_JS

FIXTURE = Path(__file__).parent / "fixtures" / "detail_6410836.html"
MIN_COVER_WIDTH = 720


def webp_width(blob: bytes) -> int | None:
    """Lese die Pixel-Breite aus einem WebP-Header (VP8/VP8L/VP8X)."""
    if len(blob) < 30 or blob[:4] != b"RIFF" or blob[8:12] != b"WEBP":
        return None
    chunk = blob[12:16]
    if chunk == b"VP8 ":
        # Lossy: width = u16le @ offset 26 (& 0x3FFF)
        return struct.unpack("<H", blob[26:28])[0] & 0x3FFF
    if chunk == b"VP8L":
        # Lossless: width-1 = u14le @ offset 21 (low 14 bits of u32le)
        bits = struct.unpack("<I", blob[21:25])[0]
        return (bits & 0x3FFF) + 1
    if chunk == b"VP8X":
        # Extended: width-1 = u24le @ offset 24
        return int.from_bytes(blob[24:27], "little") + 1
    return None


@pytest.fixture(scope="module")
def extracted():
    """Run DETAIL_EXTRACT_JS gegen die Fixture-HTML."""
    assert FIXTURE.exists(), f"Fixture missing: {FIXTURE}"
    url = f"file://{FIXTURE.resolve()}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, wait_until="domcontentloaded")
        data = page.evaluate(DETAIL_EXTRACT_JS)
        browser.close()
    return data


def test_cover_present(extracted):
    assert extracted["cover"], "og:image fehlt"
    assert "bazaraki.com/media" in extracted["cover"]


def test_gallery_nonempty(extracted):
    imgs = extracted["allImages"]
    assert len(imgs) >= 3, f"erwartet ≥3 Galerie-Bilder, bekam {len(imgs)}: {imgs}"


def test_gallery_excludes_thumbnails_strip(extracted):
    """Der schmale Nav-Strip (.announcement__thumbnails-item) darf nicht in allImages liegen.
    Indirekt: alle URLs müssen vom Selektor img.announcement__images-item kommen,
    also dem hi-res data-src — daher per HEAD-Probe ≥720 px."""
    # Probe: Cover + erste Galerie-URL
    sample = [extracted["cover"], *extracted["allImages"][:2]]
    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        for url in sample:
            r = client.get(url)
            r.raise_for_status()
            w = webp_width(r.content)
            assert w is not None, f"konnte Breite nicht parsen: {url}"
            assert w >= MIN_COVER_WIDTH, (
                f"Bild-Breite {w}px < {MIN_COVER_WIDTH}px Schwelle für {url}. "
                "Wahrscheinlich landet wieder ein Slick-Placeholder im media[]."
            )
