"""Regression test: der Detail-Drill muss den RSC-Payload lesen und hi-res Bilder liefern.

Zwei Dinge werden hier festgehalten:

1. Die Detailseite ist seit Juni 2026 ebenfalls Next.js App Router. Die alten
   Selektoren (`img.announcement__images-item`, `[itemprop="address"]`,
   `.announcement-characteristics`, `meta[property="og:image"]`) greifen nicht
   mehr. Das Advert-Objekt steckt im dehydrierten React-Query-Cache und wird
   über seine ID adressiert.

2. Bazaraki liefert drei Galerie-Varianten. `preview` ist 160px (der
   Thumbnail-Strip unter der Lightbox), `small` sind Misch-Assets, und nur
   `full` ist die 1600px-Fassung. Landet die falsche im media[], ist die
   Bild-Vergrößerung in der Home4U-UI kaputt — genau das war schon mal der
   Fall. Der Test prüft die Breite per Range-Request gegen die echte CDN-URL.
"""
from __future__ import annotations

import struct
from pathlib import Path

import httpx
import pytest

from src.crawler import RawListing, crawl_detail, parse_pets_allowed, parse_size_sqm
from src.flight import extract_detail_advert, parse_detail_features

FIXTURE = Path(__file__).parent / "fixtures" / "rsc_detail_6390114.html"
ADVERT_ID = "6390114"
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
def html() -> str:
    assert FIXTURE.exists(), f"Fixture missing: {FIXTURE}"
    return FIXTURE.read_text(encoding="utf-8", errors="replace")


@pytest.fixture(scope="module")
def advert(html) -> dict:
    a = extract_detail_advert(html, ADVERT_ID)
    assert a is not None, "Advert-Objekt nicht im RSC-Payload gefunden"
    return a


# ---------- Payload-Extraktion ----------


def test_advert_is_addressed_by_id(advert):
    """Der Payload enthält mehrere `"data":`-Caches (Flat-Pages, i18n, Similar).

    Deshalb ankern wir auf die ID aus Pass 1 statt auf das erste Vorkommen.
    """
    assert str(advert["id"]) == ADVERT_ID


def test_wrong_id_yields_nothing(html):
    assert extract_detail_advert(html, "9999999") is None


def test_gallery_has_full_variant(advert):
    full = advert["gallery"]["full"]
    assert len(full) >= 3, f"erwartet ≥3 Galerie-Bilder, bekam {len(full)}"
    assert all("bazaraki.com/media" in u for u in full)


def test_named_features_replace_text_parsing(advert):
    """Die Characteristics kommen strukturiert, nicht mehr als Plain-Text-Block."""
    chars = parse_detail_features(advert)
    assert chars["Property area"] == "50 m²"
    assert chars["Bedrooms"] == "1"
    assert chars["Energy Efficiency"] == "A"
    assert chars["Pets"] == "Not allowed"


def test_description_is_full_text(advert):
    """Die Listenseite lässt `description` leer, die Detailseite liefert Volltext.

    Vorher kam hier nur der og:description-Teaser.
    """
    assert len(advert["description"]) > 300


def test_coordinates_present(advert):
    coords = advert["location"]["coordinates"]
    assert 34.0 < coords["lat"] < 36.0, coords
    assert 32.0 < coords["lng"] < 35.0, coords


# ---------- crawl_detail() End-to-End gegen die Fixture ----------


@pytest.fixture(scope="module")
def drilled(html, monkeypatch_module) -> RawListing:
    """crawl_detail() mit der Fixture statt eines echten HTTP-GET."""
    item = RawListing(
        external_id=ADVERT_ID,
        listing_type="rent",
        city="Limassol",
        price=1349.0,
        rooms=1,
        image_url=None,
        title="1-bedroom apartment to rent",
        detail_url=f"https://www.bazaraki.com/adv/{ADVERT_ID}_1-bedroom-apartment-to-rent/",
        property_type="apartment",
    )
    monkeypatch_module.setattr("src.crawler._get_html", lambda client, url: html)
    # Cover-Breitencheck überspringen — der Netzpfad wird separat getestet.
    monkeypatch_module.setattr("src.crawler._cover_width", lambda url: None)
    crawl_detail(item)
    return item


@pytest.fixture(scope="module")
def monkeypatch_module():
    from _pytest.monkeypatch import MonkeyPatch

    mp = MonkeyPatch()
    yield mp
    mp.undo()


def test_drill_fills_detail_fields(drilled):
    assert drilled.size_sqm == 50
    assert drilled.rooms == 1
    assert drilled.energy_class == "A"
    assert drilled.furnishing == "Fully Furnished"
    assert drilled.pets_allowed is False
    assert drilled.description and len(drilled.description) > 300
    assert drilled.city == "Limassol"
    assert drilled.district == "Agios Tychon Tourist Area"


def test_drill_raises_confidence(drilled):
    """0.85 ist das Erfolgssignal des Drills — main.py zählt daran `ok`.

    district/size_sqm taugen dafür nicht mehr: die liefert schon Pass 1.
    """
    assert drilled.confidence == 0.85


def test_drill_uses_full_resolution_gallery(drilled, advert):
    assert drilled.media == advert["gallery"]["full"]
    assert drilled.media[0] not in advert["gallery"]["preview"], \
        "160px-Thumbnail-Strip statt 1600px-Galerie im media[]"


def test_drill_keeps_extras_in_extracted_data(drilled):
    """Was die RPC nicht als Spalte annimmt, darf nicht verloren gehen."""
    ed = drilled.extracted_data
    assert ed["lat"] and ed["lng"]
    assert ed["bathrooms"] == "1"
    assert ed["floor"] == "4th"
    assert ed["year_built"] == "2024"
    assert ed["virtual_tour_url"]


def test_drill_survives_unparsable_page(monkeypatch):
    """Kein Payload → Warnung, aber keine Felder überschreiben."""
    item = RawListing(
        external_id="1", listing_type="rent", city="Limassol", price=1.0,
        rooms=None, image_url=None, title="t",
        detail_url="https://www.bazaraki.com/adv/1_x/", property_type="apartment",
    )
    monkeypatch.setattr("src.crawler._get_html", lambda client, url: "<html>nope</html>")
    crawl_detail(item)
    assert item.confidence == 0.5
    assert item.description is None
    assert item.media == []


# ---------- Bildbreite gegen das echte CDN ----------


def test_full_gallery_is_hi_res(advert):
    """`gallery.full` muss ≥720px liefern, `preview` ist der 160px-Strip.

    Range-Request bytes 0-99 reicht für den WebP-Header.
    """
    full = advert["gallery"]["full"]
    preview = advert["gallery"]["preview"]
    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        headers = {"Range": "bytes=0-99", "User-Agent": "Home4U-Indexer/0.1 (info@home4u.ai)"}
        for url in full[:2]:
            r = client.get(url, headers=headers)
            r.raise_for_status()
            w = webp_width(r.content)
            assert w is not None, f"konnte Breite nicht parsen: {url}"
            assert w >= MIN_COVER_WIDTH, (
                f"Bild-Breite {w}px < {MIN_COVER_WIDTH}px für {url}. "
                "Wahrscheinlich landet wieder eine Thumbnail-Variante im media[]."
            )
        # Gegenprobe: die preview-Variante ist nachweislich zu klein
        r = client.get(preview[0], headers=headers)
        r.raise_for_status()
        assert webp_width(r.content) < MIN_COVER_WIDTH


# ---------- Characteristics-Parser ----------


def test_parse_size_sqm_labels():
    assert parse_size_sqm({"Property area": "50 m²"}) == 50
    assert parse_size_sqm({"Covered area": "92 m²"}) == 92
    # Grundstücke tragen ihre Fläche unter "Plot area"
    assert parse_size_sqm({"Plot area": "4.014 m²"}) == 4014
    assert parse_size_sqm({}) is None


def test_parse_pets_allowed():
    assert parse_pets_allowed({"Pets": "Not allowed"}) is False
    assert parse_pets_allowed({"Pets": "Allowed"}) is True
    assert parse_pets_allowed({}) is None
