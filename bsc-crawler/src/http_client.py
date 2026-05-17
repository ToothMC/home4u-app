"""BSC sitzt hinter Cloudflare Managed Challenge — normale httpx/curl-Requests
bekommen HTTP 403 in 70ms (Edge-Level). curl_cffi mit Chrome120-TLS-Fingerprint
und einem Session-Bootstrap auf die Home-Page passiert sauber durch.

Wenn Cloudflare die Strategie irgendwann eskaliert, ist der Fallback Playwright
mit Stealth-Plugin. Solange der TLS-Bypass reicht, fahren wir 10x schneller.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from curl_cffi import requests as cffi_requests

log = logging.getLogger(__name__)

_IMPERSONATE = "chrome120"
_HOME = "https://www.buysellcyprus.com/"


class BscSession:
    """Dünner Wrapper um curl_cffi.Session mit eingebautem Cookie-Bootstrap.

    Beim ersten Request stellt sich automatisch die Cloudflare-Session her
    (cf_clearance cookie). Spätere Requests verwenden dieselbe Session.
    """

    def __init__(self) -> None:
        self._session: Optional[cffi_requests.Session] = None
        self._bootstrapped = False

    def _ensure_session(self) -> cffi_requests.Session:
        if self._session is None:
            self._session = cffi_requests.Session(impersonate=_IMPERSONATE)
        if not self._bootstrapped:
            log.info("BscSession: bootstrap home — etabliere Cloudflare-Cookie")
            r = self._session.get(_HOME, timeout=20)
            if r.status_code != 200:
                raise RuntimeError(f"Bootstrap fehlgeschlagen: HTTP {r.status_code}")
            self._bootstrapped = True
        return self._session

    def get(self, url: str, timeout: float = 30.0, retries: int = 3) -> tuple[int, str]:
        """Single GET mit Retry. Liefert (status_code, body_text)."""
        s = self._ensure_session()
        last_err: Exception | None = None
        for attempt in range(retries):
            try:
                r = s.get(url, timeout=timeout)
                # Cloudflare-Challenge nach erfolgreichem Bootstrap signalisiert
                # einen Reset — Session reseten und einmal nachholen
                if r.status_code == 403 and "Just a moment" in r.text[:500]:
                    log.warning("CF challenge hit on %s — resetting session", url)
                    self._session = None
                    self._bootstrapped = False
                    if attempt < retries - 1:
                        time.sleep(2 * (attempt + 1))
                        continue
                return r.status_code, r.text
            except Exception as e:
                last_err = e
                log.warning("fetch %s attempt %d failed: %s", url, attempt + 1, e)
                if attempt < retries - 1:
                    time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"fetch failed after {retries} tries: {last_err}")

    def get_text(self, url: str, **kw) -> str:
        """Convenience: nur den Text liefern, bei !=200 Exception."""
        status, body = self.get(url, **kw)
        if status != 200:
            raise RuntimeError(f"HTTP {status} for {url}")
        return body
