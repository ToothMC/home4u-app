# Home4U — Großentwickler-Bundle-Crawler (Sprint D)

Indexiert die Direktvertriebs-Inventories der CY-Großentwickler. Quelle:
`source = 'cy_developer'` (eine source für alle Bauträger, Differenzierung
über `external_id`-Prefix `{slug}:{listing_id}` und über
`extracted_data.developer`).

## Architektur

Pro Bauträger ein Modul mit zwei Funktionen:
- `discover(client) -> Iterable[str]` — alle Detail-URLs sammeln
- `parse(client, url) -> ParsedListing | None` — eine URL → ein Listing

Der gemeinsame Orchestrator [main.py](src/main.py) iteriert pro Developer:
discover → indexed-filter → streaming-fetch + parse + (pHash) + upsert.
Streaming-Architektur identisch zu cre-crawler/index-crawler.

Watchdog (`MAX_RUNTIME_S`, default 90min) stoppt sauber vor dem nächsten
Listing. Workflow-`timeout-minutes` muss +10min Headroom bieten.

## Status

| Bauträger | Modul | Status | Discovery | Granularität |
|---|---|---|---|---|
| **Aristo Developers** | [aristo.py](src/aristo.py) | ✅ implementiert | Stadt-Filter-Pages, paginiert | pro Projekt |
| Pafilia | [_stubs.py](src/_stubs.py) | 🟡 Stub | sitemap_index.xml /properties.xml | TODO |
| Leptos Estates | [_stubs.py](src/_stubs.py) | 🟡 Stub | sitemap_index.xml /property.xml | TODO |
| Cybarco | [_stubs.py](src/_stubs.py) | 🟡 Stub | /developments/ Index | TODO (Crawl-delay 10s!) |
| Korantina Homes | [_stubs.py](src/_stubs.py) | 🟡 Stub | /projects/{slug}/ | TODO |
| Imperio Properties | [_stubs.py](src/_stubs.py) | 🟡 Stub | /our-projects/ | TODO |

Stubs liefern leere Listen — Orchestrator skipped sie ohne Lärm. Sobald
implementiert: Stub-Eintrag in `_stubs.py` durch echtes Modul `src/{name}.py`
ersetzen, in `main.py` `DEVELOPER_MODULES` registrieren.

## Lokal testen

```bash
cd dev-crawler
python -m venv .venv && source .venv/bin/activate
pip install -e .

# .env
cp .env.example .env  # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY eintragen

# DRY_RUN: keine DB-Writes, nur loggen was rausgeht
DRY_RUN=1 DEVELOPERS=aristo MAX_LISTINGS=5 python -m src.main
```

## Per-Developer-Implementierungs-Hinweise

Siehe [_stubs.py](src/_stubs.py) Modul-Docstring für die einzelnen
Bauträger-spezifischen Sitemap-Strukturen, ToS-Beschränkungen (Cybarco
Crawl-delay 10s!) und URL-Patterns.

**Gemeinsames Muster** für ein neues Modul (Beispiel: pafilia.py):

```python
from .base import ParsedListing

DEVELOPER = "pafilia"
BASE_URL = "https://www.pafilia.com"

def discover(client):
    # Sitemap-Walk oder Listing-Page-Pagination
    return [...]  # Liste von Detail-URLs

def parse(client, url):
    # Detail-Page → ParsedListing (siehe base.py für Schema)
    return ParsedListing(listing_id=..., listing_type="sale", ...)
```

## Workflow

[bazaraki-daily.yml](../.github/workflows/dev-crawler-daily.yml) läuft
4× täglich (alle 6h, Slot 03:00/09:00/15:00/21:00 UTC — 30min versetzt zu
den anderen Crawlern). MAX_RUNTIME_S=5400 (90min), timeout-minutes=100.

## Granularitäts-Entscheidung

Bauträger publizieren keine Unit-IDs konsistent. Wir indexieren auf
**Projekt-Ebene** (ein Listing = ein Development), nicht auf Unit-Ebene.
Cross-Source-Dedup gegen Bazaraki/INDEX läuft über pHash + Title-Embedding —
ein Aristo-Projekt das via Makler auf Bazaraki landet, wird per Cover-pHash
als canonical-Master der Bauträger-Originale erkannt.
