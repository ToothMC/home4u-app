"""pHash-Compute — identische Logic wie bazaraki-crawler/dedup.py.

Einmal duplizierter Code statt Cross-Crawler-Import. Wenn wir mehr
static-crawler bauen, lohnt sich ein gemeinsames Package — bis dahin
nicht.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

import httpx

log = logging.getLogger(__name__)


def fetch_image(url: str, timeout: float = 15.0) -> tuple[bool, Optional[bytes]]:
    """Holt ein Bild. Returned (erreichbar, bytes).

    Die Unterscheidung ist der Punkt: `(False, None)` heisst "index.cy
    liefert dieses Bild nicht" (404/403/Redirect auf HTML) — ein hartes
    Urteil ueber die URL. `(True, None)` gaebe es nicht; ein Fehler beim
    Verbindungsaufbau zaehlt bewusst NICHT als tot, sonst wirft eine
    Netzwerkdelle reihenweise gute Cover weg.

    Hintergrund (2026-10-21): index.cy publiziert in og:image, JSON-LD,
    data-src UND Sitemap Bild-URLs, die es nicht gibt — beim 10818xxx-Batch
    sind alle Groessenvarianten auf allen vier Hosts 404. Der Crawler hat
    sie bis dahin wortgetreu uebernommen, und weil frische Listings
    `media_ok IS NULL` haben (= ungeprueft, Filter laesst sie durch),
    standen 17 bildlose Karten ganz oben auf der Startseite.
    """
    if not url:
        return False, None
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url)
            if resp.status_code != 200:
                log.debug("cover tot (HTTP %d): %s", resp.status_code, url)
                return False, None
            # index.cy leitet fehlende Bilder auf eine HTML-404-Seite um, die
            # mit 200 antwortet. Ohne Content-Type-Pruefung gilt die als Bild.
            ctype = resp.headers.get("content-type", "")
            if not ctype.startswith("image/"):
                log.debug("cover tot (content-type %r): %s", ctype, url)
                return False, None
            content = resp.content
            if len(content) > 5 * 1024 * 1024:
                return True, None
    except Exception as e:
        # Transienter Fehler — URL bekommt den Vorteil des Zweifels.
        log.debug("cover fetch failed %s: %s", url, e)
        return True, None
    return True, content


def compute_phash_from_url(url: str, timeout: float = 15.0) -> Optional[int]:
    _alive, content = fetch_image(url, timeout=timeout)
    if content is None:
        return None
    return _phash_bytes(content)


def _phash_bytes(content: bytes) -> Optional[int]:
    try:
        from PIL import Image
        import imagehash
    except ImportError as e:
        log.warning("phash deps fehlen (%s)", e)
        return None
    try:
        img = Image.open(io.BytesIO(content))
        h = imagehash.phash(img)
        bits = 0
        for bit in h.hash.flatten():
            bits = (bits << 1) | int(bool(bit))
        if bits >= 2**63:
            bits -= 2**64
        return bits
    except Exception as e:
        log.debug("phash decode failed: %s", e)
        return None
