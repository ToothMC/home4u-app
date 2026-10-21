# Home4U — Bazaraki Crawler (Spur 1.2)

Tägliches Indexieren von Bazaraki-Inseraten (Miete + Kauf) für Limassol,
Paphos, Larnaca, Nicosia, Famagusta. Schreibt in die `listings`-Tabelle
des Home4U-Supabase-Projekts (`source = 'bazaraki'`).

## Stack

- Python 3.11 + httpx (kein Browser)
- Supabase REST API (Service-Role-Upsert)
- GitHub Actions Cron auf dem **self-hosted mac-mini-Runner**
- robots.txt-respektierend, Rate-Limit 1 req / 3s, eigener User-Agent

### Warum kein Browser mehr

Bazaraki läuft seit Juni 2026 auf dem Next.js App Router mit React Server
Components. Im ausgelieferten HTML steht kein Inserat mehr als DOM — die
Listenseite rendert 60 `animate-pulse`-Skelette, die erst client-seitig
befüllt werden. Die Daten stecken stattdessen im RSC-Flight-Payload
(`self.__next_f.push([1,"…"])`), aus dem `src/flight.py` sie liest. Ein
httpx-GET genügt damit für Liste UND Detail.

Dass die alten Selektoren still auf 0 Treffer liefen, blieb vom 2026-06-03
bis 2026-10-21 unbemerkt: der Crawler meldete bedingungslos exit 0, und ein
FAST_MODE-Pre-Touch frischte `last_seen` auf, bevor überhaupt gecrawlt wurde
— der Health-Check maß sich selbst. 55.715 Inserate froren ein. Beides ist
seit Commit 8c4f2a0 behoben (0 Items → exit 1; Pre-Touch erst nach
verifizierten Treffern).

### Warum mac-mini und nicht ubuntu-latest

Bazaraki liegt hinter Cloudflare, und CF liefert Datacenter-IPs keine echte
Seite. Von einem GitHub-Hosted-Runner kommt eine Challenge statt des
Payloads → 0 Items → exit 1. Der mac-mini hat eine Cyta-Residential-IP.
Dasselbe gilt für `cdn1.bazaraki.com`, das pHash und Cover-Breiten-Check
brauchen (siehe `media-check-daily.yml`).

## Setup (lokal)

```bash
cd bazaraki-crawler
python -m venv .venv && source .venv/bin/activate
pip install -e .

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

`.github/workflows/bazaraki-daily.yml` läuft 4×/Tag (00, 06, 12, 18 UTC) auf
dem mac-mini-Runner. Manueller Trigger über GitHub UI mit Inputs (cities,
types, max_pages, dry_run, …).

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

Neuzugänge (das Signal, das 4,5 Monate flach lag):

```sql
select date_trunc('day', first_seen) as tag, count(*)
from listings where source = 'bazaraki' and first_seen > now() - interval '7 days'
group by 1 order by 1;
```

Payload-Drift diagnostizieren, ohne den Produktiv-Crawler anzufassen:

```bash
python -m src.probe_dom https://www.bazaraki.com/real-estate-to-rent/apartments-flats/larnaka-district-larnaca/
python -m src.probe_dom https://www.bazaraki.com/adv/6777864_2-bedroom-apartment-to-rent/
```

## Compliance-Notiz

Whitepaper §7 + §0.1: Crawler läuft im Pilot-Modus, niemand wird kontaktiert
bevor das Anwalts-Gutachten zu DSGVO + Bazaraki-ToS vorliegt. Listings
sind nur intern indexiert. Outbound-Bridge-Outreach ist gated bis G0 grün.

**Keine Telefonnummern mehr.** Bazarakis `robots.txt` sperrt `/api`, und
genau dort liegt der Endpunkt, den der alte "Show phone"-Click ansprach.
Unabhängig davon liefert Bazaraki Nummern seit dem Redesign nur noch an
Eingeloggte (`permissions.phone == "show_auth_dialogue"`). Es gibt damit
keinen erlaubten Weg mehr; der Crawler versucht es nicht. Die ~28k bereits
gespeicherten Nummern bleiben erhalten (COALESCE im Upsert-RPC).
