"""Crawler über Bazarakis RSC-Flight-Payload — robots.txt-respektierend, rate-limited.

Kein Playwright mehr. Bazaraki läuft seit Juni 2026 auf dem Next.js App
Router; die Inserate stehen nicht im DOM, sondern im RSC-Payload des
ausgelieferten HTML (Details in `flight.py`). Ein httpx-GET genügt damit für
Liste UND Detail — der Chromium-Download im CI, die 8s-Selector-Waits pro
Page und die gesamte JS-Extraktion sind entfallen.
"""
from __future__ import annotations

import logging
import re
import struct
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Iterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import (
    BASE_URL,
    MAX_PAGES_PER_CITY,
    RATE_LIMIT_SECONDS,
    ROBOTS_URL,
    USER_AGENT,
    CityConfig,
    build_listing_url,
    home4u_property_type,
)
from .flight import (
    extract_detail_advert,
    extract_list_adverts,
    extract_list_total_count,
    parse_detail_features,
    parse_price,
    parse_size_from_features,
    split_location,
)

log = logging.getLogger(__name__)


@dataclass
class RawListing:
    """Roh-Datensatz pro Listing — wird vom Writer ins Schema gemappt.

    Seit der RSC-Umstellung liefert die Listenseite deutlich mehr als früher:
    `location` (Stadt UND Bezirk), die komplette `images`-Liste und einen
    numerischen Preis. Was vorher nur der Detail-Drill wusste, steht damit
    schon nach Pass 1 — Pass 2 holt nur noch Beschreibung, die 1600px-Galerie
    und die benannten Characteristics.
    """
    external_id: str        # Bazaraki adv-ID (Primärschlüssel)
    listing_type: str       # rent|sale
    city: str               # aus location, Fallback: Listenseiten-Stadt
    price: float            # numerisch, EUR
    rooms: int | None       # 0 = Studio
    image_url: str | None   # Cover-Bild (Listenseite)
    title: str | None       # für Debug-Logs
    detail_url: str         # für Detail-Drilling UND als source_url
    property_type: str | None  # Home4U-Taxonomie: apartment|house|room|plot

    # Ab Listenseite gefüllt (vorher Detail-only)
    district: str | None = None
    size_sqm: int | None = None
    media: list[str] = field(default_factory=list)  # alle Bilder, [0] = Cover

    # Detail-Felder (None solange noch nicht gedrillt)
    description: str | None = None
    energy_class: str | None = None
    furnishing: str | None = None
    pets_allowed: bool | None = None

    # Indexer-Spec v2.0 §2.2 / §4.2: Roh-Output für Re-Processing.
    # Bazaraki ist eine strukturierte Quelle, darum konstante Confidence —
    # keine LLM-Extraktion wie bei FB.
    extracted_data: dict | None = None
    # 0.5 ohne Detail-Drilling (nur Listenseite), 0.85 mit Detail.
    confidence: float = 0.5

    # Dedup-Signale (Spur 0048): cover_phash für pHash-Match, phone_hash für
    # Phone-Match.
    cover_phash: int | None = None
    phone_hash: str | None = None

    # Klartext-Kontaktdaten für Outreach (encrypted server-side im RPC).
    # Bazaraki liefert seit dem Redesign KEINE Telefonnummern mehr an
    # Nicht-Eingeloggte (`permissions.phone == "show_auth_dialogue"`), und der
    # Endpunkt, den der alte "Show phone"-Click ansprach, liegt unter `/api`
    # — per robots.txt gesperrt. Die Felder bleiben für andere Quellen und
    # für die bereits gespeicherten ~28k Nummern (COALESCE im RPC) erhalten.
    contact_phone: str | None = None
    contact_phone_country: str | None = None
    contact_email: str | None = None


# ---------- HTTP ----------

def http_client() -> httpx.Client:
    """Ein httpx-Client mit den Headern, die Bazaraki/Cloudflare erwarten.

    `USER_AGENT` bleibt bewusst der sprechende Home4U-Indexer-String: gegen
    die RSC-Seiten getestet liefert er dieselben Ergebnisse wie ein Browser-
    UA, es gibt also keinen Grund, sich zu verstecken.
    """
    return httpx.Client(
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-GB,en;q=0.9",
        },
        timeout=30.0,
        follow_redirects=True,
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _get_html(client: httpx.Client, url: str) -> str:
    """GET mit Retry für transiente Netzwerk-/5xx-Fehler."""
    resp = client.get(url)
    resp.raise_for_status()
    return resp.text


# ---------- robots.txt ----------

_DISALLOW_RE = re.compile(r"^Disallow:\s*(.*)$", re.IGNORECASE)


def fetch_disallowed_paths() -> list[str]:
    """Liefert Disallow-Pfade für unseren User-Agent (oder *)."""
    try:
        resp = httpx.get(ROBOTS_URL, timeout=10, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()
    except Exception as e:
        log.warning("robots.txt fetch failed (%s) — defensiv: keine Pfade gesperrt", e)
        return []

    disallowed: list[str] = []
    current_agent_matches = False
    for line in resp.text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("user-agent:"):
            agent = line.split(":", 1)[1].strip()
            current_agent_matches = agent == "*" or "home4u" in agent.lower()
            continue
        if not current_agent_matches:
            continue
        m = _DISALLOW_RE.match(line)
        if m:
            path = m.group(1).strip()
            if path:
                disallowed.append(path)
    return disallowed


def is_path_allowed(path: str, disallowed: list[str]) -> bool:
    return not any(path.startswith(rule) for rule in disallowed)


# ---------- Rooms aus URL-Slug ableiten ----------

_STUDIO_RE = re.compile(r"studio", re.IGNORECASE)
_BEDROOM_RE = re.compile(r"(\d+)-bedroom", re.IGNORECASE)


def parse_rooms_from_slug(url: str) -> int | None:
    """Bazaraki-URLs codieren rooms im Slug: studio/1-bedroom/2-bedroom/..."""
    slug = url.split("/adv/", 1)[-1]
    if _STUDIO_RE.search(slug):
        return 0
    m = _BEDROOM_RE.search(slug)
    if m:
        return int(m.group(1))
    return None


# ---------- Characteristics-Parser (jetzt über benannte Features) ----------

def parse_size_sqm(chars: dict[str, str]) -> int | None:
    """Fläche aus den benannten Detail-Features.

    "Plot area" ergänzt die alte Liste: Grundstücke tragen ihre Fläche unter
    diesem Label, und für Plots IST die Grundstücksfläche das, was `size_sqm`
    bei Home4U trägt.
    """
    val = (
        chars.get("Property area")
        or chars.get("Covered area")
        or chars.get("Plot area")
        or chars.get("Area")
    )
    if not val:
        return None
    # "4.014 m²" → 4014: der Punkt ist Tausender-Trenner.
    digits = re.sub(r"[^\d]", "", val.split("m²")[0])
    return int(digits) if digits else None


def parse_rooms_from_chars(chars: dict[str, str]) -> int | None:
    val = chars.get("Bedrooms")
    if not val:
        return None
    if "studio" in val.lower():
        return 0
    m = re.search(r"(\d+)", val)
    return int(m.group(1)) if m else None


def parse_pets_allowed(chars: dict[str, str]) -> bool | None:
    val = chars.get("Pets")
    if not val:
        return None
    v = val.lower()
    if "not allowed" in v:
        return False
    if "allowed" in v:
        return True
    return None


# ---------- Bild-Qualität ----------

# Mindest-Bildbreite für das Cover. Die Detail-Galerie (`gallery.full`)
# liefert durchgängig 1600px; die Listenseite nur 640px (`images`) bzw.
# 300px (`first_thumb`). Der Check läuft deshalb nur noch gegen media[0] —
# ein Range-Request pro Listing statt einer pro Bild.
MIN_IMAGE_WIDTH = 500


# Bazaraki setzt bei manchen Inseraten sein FB-Sharing-Logo
# (`www.bazaraki.com/static/images/fb/bazaraki.*.png`) als Vorschaubild — wir
# wollen echte Fotos statt Fremd-Werbung. Echte Galerie-URLs liegen unter
# `cdn{1,2,...}.bazaraki.com/media/`. Alles unter dem `/static/`-Prefix der
# Hauptdomain ist Boilerplate (Logo, Icons, FB-Cards).
def _is_bazaraki_boilerplate(url: str | None) -> bool:
    if not url:
        return False
    return "bazaraki.com/static/" in url


def _webp_width(blob: bytes) -> int | None:
    """Lese die Pixel-Breite aus einem WebP-Header (VP8/VP8L/VP8X). None wenn unparsbar."""
    if len(blob) < 30 or blob[:4] != b"RIFF" or blob[8:12] != b"WEBP":
        return None
    chunk = blob[12:16]
    if chunk == b"VP8 ":
        return struct.unpack("<H", blob[26:28])[0] & 0x3FFF
    if chunk == b"VP8L":
        bits = struct.unpack("<I", blob[21:25])[0]
        return (bits & 0x3FFF) + 1
    if chunk == b"VP8X":
        return int.from_bytes(blob[24:27], "little") + 1
    return None


def _cover_width(url: str) -> int | None:
    """Breite des Covers per Range-Request (bytes 0-99, ~30ms)."""
    try:
        r = httpx.get(
            url,
            headers={"User-Agent": USER_AGENT, "Range": "bytes=0-99"},
            timeout=8.0,
            follow_redirects=True,
        )
        r.raise_for_status()
        return _webp_width(r.content)
    except Exception:
        return None


def pick_media(gallery_full: list[str], fallback: list[str]) -> list[str]:
    """Galerie-URLs säubern: Boilerplate raus, dedupliziert, max 24.

    `gallery.full` ist die 1600px-Variante und damit die erste Wahl;
    `fallback` sind die 640px-`images` der Listenseite für den Fall, dass die
    Detailseite keine Galerie liefert.
    """
    out: list[str] = []
    for url in [*gallery_full, *fallback]:
        if not url or url in out or _is_bazaraki_boilerplate(url):
            continue
        out.append(url)
    return out[:24]


# ---------- Pass 1: Listenseite ----------

def _to_raw_listing(
    advert: dict, city_fallback: str, listing_type: str, subtype: str
) -> RawListing | None:
    """Ein Advert-Dict aus dem Flight-Payload → RawListing.

    Nur `id` und ein Preis sind Pflicht; alles andere ist best-effort. Preis
    null hieß schon im alten Extractor "unbrauchbare Card" (Bazaraki rendert
    Gesuche und Preis-auf-Anfrage-Inserate ohne Wert).
    """
    advert_id = advert.get("id")
    price = parse_price(advert)
    if not advert_id or price is None:
        return None

    url_path = advert.get("url") or ""
    # `url` ist ein fertiger Slug-Pfad ("/adv/6603984_2-bedroom-…/"). Genau
    # der fehlte bisher: ohne Titel-Slug redirected /adv/{id}/ auf die
    # Kategorie-Übersicht, weshalb bazaraki-Listings nie eine brauchbare
    # source_url hatten.
    detail_url = urllib.parse.urljoin(BASE_URL, url_path) if url_path else ""

    city, district = split_location(advert.get("location"))
    images = [u for u in (advert.get("images") or []) if isinstance(u, str)]
    cover = next((u for u in images if not _is_bazaraki_boilerplate(u)), None)
    if not cover:
        thumb = advert.get("first_thumb")
        cover = thumb if isinstance(thumb, str) and not _is_bazaraki_boilerplate(thumb) else None

    title = (advert.get("title") or "").strip() or None

    return RawListing(
        external_id=str(advert_id),
        listing_type=listing_type,
        city=city or city_fallback,
        price=price,
        rooms=parse_rooms_from_slug(detail_url),
        image_url=cover,
        title=title,
        detail_url=detail_url,
        property_type=home4u_property_type(subtype),
        district=district,
        size_sqm=parse_size_from_features(advert.get("features")),
        # media bleibt in Pass 1 bewusst LEER, obwohl die Listenseite die
        # komplette `images`-Liste mitliefert: die RPC überschreibt `media`,
        # sobald das neue Array mindestens so lang ist wie das alte
        # (migration 20260430200000). Ein Pass-1-Upsert mit 24 Listenbildern
        # (640px) würde damit die gedrillte 1600px-Galerie ersetzen. Das Cover
        # allein reicht hier — der Writer fällt dafür auf `image_url` zurück,
        # und `media`-Länge bleibt das Signal für "schon gedrillt"
        # (DRILLED_MEDIA_THRESHOLD im Writer).
    )


def _extract_list_page(
    html: str, city: str, listing_type: str, subtype: str
) -> list[RawListing]:
    out: list[RawListing] = []
    for advert in extract_list_adverts(html):
        item = _to_raw_listing(advert, city, listing_type, subtype)
        if item is not None:
            out.append(item)
    return out


def crawl_city(
    city: CityConfig,
    listing_type: str,
    subtype: str,
    disallowed: list[str],
    max_pages: int = MAX_PAGES_PER_CITY,
    deadline_at: float | None = None,
    known_ids: set[str] | None = None,
    smart_stop_min_pages: int = 3,
    smart_stop_consecutive: int = 2,
    client: httpx.Client | None = None,
) -> Iterator[RawListing]:
    """Iteriert Pages für eine City+Type+Subtype-Kombination, yieldet RawListings.

    Liefert nur die Listenseiten-Daten — Detail-Drilling macht der Caller.

    Wenn `deadline_at` (epoch-Sekunden) gesetzt ist, bricht die Pagination ab
    sobald `time.time() > deadline_at`.

    Pagination-Ende: Bazaraki antwortet hinter dem letzten Ergebnis mit HTTP
    200 und `"adverts":[]`. Das alte Frontend redirectete stattdessen auf die
    letzte Page (`?page=999` → `?page=49`), weshalb es dafür eine eigene
    URL-Heuristik gab — die ist mit dem App Router entfallen.

    Smart-Stop (FAST_MODE):
        Wenn `known_ids` übergeben wird (= alle in unserer DB bekannten
        external_ids für diese City+Type), beendet die Pagination früh:
        ab `smart_stop_min_pages` (Default 3), wenn `smart_stop_consecutive`
        (Default 2) Pages in Folge **alle** Listings bereits in `known_ids`
        enthalten, brechen wir ab. Conservative-Defaults verhindern false-
        positive Stops bei Sticky-Listings. Voraussetzung für korrekten
        Stale-Sweep: Caller darf `touch_last_seen` erst NACH verifizierten
        Treffern feuern (siehe main.py).
    """
    seen_external_ids: set[str] = set()
    smart_stop_enabled = known_ids is not None and len(known_ids) > 0
    all_known_in_row = 0

    owns_client = client is None
    http = client or http_client()
    try:
        for page_num in range(1, max_pages + 1):
            if deadline_at is not None and time.time() > deadline_at:
                log.warning("  list %s %s %s p%d: budget reached — stop pagination",
                            city.display, listing_type, subtype, page_num)
                return

            url = build_listing_url(city, listing_type, subtype, page=page_num)
            path = urllib.parse.urlparse(url).path
            if not is_path_allowed(path, disallowed):
                log.warning("Pfad %s per robots.txt gesperrt — skip", path)
                return

            log.info("→ list %s", url)
            try:
                html = _get_html(http, url)
            except Exception as e:
                log.warning("Page %s/%s/%s p%d fetch failed: %s",
                            city.display, listing_type, subtype, page_num, e)
                time.sleep(RATE_LIMIT_SECONDS)
                continue

            items = _extract_list_page(html, city.display, listing_type, subtype)

            if not items:
                # Gegenprobe: `count` ist die Gesamt-Trefferzahl des Filters
                # und steht auch auf einer leeren Page im Payload. count > 0
                # bei 0 extrahierten Items auf Page 1 heißt NICHT "Kategorie
                # leer", sondern "Payload-Format gewandert" — genau der Fall,
                # der ab 2026-06-03 monatelang unbemerkt blieb.
                total = extract_list_total_count(html)
                if page_num == 1 and total:
                    log.error(
                        "  list %s %s %s p1: 0 Items extrahiert, aber count=%d — "
                        "RSC-Payload-Format gewandert? (flight.py anchor '\"adverts\":')",
                        city.display, listing_type, subtype, total,
                    )
                else:
                    log.info("  list %s %s %s p%d: 0 adverts → end of pagination",
                             city.display, listing_type, subtype, page_num)
                return

            new_count = 0
            unknown_count = 0  # Listings auf dieser Page, die NICHT in known_ids sind
            for item in items:
                if item.external_id in seen_external_ids:
                    continue
                seen_external_ids.add(item.external_id)
                new_count += 1
                if smart_stop_enabled and item.external_id not in known_ids:
                    unknown_count += 1
                yield item

            # Smart-Stop-Tracking: zähle Pages-in-Folge mit 0 unbekannten Items
            if smart_stop_enabled:
                page_all_known = new_count > 0 and unknown_count == 0
                if page_all_known:
                    all_known_in_row += 1
                else:
                    all_known_in_row = 0

                log.info(
                    "  list %s %s %s p%d: %d cards, %d new (%d unknown, %d known-in-row, cum %d)",
                    city.display, listing_type, subtype, page_num, len(items),
                    new_count, unknown_count, all_known_in_row, len(seen_external_ids),
                )

                if (
                    page_num >= smart_stop_min_pages
                    and all_known_in_row >= smart_stop_consecutive
                ):
                    log.info(
                        "  list %s %s %s: smart-stop — %d pages in row all-known (>= page %d) → break",
                        city.display, listing_type, subtype,
                        all_known_in_row, smart_stop_min_pages,
                    )
                    return
            else:
                log.info(
                    "  list %s %s %s p%d: %d cards, %d new (cum %d)",
                    city.display, listing_type, subtype, page_num,
                    len(items), new_count, len(seen_external_ids),
                )

            if new_count == 0:
                return
            time.sleep(RATE_LIMIT_SECONDS)
    finally:
        if owns_client:
            http.close()


# ---------- Pass 2: Detailseite ----------

def crawl_detail(item: RawListing, client: httpx.Client | None = None) -> None:
    """Drill in die Detail-Page und reichere RawListing in-place an.

    Was der Drill noch beiträgt, nachdem Pass 1 schon Preis, Stadt, Bezirk und
    eine 640px-Galerie liefert:
      - `gallery.full`: dieselben Fotos in 1600px statt 640px
      - `description`: Volltext (die Listenseite lässt das Feld leer)
      - benannte `features`: Fläche, Bäder, Energieklasse, Möblierung, Pets
      - `coordinates`: lat/lng, bisher für bazaraki gar nicht vorhanden

    Bei Fehler: nichts ändern, Log-Warnung.
    """
    if not item.detail_url:
        log.warning("detail skip %s: keine detail_url", item.external_id)
        return

    owns_client = client is None
    http = client or http_client()
    try:
        html = _get_html(http, item.detail_url)
    except Exception as e:
        log.warning("detail-fetch failed for %s: %s", item.external_id, e)
        if owns_client:
            http.close()
        return
    finally:
        if owns_client:
            http.close()

    advert = extract_detail_advert(html, item.external_id)
    if advert is None:
        log.warning(
            "detail-parse failed for %s: kein Advert-Objekt im RSC-Payload",
            item.external_id,
        )
        return

    # Stadt + Bezirk aus der Detail-Location (präziser als die Listenseite,
    # identisches Format "Stadt — Bezirk").
    location = advert.get("location") or {}
    city, district = split_location(location.get("name"))
    if city:
        item.city = city
    if district:
        item.district = district

    # Benannte Characteristics
    chars = parse_detail_features(advert)
    size = parse_size_sqm(chars)
    if size:
        item.size_sqm = size
    rooms_from_chars = parse_rooms_from_chars(chars)
    if rooms_from_chars is not None:
        item.rooms = rooms_from_chars  # genauer als URL-Slug
    item.energy_class = chars.get("Energy Efficiency")
    item.furnishing = chars.get("Furnishing")
    item.pets_allowed = parse_pets_allowed(chars)

    # Beschreibung. Die Listenseite lässt `description` leer; hier kommt der
    # Volltext — und zwar ungekürzt, nicht mehr der og:description-Teaser.
    desc = advert.get("description")
    if isinstance(desc, str) and desc.strip():
        item.description = desc.strip()[:4000]

    # Media: 1600px-Galerie, Listenseiten-images als Fallback.
    gallery = advert.get("gallery") or {}
    full = [u for u in (gallery.get("full") or []) if isinstance(u, str)]
    media = pick_media(full, item.media)
    if media:
        # Nur das Cover gegenprüfen: `gallery.full` ist durchgängig 1600px,
        # ein Check pro Bild wäre 24 Requests ohne Erkenntnis. Bei Fetch-
        # oder Parse-Fehler behalten wir die URL (Benefit of Doubt).
        width = _cover_width(media[0])
        if width is not None and width < MIN_IMAGE_WIDTH and len(media) > 1:
            log.debug("cover %dpx zu klein, nutze nächstes Bild: %s", width, media[0])
            media = media[1:]
        item.media = media

    # extracted_data für Re-Processing ohne Re-Crawl (Indexer-Spec v2.0 §2.2).
    # Hier landet auch, was die `bulk_upsert_external_listings`-RPC (noch)
    # nicht als Spalte annimmt — lat/lng, Bäder, Stockwerk, Baujahr,
    # Ausstattung. So ist nichts verloren und ein späteres Schema-Update kann
    # es von hier backfillen, ohne 55k Detailseiten neu zu holen.
    coords = location.get("coordinates") or {}
    item.extracted_data = {
        "location_name": location.get("name"),
        "chars_parsed": chars,
        "description_full": item.description,
        "lat": coords.get("lat"),
        "lng": coords.get("lng"),
        "coords_approximate": coords.get("is_approximate"),
        "bathrooms": chars.get("Bathrooms"),
        "floor": chars.get("Floor"),
        "year_built": chars.get("Construction year"),
        "parking": chars.get("Parking"),
        "air_conditioning": chars.get("Air conditioning"),
        "postal_code": chars.get("Postal code"),
        "included": chars.get("Included"),
        "virtual_tour_url": advert.get("virtual_tour"),
        "video_url": advert.get("video"),
        "seller_name": (advert.get("user") or {}).get("name"),
        "seller_is_business": (advert.get("user") or {}).get("is_business_account"),
        "published": (advert.get("counters") or {}).get("published"),
        "img_count": len(full),
    }
    # Detail-Drill war erfolgreich → höhere Confidence.
    item.confidence = 0.85
