# Fixtures

Echte Bazaraki-Seiten, gezogen am 2026-10-21 (nach der Next.js-Umstellung).
Die Tests parsen daraus den RSC-Flight-Payload — ohne Browser.

| Datei | Zweck |
|---|---|
| `rsc_list_limassol_rent_apartments.html` | volle Listenseite, 60 Adverts |
| `rsc_list_famagusta_sale_houses.html` | Kaufpreise + zwei m²-Werte je Card (überdeckt/Grundstück) |
| `rsc_list_past_last_page.html` | hinter der letzten Page: `"adverts":[]` bei `count>0` |
| `rsc_detail_6390114.html` | Detailseite: `gallery.full`, benannte Features, Koordinaten |

## Credentials sind geschwärzt

Bazaraki liefert in seinem Seitenquelltext **fremde Credentials** mit — ein
Mapbox-Access-Token und zwei Google-API-Keys. GitHub Secret Scanning lehnt
einen Push mit ihnen ab (zu Recht), also sind sie ersetzt durch:

- `pk.REDACTED-THIRD-PARTY-TOKEN`
- `AIzaREDACTED-THIRD-PARTY-KEY`

Kein Test berührt diese Felder.

## Fixtures erneuern

```bash
curl -s -A "Home4U-Indexer/0.1 (info@home4u.ai)" "<bazaraki-url>" -o neu.html
```

Danach **unbedingt** schwärzen, sonst wird der Push abgelehnt:

```bash
python3 - <<'EOF'
import re, sys
p = 'neu.html'
s = open(p, encoding='utf-8', errors='replace').read()
s = re.sub(r'(?:sk|pk)\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}', 'pk.REDACTED-THIRD-PARTY-TOKEN', s)
s = re.sub(r'AIza[A-Za-z0-9_-]{30,}', 'AIzaREDACTED-THIRD-PARTY-KEY', s)
open(p, 'w', encoding='utf-8').write(s)
EOF
```
