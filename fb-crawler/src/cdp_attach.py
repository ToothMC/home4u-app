"""CDP-Attach: verbindet sich an ein laufendes Chrome (`--remote-debugging-port`),
enumeriert alle offenen Group-Tabs, ruft pro Tab das Parser-JS auf.

Crawler ist passiver Reader: kein eigenes navigate(), kein scroll(), kein click().
Der User scrollt manuell. Wir lesen nur den aktuell gerenderten DOM.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, Playwright, sync_playwright

from .config import GroupConfig, find_group_for_path
from .parser import EXTRACT_POSTS_JS, RawPost, parse_posts

log = logging.getLogger(__name__)


@contextmanager
def attached_browser(cdp_port: int) -> Iterator[tuple[Playwright, Browser]]:
    """Connect über CDP an laufendes Chrome. Wirft, wenn nichts läuft."""
    p = sync_playwright().start()
    try:
        browser = p.chromium.connect_over_cdp(f"http://localhost:{cdp_port}")
        try:
            yield p, browser
        finally:
            # Wir disconnecten, beenden Chrome NICHT (das ist der User-Browser)
            browser.close()
    finally:
        p.stop()


def list_group_pages(browser: Browser) -> list[tuple[Page, GroupConfig]]:
    """Alle offenen Tabs durchgehen, die auf eine konfigurierte FB-Gruppe zeigen.

    Connect_over_cdp gibt uns ein "default context" zurück, das die existierenden
    Tabs als pages() exposed.
    """
    out: list[tuple[Page, GroupConfig]] = []
    for context in browser.contexts:
        for page in context.pages:
            url = page.url or ""
            if not url:
                continue
            try:
                parsed = urlparse(url)
            except Exception:
                continue
            if parsed.netloc not in ("www.facebook.com", "facebook.com", "m.facebook.com"):
                continue
            group = find_group_for_path(parsed.path)
            if group is None:
                log.debug("Tab %s gehört zu keiner konfigurierten Gruppe", url)
                continue
            out.append((page, group))
    return out


def extract_posts_from_page(page: Page) -> list[RawPost]:
    """Führt Parser-JS in der Page aus und konvertiert zu RawPost-Records."""
    try:
        raw = page.evaluate(EXTRACT_POSTS_JS)
    except Exception as e:
        log.warning("page.evaluate fehlgeschlagen für %s: %s", page.url, e)
        return []
    if not isinstance(raw, list):
        log.warning("Parser-JS lieferte kein Array: %r", raw)
        return []
    return parse_posts(raw)
