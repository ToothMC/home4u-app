"""pHash-Compute — identische Logic wie bazaraki-crawler/index-crawler.

Cover-Bilder werden via httpx (kein CF-Bypass nötig: Bild-URLs gehen direkt
auf images-Subdomain, kein Challenge) geholt und auf ihren pHash reduziert.
Cross-Source-Dedup (bazaraki ↔ bsc ↔ index_cy) basiert darauf.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

import httpx

log = logging.getLogger(__name__)


def compute_phash_from_url(url: str, timeout: float = 15.0) -> Optional[int]:
    if not url:
        return None
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url)
            if resp.status_code != 200:
                return None
            content = resp.content
            if len(content) > 5 * 1024 * 1024:
                return None
    except Exception as e:
        log.debug("phash fetch failed %s: %s", url, e)
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
