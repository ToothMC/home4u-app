"""Playwright-basierter Crawler — robots.txt-respektierend, Rate-limited."""
from __future__ import annotations

import logging
import re
import time
import urllib.parse
from dataclasses import dataclass
from typing import Iterator

import httpx
from playwright.sync_api import Browser, Page, sync_playwright
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import (
    BASE_URL,
    MAX_PAGES_PER_CITY,
    RATE_LIMIT_SECONDS,
    ROBOTS_URL,
    USER_AGENT,
    CityConfig,
    build_listing_url,
)

log = logging.getLogger(__name__)


@dataclass
class RawListing:
    """Roh-Datensatz pro Listing — wird vom Writer ins Schema gemappt."""
    external_id: str        # Bazaraki adv-ID (Primärschlüssel)
    listing_type: str       # rent|sale
    city: str               # Anzeigename, e.g. "Limassol"
    price: float            # numerisch, EUR
    rooms: int | None       # 0 = Studio
    image_url: str | None   # Cover-Bild URL (cdn1.bazaraki.com/...)
    title: str | None       # für Debug-Logs


# ---------- robots.txt ----------

_DISALLOW_RE = re.compile(r"^Disallow:\s*(.*)$", re.IGNORECASE)


def fetch_disallowed_paths() -> list[str]:
    """Liefert Disallow-Pfade für unseren User-Agent (oder *)."""
    try:
        resp = httpx.get(ROBOTS_URL, timeout=10, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()
    except Exception as e:
        log.warning("robots.txt fetch failed (%s) — defensiv: keine Pfade gesperrt", e)
        return []

    disallowed: list[str] = []
    current_agent_matches = False
    for line in resp.text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("user-agent:"):
            agent = line.split(":", 1)[1].strip()
            current_agent_matches = agent == "*" or "home4u" in agent.lower()
            continue
        if not current_agent_matches:
            continue
        m = _DISALLOW_RE.match(line)
        if m:
            path = m.group(1).strip()
            if path:
                disallowed.append(path)
    return disallowed


def is_path_allowed(path: str, disallowed: list[str]) -> bool:
    return not any(path.startswith(rule) for rule in disallowed)


# ---------- Rooms aus URL-Slug ableiten ----------

_STUDIO_RE = re.compile(r"studio", re.IGNORECASE)
_BEDROOM_RE = re.compile(r"(\d+)-bedroom", re.IGNORECASE)


def parse_rooms_from_slug(url: str) -> int | None:
    """Bazaraki-URLs codieren rooms im Slug: studio/1-bedroom/2-bedroom/..."""
    slug = url.split("/adv/", 1)[-1]
    if _STUDIO_RE.search(slug):
        return 0
    m = _BEDROOM_RE.search(slug)
    if m:
        return int(m.group(1))
    return None


# ---------- Playwright-Crawl ----------

EXTRACT_JS = r"""
() => {
  const cards = Array.from(document.querySelectorAll('li[itemtype*="Product"]'));
  return cards.map(card => {
    const link = card.querySelector('a[href*="/adv/"]');
    if (!link) return null;
    const url = link.href;
    const advId = (url.match(/\/adv\/(\d+)/) || [])[1];
    if (!advId) return null;
    const priceEl = card.querySelector('[itemprop="price"]');
    const priceContent = priceEl?.getAttribute('content');
    const price = priceContent ? parseFloat(priceContent) : null;
    const nameEl = card.querySelector('[itemprop="name"]');
    const name = nameEl?.getAttribute('content') || nameEl?.textContent?.trim();
    const imgEl = card.querySelector('img[src*="bazaraki"], img[data-src*="bazaraki"]');
    const img = imgEl?.src || imgEl?.getAttribute('data-src') || null;
    return { url, advId, price, name, img };
  }).filter(Boolean);
}
"""


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _navigate(page: Page, url: str) -> None:
    log.info("→ %s", url)
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    # Cards laden async — kurz warten
    page.wait_for_selector('li[itemtype*="Product"]', timeout=15_000)


def _extract_page(page: Page, city: str, listing_type: str) -> list[RawListing]:
    raw = page.evaluate(EXTRACT_JS)
    out: list[RawListing] = []
    for entry in raw:
        if not entry["price"] or not entry["advId"]:
            continue
        out.append(
            RawListing(
                external_id=str(entry["advId"]),
                listing_type=listing_type,
                city=city,
                price=float(entry["price"]),
                rooms=parse_rooms_from_slug(entry["url"]),
                image_url=entry["img"] if entry["img"] and "bazaraki" in entry["img"] else None,
                title=entry["name"],
            )
        )
    return out


def crawl_city(
    browser: Browser,
    city: CityConfig,
    listing_type: str,
    subtype: str,
    disallowed: list[str],
    max_pages: int = MAX_PAGES_PER_CITY,
) -> Iterator[RawListing]:
    """Iteriert Pages für eine City+Type+Subtype-Kombination, yieldet RawListings."""
    seen_external_ids: set[str] = set()

    for page_num in range(1, max_pages + 1):
        url = build_listing_url(city, listing_type, subtype, page=page_num)
        path = urllib.parse.urlparse(url).path
        if not is_path_allowed(path, disallowed):
            log.warning("Pfad %s per robots.txt gesperrt — skip", path)
            return

        page = browser.new_page(user_agent=USER_AGENT)
        try:
            _navigate(page, url)
            items = _extract_page(page, city.display, listing_type)
        except Exception as e:
            log.warning("Page %s/%s/%s p%d failed: %s", city.display, listing_type, subtype, page_num, e)
            page.close()
            time.sleep(RATE_LIMIT_SECONDS)
            continue
        finally:
            page.close()

        new_count = 0
        for item in items:
            if item.external_id in seen_external_ids:
                continue
            seen_external_ids.add(item.external_id)
            new_count += 1
            yield item

        log.info(
            "  %s %s %s p%d: %d cards, %d new (cum %d)",
            city.display, listing_type, subtype, page_num, len(items), new_count, len(seen_external_ids),
        )
        if new_count == 0:
            # Keine neuen → wahrscheinlich am Ende der Pagination
            return
        time.sleep(RATE_LIMIT_SECONDS)


def with_browser():
    """Context-Manager-Wrapper für Playwright Browser."""
    return sync_playwright()


def image_url_full(path_or_url: str | None) -> str | None:
    """Bazaraki-Bilder kommen als kompletter URL — durchreichen."""
    if not path_or_url:
        return None
    if path_or_url.startswith("http"):
        return path_or_url
    return f"{BASE_URL.rstrip('/')}{path_or_url}"
