"""CDP-Attach: verbindet sich an ein laufendes Chrome (`--remote-debugging-port`),
enumeriert alle offenen Group-Tabs via DevTools Protocol direkt, ruft pro Tab
das Parser-JS auf.

Crawler ist passiver Reader: kein eigenes navigate(), kein scroll(), kein click().
Der User scrollt manuell. Wir lesen nur den aktuell gerenderten DOM.

Wir nutzen raw CDP (HTTP `/json` + per-Tab WebSocket) statt Playwright, weil
Playwright `connect_over_cdp` bei externen Chrome-Instanzen die existierenden
Pages nicht zuverlässig enumeriert (page.url leer, evaluate() hängt).
"""
from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator
from urllib.parse import urlparse

import httpx
from websocket import create_connection

from .config import GroupConfig, find_group_for_path
from .parser import EXTRACT_POSTS_JS, RawPost, parse_posts

log = logging.getLogger(__name__)


@dataclass
class CDPPage:
    """Leichtgewichtiges Tab-Handle. Verbindet sich pro evaluate() neu."""
    target_id: str
    url: str
    ws_url: str

    def evaluate(self, expression: str, timeout: float = 30.0) -> Any:
        # Origin-Header gegen Chromes "remote-allow-origins"-Schutz (neuere Chromes
        # blocken WS-Connects ohne erlaubten Origin; localhost ist immer akzeptiert).
        ws = create_connection(self.ws_url, timeout=timeout, origin="http://localhost")
        try:
            ws.send(json.dumps({
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": f"({expression})()" if expression.lstrip().startswith("()") else expression,
                    "returnByValue": True,
                    "awaitPromise": True,
                },
            }))
            while True:
                raw = ws.recv()
                msg = json.loads(raw)
                if msg.get("id") != 1:
                    continue
                if "error" in msg:
                    raise RuntimeError(f"CDP error: {msg['error']}")
                result = msg.get("result", {})
                inner = result.get("result", {})
                if "exceptionDetails" in result:
                    exc = result["exceptionDetails"]
                    raise RuntimeError(f"JS exception: {exc.get('text')} — {exc.get('exception', {}).get('description', '')}")
                return inner.get("value")
        finally:
            try:
                ws.close()
            except Exception:
                pass


@contextmanager
def attached_browser(cdp_port: int) -> Iterator[tuple[None, int]]:
    """Sanity-Check: Chrome auf cdp_port erreichbar? Sonst sofort raise.

    Backward-compat zur alten Signatur — yields (None, cdp_port). Der zweite
    Wert wird von list_group_pages() als Port verstanden.
    """
    try:
        resp = httpx.get(f"http://localhost:{cdp_port}/json/version", timeout=5.0)
        resp.raise_for_status()
    except Exception as e:
        raise RuntimeError(f"Chrome auf CDP-Port {cdp_port} nicht erreichbar: {e}") from e
    yield (None, cdp_port)


def list_group_pages(cdp_port: int) -> list[tuple[CDPPage, GroupConfig]]:
    """Alle offenen page-Targets durchgehen, die auf eine konfigurierte FB-Gruppe zeigen."""
    try:
        resp = httpx.get(f"http://localhost:{cdp_port}/json", timeout=5.0)
        resp.raise_for_status()
        targets = resp.json()
    except Exception as e:
        log.error("CDP /json fehlgeschlagen: %s", e)
        return []

    out: list[tuple[CDPPage, GroupConfig]] = []
    for t in targets:
        if t.get("type") != "page":
            continue
        url = t.get("url", "") or ""
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
        ws_url = t.get("webSocketDebuggerUrl", "")
        if not ws_url:
            log.warning("Tab %s hat keinen webSocketDebuggerUrl — überspringe", url)
            continue
        out.append((CDPPage(target_id=t.get("id", ""), url=url, ws_url=ws_url), group))
    return out


def extract_posts_from_page(page: CDPPage) -> list[RawPost]:
    """Führt Parser-JS in der Page aus und konvertiert zu RawPost-Records."""
    try:
        raw = page.evaluate(EXTRACT_POSTS_JS)
    except Exception as e:
        log.warning("CDP evaluate fehlgeschlagen für %s: %s", page.url, e)
        return []
    if not isinstance(raw, list):
        log.warning("Parser-JS lieferte kein Array: %r", raw)
        return []
    return parse_posts(raw)
