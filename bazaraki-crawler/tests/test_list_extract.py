"""Regression test: die List-Phase muss Inserate aus dem RSC-Flight-Payload lesen.

Hintergrund (Inzident 2026-06-03 bis 2026-10-21):
Bazaraki hat sein Frontend auf den Next.js App Router mit React Server
Components umgestellt. Seitdem steht im ausgelieferten HTML kein Inserat mehr
als DOM — die Listenseite rendert 60 `animate-pulse`-Skelette, die erst
client-seitig befüllt werden. Sämtliche Selektoren des alten Extractors
(`.advert.js-item-listing`, `[itemprop="price"]`, `.advert__content-price`,
`[itemprop="name"]`) lieferten 0 Treffer. 4,5 Monate lang fand der Crawler
nichts und meldete trotzdem „success"; 55.715 Inserate froren ein.

Diese Tests laufen gegen echte, nach der Umstellung gezogene Fixtures und
brauchen keinen Browser — genau wie der Crawler selbst nicht mehr.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.config import CityConfig
from src.crawler import _extract_list_page, _to_raw_listing
from src.flight import (
    extract_list_adverts,
    extract_list_total_count,
    extract_payload,
    parse_price,
    parse_size_from_features,
    split_location,
)

FIXTURE_DIR = Path(__file__).parent / "fixtures"
FIXTURE_RENT = FIXTURE_DIR / "rsc_list_limassol_rent_apartments.html"
FIXTURE_SALE = FIXTURE_DIR / "rsc_list_famagusta_sale_houses.html"
FIXTURE_PAST_END = FIXTURE_DIR / "rsc_list_past_last_page.html"


def _html(path: Path) -> str:
    assert path.exists(), f"Fixture missing: {path}"
    return path.read_text(encoding="utf-8", errors="replace")


@pytest.fixture(scope="module")
def rent_html() -> str:
    return _html(FIXTURE_RENT)


@pytest.fixture(scope="module")
def sale_html() -> str:
    return _html(FIXTURE_SALE)


# ---------- Payload-Extraktion ----------


def test_payload_is_found(rent_html):
    """Ohne Flight-Chunks kein Payload — das ist die Basis des ganzen Umbaus."""
    payload = extract_payload(rent_html)
    assert len(payload) > 10_000, f"Payload nur {len(payload)} Zeichen"
    assert '"adverts":' in payload


def test_extracts_full_page_of_adverts(rent_html):
    """Bazaraki liefert 60 Inserate pro Listenseite. Pre-Fix war das 0."""
    adverts = extract_list_adverts(rent_html)
    assert len(adverts) == 60, f"erwartet 60 adverts, bekam {len(adverts)}"


def test_past_last_page_is_empty(rent_html):
    """Hinter dem letzten Ergebnis: HTTP 200 mit `"adverts":[]`.

    Das ist das Pagination-Ende-Signal. Das alte server-gerenderte Frontend
    redirectete stattdessen auf die letzte Page (`?page=999` → `?page=49`),
    weshalb es dafür eine URL-Heuristik gab — die ist entfallen.
    """
    adverts = extract_list_adverts(_html(FIXTURE_PAST_END))
    assert adverts == [], f"erwartet 0 adverts hinter dem Ende, bekam {len(adverts)}"


def test_total_count_survives_empty_page():
    """`count` steht auch auf einer leeren Page im Payload.

    Darauf beruht der Blindflug-Guard in crawl_city: `count > 0` bei 0
    extrahierten Items auf Page 1 heißt „Format gewandert", nicht
    „Kategorie leer".
    """
    assert extract_list_total_count(_html(FIXTURE_PAST_END)) > 0


def test_no_payload_yields_nothing():
    """Cloudflare-Challenge oder Fehlerseite → leer, kein Crash."""
    assert extract_payload("<html><body>nope</body></html>") == ""
    assert extract_list_adverts("<html><body>nope</body></html>") == []


# ---------- Feld-Mapping ----------

_CITY = CityConfig(display="Limassol", district_path="lemesos-district-limassol")


@pytest.fixture(scope="module")
def rent_items(rent_html):
    return _extract_list_page(rent_html, "Limassol", "rent", "apartments-flats")


def test_all_adverts_map_to_listings(rent_items):
    assert len(rent_items) == 60, f"nur {len(rent_items)}/60 gemappt"


def test_listing_fields(rent_items):
    for it in rent_items:
        assert it.external_id.isdigit(), f"bad external_id: {it.external_id}"
        assert it.price > 0, f"bad price: {it.price} ({it.external_id})"
        assert it.title, f"missing title: {it.external_id}"
        assert it.listing_type == "rent"
        assert it.property_type == "apartment"


def test_source_url_has_title_slug(rent_items):
    """Der Slug-Pfad löst ein altes Problem.

    `/adv/{id}/` ohne Titel-Slug redirected auf die Kategorie-Übersicht; der
    Payload liefert mit `url` den fertigen Pfad. Deshalb ist detail_url jetzt
    für jedes Inserat eine echte, klickbare source_url.
    """
    for it in rent_items:
        assert it.detail_url.startswith("https://www.bazaraki.com/adv/"), it.detail_url
        assert it.detail_url.endswith("/"), it.detail_url
        slug = it.detail_url.rsplit("/adv/", 1)[1]
        assert "_" in slug, f"kein Titel-Slug in {it.detail_url}"
        assert "?" not in it.detail_url, f"Query-String in {it.detail_url}"


def test_city_and_district_come_from_list_page(rent_items):
    """`location` ("Stadt — Bezirk") liefert beides schon in Pass 1.

    Vorher kannte nur der Detail-Drill den Bezirk.
    """
    assert all(it.city == "Limassol" for it in rent_items), \
        sorted({it.city for it in rent_items})
    with_district = [it for it in rent_items if it.district]
    assert len(with_district) >= 55, f"nur {len(with_district)}/60 mit Bezirk"


def test_cover_image_is_from_gallery_not_thumb(rent_items):
    """Cover kommt aus `images` (640px), nicht aus `first_thumb` (300px)."""
    with_cover = [it for it in rent_items if it.image_url]
    assert len(with_cover) >= 55, f"nur {len(with_cover)}/60 mit Cover"
    for it in with_cover:
        assert "bazaraki.com/media" in it.image_url, it.image_url
        assert "bazaraki.com/static/" not in it.image_url, "Boilerplate-Logo als Cover"


def test_pass1_leaves_media_empty(rent_items):
    """Pass 1 darf `media` NICHT füllen.

    Die RPC überschreibt `media`, sobald das neue Array mindestens so lang
    ist wie das alte (migration 20260430200000). Ein Pass-1-Upsert mit 24
    Listenbildern (640px) würde die gedrillte 1600px-Galerie ersetzen.
    """
    assert all(it.media == [] for it in rent_items)


def test_price_is_numeric_without_locale_parsing(rent_items):
    """`price_without_currency` ist eine reine Ziffernfolge.

    Der alte Extractor musste "€4.800" im deutschen Format zerlegen ('.' als
    Tausender) und sich gegen Ranges wie "€1000 - €2000" wehren. Wenn ein
    Parser '.' als Dezimaltrenner liest, landen Mieten bei 4.8 statt 4800.
    """
    prices = [it.price for it in rent_items]
    assert all(p >= 100 for p in prices), [p for p in prices if p < 100]


def test_sale_prices_are_large(sale_html):
    """Kaufpreise haben mehrere Tausender-Gruppen ("€1.250.000")."""
    items = _extract_list_page(sale_html, "Famagusta", "sale", "houses")
    assert len(items) == 60
    assert all(it.price >= 10_000 for it in items), \
        [it.price for it in items if it.price < 10_000]
    assert max(it.price for it in items) >= 100_000


def test_external_ids_unique_within_page(rent_items):
    ids = [it.external_id for it in rent_items]
    assert len(set(ids)) == len(ids), "Duplikate auf einer Page"


# ---------- Einzelne Parser ----------


def test_split_location_only_on_em_dash():
    """Nur am Em-Dash trennen — Bezirksnamen enthalten gewöhnliche Bindestriche."""
    assert split_location("Limassol — Agios Tychon") == ("Limassol", "Agios Tychon")
    assert split_location("Paphos — Paphos - Agios Theodoros") == \
        ("Paphos", "Paphos - Agios Theodoros")
    assert split_location("Limassol") == ("Limassol", None)
    assert split_location(None) == (None, None)


def test_parse_price_prefers_numeric_field():
    assert parse_price({"price_without_currency": "1349", "price": "€1.349"}) == 1349.0
    assert parse_price({"price_without_currency": "1250000"}) == 1_250_000.0
    # Fallback auf den formatierten String, wenn das Feld fehlt
    assert parse_price({"price": "€4.800"}) == 4800.0
    assert parse_price({}) is None
    assert parse_price({"price_without_currency": "", "price": ""}) is None


def test_parse_size_takes_first_sqm():
    """Häuser liefern zwei m²-Werte: überdeckte Fläche zuerst, dann Grundstück."""
    house = [{"text": "2"}, {"text": "2"}, {"text": "92 m²"},
             {"text": "225 m²"}, {"text": "Uncovered"}]
    assert parse_size_from_features(house) == 92
    # Plots haben nur einen Wert — eindeutig
    assert parse_size_from_features([{"text": "4.014 m²"}]) == 4014
    assert parse_size_from_features([{"text": "2"}]) is None
    assert parse_size_from_features(None) is None


def test_advert_without_price_is_dropped():
    """Gesuche und „Preis auf Anfrage" sind für uns unbrauchbar."""
    assert _to_raw_listing(
        {"id": 123, "url": "/adv/123_x/", "title": "x"},
        "Limassol", "rent", "apartments-flats",
    ) is None
    assert _to_raw_listing(
        {"price_without_currency": "500", "url": "/adv/123_x/"},
        "Limassol", "rent", "apartments-flats",
    ) is None


def test_city_falls_back_when_location_missing():
    """Ohne `location` übernimmt die Listenseiten-Stadt."""
    item = _to_raw_listing(
        {"id": 9, "price_without_currency": "500", "url": "/adv/9_studio-to-rent/"},
        _CITY.display, "rent", "apartments-flats",
    )
    assert item is not None
    assert item.city == "Limassol"
    assert item.district is None
    assert item.rooms == 0, "studio im Slug → 0 Zimmer"


def test_oversized_plot_area_does_not_reach_smallint_column():
    """`listings.size_sqm` ist smallint — 87.293 m² Feld sprengt die Spalte.

    Die RPC castet hart; ein Überlauf lässt den ganzen 50er-Chunk platzen.
    Der echte Wert muss stattdessen in extracted_data landen.
    """
    from src.crawler import RawListing
    from src.supabase_writer import SIZE_SQM_MAX, _to_row

    item = RawListing(
        external_id="1", listing_type="sale", city="Paphos", price=550000.0,
        rooms=None, image_url=None, title="Agricultural Field 87293 m²",
        detail_url="https://www.bazaraki.com/adv/1_field/", property_type="plot",
        size_sqm=87_293,
    )
    row = _to_row(item)
    assert row["size_sqm"] is None
    assert row["extracted_data"]["size_sqm_overflow"] == 87_293

    # Werte innerhalb der Grenze gehen unverändert durch
    item.size_sqm = SIZE_SQM_MAX
    row = _to_row(item)
    assert row["size_sqm"] == SIZE_SQM_MAX
    assert "size_sqm_overflow" not in row["extracted_data"]
