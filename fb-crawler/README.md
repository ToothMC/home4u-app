# Home4U — FB-Crawler (Spur 1.1)

Indexieren von FB-Gruppen-Posts über **CDP-Attach an dein Chrome**. Du
loggst Dich ein, öffnest Group-Tabs, scrollst manuell. Der Python-Crawler
verbindet sich passiv über `--remote-debugging-port`, liest den DOM,
klassifiziert via Haiku 4.5 und upserted in `listings` (`source='fb'`).

## Compliance

- **Kein Auto-Login, kein Auto-Scroll, kein Headless** — entspricht
  Whitepaper §2.1 *("Kein automatisches Einloggen, kein Fetch ohne
  User-Scroll")*.
- **G0-Gate (DSGVO + Meta-ToS-Anwaltsgutachten) noch offen** → nur
  internes Indexieren, keine Outbound-Kontaktaufnahme. Genauso wie der
  Bazaraki-Crawler operiert dieser Crawler im Pilot-Modus bis G0 grün ist.
- **Profil-Isolation:** Eigenes Chrome-Profil unter
  `~/.home4u-fb-chrome/`, nicht dein Haupt-Profil.

## Stack

- Python 3.11 + Playwright (CDP-Attach-Modus, **kein** Browser-Launch)
- Anthropic Haiku 4.5 (Klassifikator + Strukturextraktor)
- Supabase RPC `bulk_upsert_fb_listings` (Migration 0021) — handelt
  Phone/Raw-Text-Encryption serverseitig
- Lokale SQLite-State-DB für Dedup (vermeidet doppelte LLM-Calls)

## Setup

```bash
cd fb-crawler

# Python-Env
python -m venv .venv && source .venv/bin/activate
pip install -e .
python -m playwright install chromium  # nur für Tests, attach nutzt System-Chrome

# Env
cp .env.example .env
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY eintragen

# Migration ausspielen (im supabase-Workflow des Hauptprojekts)
# 0021_fb_indexer.sql

# Group-Liste pflegen — Platzhalter REPLACE_ME_* in src/groups.json ersetzen
$EDITOR src/groups.json
```

## Workflow

```bash
# Terminal 1: Chrome mit Debug-Port starten (isoliertes Profil)
./scripts/start-chrome.sh

# … in Chrome bei FB einloggen, 1-N Group-Tabs öffnen, scrollen …

# Terminal 2: Crawler im Watch-Modus (Polling alle 30s)
python -m src.main --watch

# Oder einmaliger Pass
python -m src.main --once

# Mit Stale-Markierung am Ende (>14d unseen → status='stale')
python -m src.main --once --mark-stale
```

### Test-/Debug-Modi

```bash
# Posts nur loggen, kein Anthropic-Call (Quota-Schutz)
SKIP_LLM=1 python -m src.main --once

# Klassifizieren+Extrahieren, aber kein DB-Write
DRY_RUN=1 python -m src.main --once

# Nur bestimmte Städte
CITIES=limassol,paphos python -m src.main --watch

# Nur bestimmte Gruppen-IDs
GROUP_IDS=123456789,987654321 python -m src.main --watch
```

## Schema-Mapping

| FB-Post | listings-Spalte | Notiz |
|---|---|---|
| `post_id` (aus Permalink) | `external_id` | numerisch |
| `author_id` | `fb_user_id` (Blacklist-Check) | sticky `opted_out` |
| `text` | `raw_text_enc` | RPC-encrypted (pgp_sym_encrypt) |
| `images[]` (high-res) | `media` | Cover ≥ 720px |
| Klassifikator-`category` | `type` (rent/sale) | wanted/other → nicht indexiert |
| Klassifikator-`language` | `language` | de/en/ru/el |
| Extraktor-`price` | `price` + `currency` | Haiku liefert beides |
| Extraktor-`contact_phone` | `contact_phone_enc` | RPC-encrypted, E.164 |
| sha256(E.164) | `contact_phone_hash` | (a) Blacklist-Check (`fb_contact_blacklist`), (b) Cross-Listing-Image-Match (Indexer-Spec v2.0 §6.2 `duplicate_images`) |
| Extraktor-`confidence` | `confidence` | Selbsteinschätzung des LLM, 0..1 |
| Extraktor-Roh-Output | `extracted_data.llm_extraction` | jsonb, Re-Processing ohne Re-Crawl |
| Group-City-Hint | `location_city` (Default) | Extraktor kann überschreiben |
| — | `dedup_hash` | `fb:<post_id>` |
| — | `source` | `'fb'` |
| — | `scam_score` / `scam_flags` | **Vom Score-Worker gesetzt** (Indexer-Spec v2.0 §6.3, §11 A2). Crawler lässt sie leer; Sticky-Pattern via `scam_checked_at`. |

## Bild-Qualität

Cover-Bilder müssen ≥ 720px Breite haben (Memory-Vorgabe). Pipeline:

1. `srcset` lesen → größte `<n>w`-Variante wählen
2. Wenn `srcset` fehlt: FB-CDN-Suffix-Rewrite `_s.jpg` → `_n.jpg`
3. Mehrere Bilder pro Post werden nach Auflösung absteigend sortiert →
   Cover an Index 0
4. Tests: `pytest tests/test_parser.py -k image_or_srcset_or_cover`

Spotcheck nach Pilot-Lauf:
```sql
select id, media[1] from listings where source='fb' order by random() limit 10;
```
URLs öffnen → müssen hochauflösend laden, **nicht** `_s.jpg`.

## Verifikation

```bash
# Unit-Tests
pip install -e '.[dev]'
pytest

# End-to-End Spotcheck nach Pilot-Lauf
psql "$DATABASE_URL" -c "
  select location_city, count(*), max(last_seen)
  from listings where source = 'fb'
  group by location_city order by 1;
"
```

**Akzeptanz (Whitepaper §2.4):**
- ≥ 300 FB-Inserate im Index nach Pilot-Scrolls
- Dedup-Rate < 10 %
- Top-Felder (Lage, Preis, Zimmer) ≥ 80 % korrekt (Stichprobe 50)
- `media[0]` immer ≥ 720px

## Out-of-Scope (Phase 0)

- Admin-Review-UI (kommt mit G0 grün)
- Outbound-Kontaktaufnahme (Spur 2.B, gated)
- Auto-Scroll / Auto-Navigation (verletzt Compliance)
- Cron-Trigger (CDP-Attach erfordert User-Browser)
