"""Diagnose-Script: zeigt, was im RSC-Flight-Payload einer Bazaraki-URL steht.

Löst den alten DOM-Probe ab. Der prüfte Selektoren (JSON-LD, Galerie-`<img>`,
background-image-Divs) — die sind seit der Next.js-App-Router-Umstellung alle
leer, weil im ausgelieferten HTML kein Inserat mehr als DOM existiert.

Was der Probe jetzt beantwortet:
  - Kommt überhaupt ein Flight-Payload an, oder eine CF-Challenge?
  - Enthält die Listenseite `"adverts":[…]`, und wie viele?
  - Welche Galerie-Varianten hat eine Detailseite, und wie breit sind sie?
    (Damit lässt sich nachvollziehen, woher ein 160px-Thumbnail in media[0]
    kommt, ohne den Produktiv-Crawler anzufassen.)

Lokal: uv run python -m src.probe_dom <bazaraki-url>
CI:    via .github/workflows/probe-bazaraki-dom.yml
"""
from __future__ import annotations

import json
import re
import sys

from .crawler import _cover_width, http_client
from .flight import (
    extract_detail_advert,
    extract_list_adverts,
    extract_list_total_count,
    extract_payload,
    parse_detail_features,
)

_ADV_ID_RE = re.compile(r"/adv/(\d+)")


def _probe_list(html: str) -> None:
    adverts = extract_list_adverts(html)
    total = extract_list_total_count(html)
    print(f"[list] count (Filter-Gesamttreffer): {total}")
    print(f"[list] adverts im Payload: {len(adverts)}")
    if not adverts:
        # Genau diese Kombination war der 4,5-Monate-Blindflug: Seite lädt,
        # Payload da, aber unter dem erwarteten Schlüssel steht nichts.
        if total:
            print("[list] !! 0 adverts bei count>0 — Payload-Format gewandert?")
        return
    first = adverts[0]
    print(f"[list] keys: {sorted(first.keys())}")
    for a in adverts[:3]:
        print(
            f"  - {a.get('id')} {a.get('price_without_currency')!r} "
            f"{a.get('location')!r} imgs={len(a.get('images') or [])} "
            f"url={a.get('url')!r}"
        )


def _probe_detail(html: str, advert_id: str) -> None:
    advert = extract_detail_advert(html, advert_id)
    if advert is None:
        print(f"[detail] !! kein Advert-Objekt für id={advert_id} im Payload")
        return
    print(f"[detail] keys: {sorted(advert.keys())}")
    location = advert.get("location") or {}
    print(f"[detail] location: {location.get('name')!r}")
    print(f"[detail] coordinates: {location.get('coordinates')}")
    desc = advert.get("description") or ""
    print(f"[detail] description: {len(desc)} Zeichen")
    print(f"[detail] features: {json.dumps(parse_detail_features(advert), ensure_ascii=False)}")

    gallery = advert.get("gallery") or {}
    for variant in ("full", "preview", "small"):
        urls = [u for u in (gallery.get(variant) or []) if isinstance(u, str)]
        print(f"[gallery.{variant}] {len(urls)} entries")
        for url in urls[:3]:
            # Breite per Range-Request — so wird sichtbar, welche Variante
            # hi-res ist. `full` ist 1600px, `preview` der 160px-Strip.
            print(f"  - {_cover_width(url)}px  {url}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m src.probe_dom <bazaraki-url>", file=sys.stderr)
        sys.exit(2)
    url = sys.argv[1]

    with http_client() as http:
        resp = http.get(url)
    html = resp.text
    print(f"\n=== Bazaraki RSC Probe: {url} ===\n")
    print(f"[http] {resp.status_code}, {len(html)} Bytes HTML")

    payload = extract_payload(html)
    print(f"[payload] {len(payload)} Zeichen aus __next_f-Chunks")
    if not payload:
        # Keine Flight-Rows heißt: wir haben nicht die Seite bekommen, die wir
        # wollten. Typisch eine CF-Challenge von einer Datacenter-IP aus.
        print("[payload] !! keine __next_f-Chunks — CF-Challenge oder Fehlerseite?")
        print(f"[payload] HTML[0:500]: {html[:500]!r}")
        sys.exit(1)

    m = _ADV_ID_RE.search(url)
    if m:
        _probe_detail(html, m.group(1))
    else:
        _probe_list(html)


if __name__ == "__main__":
    main()
