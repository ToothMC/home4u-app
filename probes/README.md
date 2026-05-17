Discovery-Probes für neue Crawler-Quellen.

Standalone-Scripts, die ein Source-Recon machen OHNE in die DB zu
schreiben. Ziel: ermitteln, wieviele CY-Listings real greifbar sind,
welche Detail-Felder die Detail-Pages liefern, und wie schnell ein
voller Crawl wäre — bevor wir einen vollen Crawler aufsetzen.

Layout: ein Python-File pro Source, kein Build-System. Output: stdout-
Stats + JSON-Sample in `probes/out/`.

Run:

```sh
# Voraussetzung: httpx, lxml
pip install "httpx>=0.28" "lxml>=5.0"

python3 probes/apits_probe.py        # A Place in the Sun (CY only, RoC cities)
python3 probes/prian_probe.py        # Prian.ru CY (RU diaspora)
```

Env-Tuning:

| var | default | wofür |
|---|---|---|
| `PROBE_MAX_PAGES` | 5 | max Listing-Pages pro Kategorie/City (für Smoke-Run) |
| `PROBE_SAMPLE_DETAILS` | 20 | wie viele Detail-Pages aus dem Pool tatsächlich parsen |
| `PROBE_RATE_S` | 1.5 | Pause zwischen Requests (politisch) |

Defaults sind konservativ. Für eine echte Volumen-Hochrechnung
`PROBE_MAX_PAGES=999` setzen — dauert dann je 5–15min pro Source.
