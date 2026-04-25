# Home4U — Bazaraki Crawler (Spur 1.2)

Tägliches Indexieren von Bazaraki-Inseraten (Miete + Kauf) für Limassol,
Paphos, Larnaca, Nicosia, Famagusta. Schreibt in die `listings`-Tabelle
des Home4U-Supabase-Projekts (`source = 'bazaraki'`).

## Stack

- Python 3.11 + Playwright (Chromium headless)
- Supabase REST API (Service-Role-Upsert)
- GitHub Actions Cron (täglich 04:00 UTC)
- robots.txt-respektierend, Rate-Limit 1 req / 3s, eigener User-Agent

## Setup (lokal)

```bash
cd bazaraki-crawler
python -m venv .venv && source .venv/bin/activate
pip install -e .
python -m playwright install chromium

cp .env.example .env
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY eintragen
```

## Lauf

```bash
# Dry-run (kein DB-Write)
DRY_RUN=1 python -m src.main

# Nur eine Stadt + Type, max 2 Pages
CITIES=limassol TYPES=rent MAX_PAGES_PER_CITY=2 python -m src.main

# Voller Lauf
python -m src.main
```

## Schema-Mapping

| Bazaraki | listings-Spalte | Notiz |
|---|---|---|
| URL `/adv/<id>` | `external_id` | numerische ID |
| price (numerisch) | `price` | EUR (currency hardcoded) |
| URL-Slug (`studio` / `N-bedroom`) | `rooms` | Studio = 0 |
| Cover-Bild | `media[0]` | cdn1.bazaraki.com URL |
| Stadt | `location_city` | aus config |
| — | `dedup_hash` | `bazaraki:<external_id>` |

Nicht im Phase-0-Crawl: `location_district`, `size_sqm`, `contact_phone`,
volle Beschreibung, weitere Bilder. Kommen via Detail-Page-Drilling in
Iteration 2.

## Cron / GitHub Actions

`.github/workflows/daily.yml` läuft täglich 04:00 UTC. Manueller Trigger
über GitHub UI mit Inputs (cities, types, max_pages, dry_run).

**Pflicht-Secrets** im GitHub-Repo (Settings → Secrets):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Verifikation nach Lauf

```sql
select location_city, count(*), max(last_seen)
from listings where source = 'bazaraki'
group by location_city
order by 1;
```

## Compliance-Notiz

Whitepaper §7 + §0.1: Crawler läuft im Pilot-Modus, niemand wird kontaktiert
bevor das Anwalts-Gutachten zu DSGVO + Bazaraki-ToS vorliegt. Listings
sind nur intern indexiert. Outbound-Bridge-Outreach ist gated bis G0 grün.
