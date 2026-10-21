"""Parser für Bazarakis React-Server-Components-Payload (Next.js App Router).

Bazaraki hat sein Frontend im Juni 2026 von server-gerendertem HTML auf den
Next.js App Router mit RSC umgestellt. Seitdem ist im ausgelieferten HTML
**kein** Inserat mehr als DOM zu finden: die Listenseite rendert 60
`animate-pulse`-Skelette, die erst client-seitig durch React befüllt werden.
Alle alten Selektoren (`.advert.js-item-listing`, `[itemprop="price"]`,
`.advert__content-price`, `[itemprop="name"]`) liefern 0 Treffer — genau
deshalb hat der Crawler ab 2026-06-03 nichts mehr gefunden und dabei grün
gemeldet.

Die Daten SIND aber im HTML, nur in anderer Form: Next.js streamt den
RSC-Flight-Payload als Folge von `self.__next_f.push([1,"<json-string>"])`-
Aufrufen in `<script>`-Tags. Konkateniert man die dekodierten Strings,
entsteht ein (nicht wohlgeformter) Flight-Stream, in dem die React-Query-
Caches als JSON eingebettet sind. Daraus lesen wir direkt:

  Listenseite:  `"adverts":[ … ]`  → 60 Inserate inkl. images[] und location
  Detailseite:  `"data":{"id":N, …}` → gallery.full (1600px), features,
                 description, coordinates

Konsequenz für den Crawler: **kein Browser mehr nötig**. Ein httpx-GET auf
die Listenseite genügt; Playwright ist komplett entfallen. Das ist nicht nur
billiger (kein Chromium-Download im CI, kein 8s-Selector-Wait pro Page),
sondern auch robuster — wir hängen nicht mehr an CSS-Klassen, die Bazaraki
bei jedem Redesign neu generiert.

Fragilitäts-Hinweis: das hier ist ein internes Transport-Format ohne
Stabilitätsgarantie. Darum parsen wir so wenig Struktur wie möglich (ein
Anker-String + `json.JSONDecoder().raw_decode`) und verlassen uns NICHT auf
Offsets, Reihenfolge oder die Flight-Row-Syntax selbst. Bricht es trotzdem,
greift der Guard in main.py: 0 Items über alle Subtypes → exit 1.
"""
from __future__ import annotations

import json
import logging
import re

log = logging.getLogger(__name__)

# `self.__next_f.push([1,"…"])` — der zweite Parameter ist ein JSON-String-
# Literal. Das Pattern matcht ein vollständiges Literal inkl. Escapes
# (`[^"\\]|\\.`), damit ein `\"` im Payload den Match nicht vorzeitig beendet.
# Nur `[1, …]`-Rows tragen Nutzlast; `[0, …]`/`[2, …]` sind Bootstrap/Meta.
_CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)')

_LIST_ANCHOR = '"adverts":'
# Gesamt-Trefferzahl des Filters, unabhängig von der aktuellen Page. Dient
# als Plausibilitäts-Gegenprobe: `count > 0` bei 0 extrahierten Adverts auf
# Page 1 heißt "Payload-Format gewandert", nicht "Kategorie ist leer".
_COUNT_RE = re.compile(r'"count":\s*(\d+)')


def extract_payload(html: str) -> str:
    """Konkateniert alle Flight-Chunks des Dokuments zu einem String.

    Leerer String, wenn das Dokument keine `__next_f`-Rows hat (z. B. eine
    Cloudflare-Challenge oder eine Fehlerseite statt der Listenseite).
    """
    chunks = _CHUNK_RE.findall(html)
    if not chunks:
        return ""
    out: list[str] = []
    for raw in chunks:
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            # Einzelner kaputter Chunk darf den Rest nicht mitnehmen — die
            # Adverts können im nächsten liegen.
            continue
    return "".join(out)


def _decode_at(
    payload: str, anchor: str, key: str | None = None
) -> tuple[object | None, int]:
    """Dekodiert den JSON-Wert, der im Payload hinter `key` steht.

    `anchor` lokalisiert die Stelle, `key` sagt, wo der Wert beginnt. Beides
    zu trennen ist nötig, weil der Detail-Anker einen Teil des Wertes
    mitnimmt, um das richtige Objekt zu finden: gesucht wird
    `"data":{"id":123,`, dekodiert werden muss aber ab `"data":` — sonst
    beginnt das Slice mitten im Objekt und `raw_decode` scheitert.
    Default: `key` == `anchor`.

    `raw_decode` liest genau einen Wert und ignoriert allen Folgetext — damit
    kommen wir ohne wohlgeformtes Gesamt-JSON aus. Returned (value, index des
    Ankers) oder (None, -1).
    """
    i = payload.find(anchor)
    if i < 0:
        return None, -1
    try:
        value, _ = json.JSONDecoder().raw_decode(payload[i + len(key or anchor):])
    except json.JSONDecodeError as e:
        log.debug("raw_decode nach %r fehlgeschlagen: %s", anchor, e)
        return None, i
    return value, i


def extract_list_adverts(html: str) -> list[dict]:
    """Die Inserate einer Listenseite. Leere Liste = Pagination-Ende.

    Bazaraki liefert hinter dem letzten Ergebnis weiterhin HTTP 200 mit
    `"adverts":[]` (kein Redirect auf die letzte Page mehr, wie es das alte
    server-gerenderte Frontend tat). `[]` ist damit das saubere Ende-Signal.
    """
    payload = extract_payload(html)
    if not payload:
        return []
    value, _ = _decode_at(payload, _LIST_ANCHOR)
    if not isinstance(value, list):
        return []
    return [a for a in value if isinstance(a, dict) and a.get("id")]


def extract_list_total_count(html: str) -> int | None:
    """Gesamt-Trefferzahl des Filters (`count`), unabhängig von der Page."""
    payload = extract_payload(html)
    if not payload:
        return None
    m = _COUNT_RE.search(payload)
    return int(m.group(1)) if m else None


def extract_detail_advert(html: str, advert_id: str | int) -> dict | None:
    """Das Advert-Objekt einer Detailseite, adressiert über seine ID.

    Der Payload enthält mehrere dehydrierte React-Query-Caches (Flat-Pages,
    Übersetzungen, Similar-Listings). Wir ankern deshalb auf
    `"data":{"id":<ID>,` — die ID kennen wir aus Pass 1, und damit greifen
    wir garantiert das richtige Objekt statt des ersten `"data":`-Vorkommens.
    """
    payload = extract_payload(html)
    if not payload:
        return None
    anchor = f'"data":{{"id":{advert_id},'
    value, _ = _decode_at(payload, anchor, key='"data":')
    if isinstance(value, dict) and str(value.get("id")) == str(advert_id):
        return value
    return None


# ---------- Feld-Helfer ----------

# `location` kommt als "Stadt — Bezirk" (U+2014 EM DASH). Der Bezirk selbst
# kann gewöhnliche Bindestriche enthalten ("Paphos — Paphos - Agios
# Theodoros"), darum NUR am Em-Dash splitten und nur am ersten.
_EM_DASH = "—"


def split_location(location: str | None) -> tuple[str | None, str | None]:
    """'Limassol — Agios Tychon' → ('Limassol', 'Agios Tychon')."""
    if not location:
        return None, None
    parts = location.split(_EM_DASH, 1)
    city = parts[0].strip() or None
    district = parts[1].strip() if len(parts) > 1 else None
    return city, (district or None)


def parse_price(advert: dict) -> float | None:
    """Preis aus `price_without_currency`.

    Das Feld ist bei Bazaraki durchgängig eine reine Ziffernfolge ("1349",
    "1250000") — die fehleranfällige Locale-Parserei des alten
    LIST_EXTRACT_JS (deutsches Format: '.' Tausender, ',' Dezimal, plus
    Range-Schutz für "€1000 - €2000") ist damit erledigt. Fallback auf den
    formatierten `price`-String nur, falls das Feld fehlt.
    """
    raw = advert.get("price_without_currency")
    if raw not in (None, ""):
        try:
            return float(str(raw).replace(",", "."))
        except ValueError:
            pass
    # Fallback: "€1.349" → 1349. Punkt ist hier immer Tausender-Trenner.
    text = advert.get("price")
    if isinstance(text, str):
        digits = re.sub(r"[^\d]", "", text)
        if digits:
            return float(digits)
    return None


_SQM_RE = re.compile(r"^([\d.,]+)\s*m²$")


def parse_size_from_features(features: list | None) -> int | None:
    """Wohnfläche aus den Listenseiten-`features`.

    Die Liste ist ikonen-basiert und ohne Labels: Häuser liefern z. B.
    ['2', '2', '92 m²', '225 m²', 'Uncovered'] — Schlafzimmer, Bäder,
    überdeckte Fläche, Grundstück, Parken. Zwei m²-Werte sind also möglich;
    der ERSTE ist die überdeckte Fläche und damit das, was `size_sqm` bei
    Home4U bedeutet. Plots haben nur einen Wert (die Grundstücksfläche) —
    dort ist er eindeutig.

    Der Detail-Drill überschreibt das später mit dem benannten Feature
    ("Property area"), das keine Reihenfolge-Annahme braucht.
    """
    if not features:
        return None
    for f in features:
        if not isinstance(f, dict):
            continue
        m = _SQM_RE.match((f.get("text") or "").strip())
        if not m:
            continue
        # "4.014 m²" → 4014: Punkt ist Tausender-Trenner, Komma desgleichen.
        digits = re.sub(r"[^\d]", "", m.group(1))
        if digits:
            return int(digits)
    return None


def parse_detail_features(advert: dict) -> dict[str, str]:
    """Die benannten Detail-Features als {label: value}.

    Ersetzt `parse_chars()`: der alte Weg las einen Plain-Text-Block aus dem
    DOM und zerlegte ihn mit einer `label: value`-Regex. Jetzt kommen die
    Paare strukturiert aus dem Payload ("Property area" → "50 m²").
    """
    out: dict[str, str] = {}
    for f in advert.get("features") or []:
        if not isinstance(f, dict):
            continue
        name = (f.get("name") or "").strip()
        value = f.get("value")
        if name and value not in (None, ""):
            out[name] = str(value).strip()
    return out
