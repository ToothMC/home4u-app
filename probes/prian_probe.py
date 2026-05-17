"""Probe: Prian.ru — CY Republic, RU-sprachig.

Walked Discovery-Pfad:
  /cyprus/{cat}/?next=N für apartments/houses/commercial_property/land.
  /cyprus/northern-cyprus/ wird explizit ausgeschlossen (TRNC).

Detail-URL-Pattern: prian.ru/cyprus/{listing_id}/

Output:
  - stdout-Stats (advertised, discovered, parse-success)
  - probes/out/prian_sample.json

Kein DB-Write. Idempotent.

Run:
  python3 probes/prian_probe.py
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

BASE = "https://prian.ru"
CATEGORIES = ["apartments", "houses", "commercial_property", "land"]
# Browser-UA: Prian liefert ohne realistischen UA leere Karten.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
PAGE_STEP = 30  # Prian zeigt 30/Seite (data-page="1" + 4 spec = 34 sichtbar)


@dataclass
class Listing:
    url: str
    listing_id: str
    title: str | None = None
    price_eur: int | None = None
    bedrooms: int | None = None  # Russisch: "комнат" = rooms (kein bed/bath-split)
    size_sqm: float | None = None
    city: str | None = None
    cover: str | None = None
    description_chars: int = 0
    parse_errors: list[str] = field(default_factory=list)


def _int_or_none(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(r"[0-9][0-9 ,.]*", s)
    return int(re.sub(r"[ ,.]", "", m.group(0))) if m else None


def _fetch(client: httpx.Client, url: str) -> str | None:
    try:
        r = client.get(url, timeout=15.0)
        if r.status_code != 200:
            return None
        return r.text
    except Exception:
        return None


def discover_category(client: httpx.Client, cat: str, max_pages: int, rate: float) -> tuple[int, list[str]]:
    """Returns (advertised_max_offset, listing_ids)."""
    ids: set[str] = set()
    max_offset_seen = 0
    for page_idx in range(max_pages):
        offset = page_idx * PAGE_STEP
        url = f"{BASE}/cyprus/{cat}/" + (f"?next={offset}" if offset else "")
        body = _fetch(client, url)
        if body is None:
            logging.warning("cat=%s offset=%d HTTP-fehler", cat, offset)
            break
        # Pagination-Max ermitteln (höchstes ?next=N im HTML)
        if page_idx == 0:
            for m in re.finditer(r"\?next=(\d+)", body):
                v = int(m.group(1))
                if v > max_offset_seen:
                    max_offset_seen = v
        # Listing-Cards: data-page="N" data-id="LISTING_ID" auf b-obj-min Container
        new_ids = set(re.findall(r'data-page="\d+"\s+data-id="(\d+)"', body))
        new_ids = {i for i in new_ids if i != "2"}  # data-id="2" ist Filter-UI-Element
        before = len(ids)
        ids.update(new_ids)
        added = len(ids) - before
        logging.info("  %s offset=%d: card-ids=%d new=%d (running=%d, max-offset hint=%d)",
                     cat, offset, len(new_ids), added, len(ids), max_offset_seen)
        if added == 0 and page_idx > 0:
            logging.info("  %s: keine neuen IDs — stop", cat)
            break
        time.sleep(rate)
    return max_offset_seen, sorted(ids)


def parse_detail(client: httpx.Client, listing_id: str, rate: float) -> Listing:
    url = f"{BASE}/cyprus/{listing_id}/"
    out = Listing(url=url, listing_id=listing_id)
    body = _fetch(client, url)
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
        og = tree.xpath("//meta[@property='og:title']/@content")
        out.title = og[0].strip() if og else None

    # Preis: €-Symbol in Prian-HTML, häufig in "320 000 €"-Form
    body_norm = re.sub(r"\s+", " ", body)
    m_eur = re.search(r"([\d\s.,]+)\s*&#8364;|([\d\s.,]+)\s*€", body_norm)
    if m_eur:
        val = m_eur.group(1) or m_eur.group(2)
        out.price_eur = _int_or_none(val)

    # Rooms ("X-комн" oder "X комнат")
    m_rooms = re.search(r"([0-9]+)[\s\-]*комн", body_norm, flags=re.IGNORECASE)
    if m_rooms:
        out.bedrooms = int(m_rooms.group(1))

    # Fläche in m² ("90 м²" oder "90 кв.м")
    m_sqm = re.search(r"([\d,.]+)\s*(?:м²|кв\.?\s*м)", body_norm)
    if m_sqm:
        try:
            out.size_sqm = float(m_sqm.group(1).replace(",", "."))
        except ValueError:
            pass

    # City: prian zeigt in der Detail-Page einen Breadcrumb mit der Stadt
    for known in ["лимасол", "ларнак", "пафос", "никос", "паралимни", "ая-напа"]:
        if known in body_norm.lower():
            out.city = {
                "лимасол": "limassol",
                "ларнак": "larnaca",
                "пафос": "paphos",
                "никос": "nicosia",
                "паралимни": "paralimni",
                "ая-напа": "ayia-napa",
            }[known]
            break

    # Cover
    og_img = tree.xpath("//meta[@property='og:image']/@content")
    out.cover = og_img[0] if og_img else None

    # Description-Größe
    md = tree.xpath("//meta[@name='description']/@content")
    out.description_chars = len(md[0]) if md else 0

    if not out.title:
        out.parse_errors.append("no_title")
    if out.price_eur is None:
        out.parse_errors.append("no_price")

    time.sleep(rate)
    return out


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
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }

    with httpx.Client(headers=headers, follow_redirects=True) as client:
        logging.info("PRIAN Probe: max_pages=%d sample=%d rate=%.1fs", max_pages, sample_n, rate)
        per_cat: dict[str, dict] = {}
        all_ids: list[str] = []
        for cat in CATEGORIES:
            logging.info("=== Category: %s ===", cat)
            max_off, ids = discover_category(client, cat, max_pages, rate)
            per_cat[cat] = {"max_offset_advertised": max_off, "discovered_on_walk": len(ids)}
            all_ids.extend(ids)

        unique = sorted(set(all_ids))
        logging.info("Discovery fertig: %d unique listing-IDs aus %d total", len(unique), len(all_ids))

        random.seed(42)
        sample = random.sample(unique, min(sample_n, len(unique))) if unique else []
        logging.info("Parse %d sample detail-pages …", len(sample))
        parsed: list[Listing] = []
        for i, lid in enumerate(sample, 1):
            p = parse_detail(client, lid, rate)
            parsed.append(p)
            logging.info("  %d/%d %s — title=%r price=€%s rooms=%s sqm=%s city=%s errs=%s",
                         i, len(sample), p.listing_id, (p.title or "")[:50],
                         p.price_eur, p.bedrooms, p.size_sqm, p.city,
                         ",".join(p.parse_errors) or "-")

    elapsed = time.time() - started
    with_title = sum(1 for p in parsed if p.title)
    with_price = sum(1 for p in parsed if p.price_eur)
    with_rooms = sum(1 for p in parsed if p.bedrooms is not None)
    with_sqm = sum(1 for p in parsed if p.size_sqm is not None)
    with_cover = sum(1 for p in parsed if p.cover)
    city_counts: dict[str, int] = {}
    for p in parsed:
        city_counts[p.city or "<unknown>"] = city_counts.get(p.city or "<unknown>", 0) + 1

    # Hochrechnung: max-offset + Listings/page als estimate
    total_advertised = sum(per_cat[c]["max_offset_advertised"] + PAGE_STEP for c in CATEGORIES)

    summary = {
        "source": "prian",
        "elapsed_s": round(elapsed, 1),
        "per_category_max_offset": {c: per_cat[c]["max_offset_advertised"] for c in CATEGORIES},
        "per_category_discovered_on_walk": {c: per_cat[c]["discovered_on_walk"] for c in CATEGORIES},
        "total_advertised_estimate": total_advertised,
        "total_discovered_unique_ids": len(unique),
        "sample_size": len(parsed),
        "sample_parse_quality": {
            "with_title": with_title,
            "with_price": with_price,
            "with_rooms": with_rooms,
            "with_sqm": with_sqm,
            "with_cover": with_cover,
        },
        "sample_city_split": city_counts,
    }

    print("\n=== PRIAN PROBE SUMMARY ===")
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    out_file = out_dir / "prian_sample.json"
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
