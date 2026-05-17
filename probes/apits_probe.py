"""Probe: A Place in the Sun (aplaceinthesun.com) — CY Republic only.

Walked Discovery-Pfad:
  /property/cyprus/{city} mit ?pageNumber=N für jede der vier RoC-Cities
  (paphos, limassol, larnaca, nicosia). TRNC-Bezirk (famagusta + kyrenia)
  wird via city-Filter automatisch ausgeschlossen.

Output:
  - stdout-Stats (total reachable, per-city counts, parse-success-rate)
  - probes/out/apits_sample.json — bis zu PROBE_SAMPLE_DETAILS geparste Listings

Kein DB-Write. Kein State. Idempotent.

Run:
  python3 probes/apits_probe.py
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import httpx
from lxml import html as lxml_html

BASE = "https://www.aplaceinthesun.com"
ROC_CITIES = ["paphos", "limassol", "larnaca", "nicosia"]
UA = "Home4U-Aggregator/0.1 (+https://home4u.ai/about)"


@dataclass
class Listing:
    url: str
    listing_id: str
    title: str | None = None
    price_gbp: int | None = None
    price_eur: int | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    city: str | None = None
    cover: str | None = None
    description_chars: int = 0
    parse_errors: list[str] = field(default_factory=list)


def _int_or_none(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(r"[0-9][0-9,]*", s)
    return int(m.group(0).replace(",", "")) if m else None


def _parse_meta(tree, name: str) -> str | None:
    """APITS verwendet Schema.org-Style <meta itemprop="bedrooms" content="2">."""
    for attr in ("itemprop", "name"):
        for el in tree.xpath(f"//meta[@{attr}='{name}']"):
            v = el.get("content")
            if v:
                return v.strip()
    return None


def _parse_og(tree, prop: str) -> str | None:
    """APITS schreibt <meta name="og:image" ...> (statt property=). Beides probieren."""
    for attr in ("property", "name"):
        for el in tree.xpath(f"//meta[@{attr}='og:{prop}']"):
            v = el.get("content")
            if v:
                return v.strip()
    return None


def _extract_listing_urls(html_text: str) -> list[str]:
    return sorted(set(re.findall(r'/property/details/ap\d+/[^"?]+', html_text)))


def _fetch(client: httpx.Client, path: str) -> str | None:
    try:
        r = client.get(BASE + path, timeout=15.0)
        if r.status_code != 200:
            return None
        return r.text
    except Exception:
        return None


def discover_city(client: httpx.Client, city: str, max_pages: int, rate: float) -> tuple[int, list[str]]:
    """Returns (total_advertised, all_detail_urls). Stoppt bei leerer Seite."""
    total_advertised = 0
    urls: set[str] = set()
    for page in range(1, max_pages + 1):
        path = f"/property/cyprus/{city}" + (f"?pageNumber={page}" if page > 1 else "")
        body = _fetch(client, path)
        if body is None:
            logging.warning("city=%s page=%d HTTP-fehler, abbruch", city, page)
            break
        if page == 1:
            m = re.search(r"([\d,]+)\s+propert", body)
            if m:
                total_advertised = int(m.group(1).replace(",", ""))
        found = _extract_listing_urls(body)
        new = [u for u in found if u not in urls]
        urls.update(found)
        logging.info("  %s p%d: +%d (total bisher %d, advertised %d)",
                     city, page, len(new), len(urls), total_advertised)
        if not new:
            logging.info("  %s p%d: keine neuen URLs — Ende erreicht", city, page)
            break
        time.sleep(rate)
    return total_advertised, sorted(urls)


def parse_detail(client: httpx.Client, path: str) -> Listing:
    out = Listing(url=BASE + path, listing_id=_id_from_path(path))
    body = _fetch(client, path)
    if body is None:
        out.parse_errors.append("fetch_failed")
        return out
    try:
        tree = lxml_html.fromstring(body)
    except Exception as e:
        out.parse_errors.append(f"parse_html: {e}")
        return out

    # Titel
    h1 = tree.xpath("//h1")
    if h1:
        out.title = (h1[0].text_content() or "").strip() or None
    if not out.title:
        out.title = _parse_og(tree, "title")

    # Preis: APITS zeigt £ + € parallel — wir nehmen beide.
    body_norm = re.sub(r"\s+", " ", body)
    m_gbp = re.search(r"£([\d,]+)", body_norm)
    if m_gbp:
        out.price_gbp = _int_or_none(m_gbp.group(1))
    m_eur = re.search(r"€([\d,]+)", body_norm)
    if m_eur:
        out.price_eur = _int_or_none(m_eur.group(1))

    # Schlafzimmer/Bäder
    out.bedrooms = _int_or_none(_parse_meta(tree, "bedrooms"))
    out.bathrooms = _int_or_none(_parse_meta(tree, "bathrooms"))

    # City aus URL-Slug ableiten (Detail-URL hat z.B. "...-in-limassol-cyprus")
    slug = path.lower()
    for city in ROC_CITIES + ["famagusta", "kyrenia"]:
        if f"-{city}-" in slug or f"-{city}/" in slug or slug.endswith(f"-{city}"):
            out.city = city
            break

    # Cover
    out.cover = _parse_og(tree, "image")

    # Description-Größe als Qualitäts-Indikator
    desc_meta = tree.xpath("//meta[@name='description']")
    if desc_meta:
        out.description_chars = len(desc_meta[0].get("content") or "")

    if out.title is None:
        out.parse_errors.append("no_title")
    if out.price_gbp is None and out.price_eur is None:
        out.parse_errors.append("no_price")

    return out


def _id_from_path(path: str) -> str:
    m = re.search(r"/ap(\d+)/", path)
    return m.group(1) if m else path


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )
    max_pages = int(os.getenv("PROBE_MAX_PAGES", "5"))
    sample_n = int(os.getenv("PROBE_SAMPLE_DETAILS", "20"))
    rate = float(os.getenv("PROBE_RATE_S", "1.5").replace(",", "."))

    out_dir = Path(__file__).parent / "out"
    out_dir.mkdir(exist_ok=True)

    started = time.time()
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
    }

    with httpx.Client(headers=headers, follow_redirects=True) as client:
        logging.info("APITS Probe: max_pages=%d sample=%d rate=%.1fs", max_pages, sample_n, rate)
        per_city: dict[str, dict] = {}
        all_urls: list[str] = []
        for city in ROC_CITIES:
            logging.info("=== City: %s ===", city)
            advertised, urls = discover_city(client, city, max_pages, rate)
            per_city[city] = {"advertised_total": advertised, "discovered_on_walk": len(urls)}
            all_urls.extend(urls)

        unique = sorted(set(all_urls))
        logging.info("Discovery fertig: %d unique detail-URLs aus %d total", len(unique), len(all_urls))

        # Sample-Parse
        random.seed(42)
        sample = random.sample(unique, min(sample_n, len(unique))) if unique else []
        logging.info("Parse %d sample detail-pages …", len(sample))
        parsed: list[Listing] = []
        for i, path in enumerate(sample, 1):
            p = parse_detail(client, path)
            parsed.append(p)
            logging.info("  %d/%d %s — title=%r price=£%s €%s beds=%s baths=%s city=%s errs=%s",
                         i, len(sample), p.listing_id, (p.title or "")[:50],
                         p.price_gbp, p.price_eur, p.bedrooms, p.bathrooms,
                         p.city, ",".join(p.parse_errors) or "-")
            time.sleep(rate)

    elapsed = time.time() - started
    # Aggregierte Stats
    with_title = sum(1 for p in parsed if p.title)
    with_price = sum(1 for p in parsed if p.price_gbp or p.price_eur)
    with_beds = sum(1 for p in parsed if p.bedrooms is not None)
    with_cover = sum(1 for p in parsed if p.cover)
    city_counts: dict[str, int] = {}
    for p in parsed:
        city_counts[p.city or "<unknown>"] = city_counts.get(p.city or "<unknown>", 0) + 1

    summary = {
        "source": "apits",
        "elapsed_s": round(elapsed, 1),
        "per_city_advertised": {c: per_city[c]["advertised_total"] for c in ROC_CITIES},
        "per_city_discovered_on_walk": {c: per_city[c]["discovered_on_walk"] for c in ROC_CITIES},
        "total_advertised_roc": sum(per_city[c]["advertised_total"] for c in ROC_CITIES),
        "total_discovered_unique_urls": len(unique),
        "sample_size": len(parsed),
        "sample_parse_quality": {
            "with_title": with_title,
            "with_price": with_price,
            "with_bedrooms": with_beds,
            "with_cover": with_cover,
        },
        "sample_city_split": city_counts,
    }

    print("\n=== APITS PROBE SUMMARY ===")
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    out_file = out_dir / "apits_sample.json"
    out_file.write_text(
        json.dumps(
            {"summary": summary, "listings": [asdict(p) for p in parsed]},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nSample geschrieben: {out_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
