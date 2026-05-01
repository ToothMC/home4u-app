"""pHash-Compute aus Cover-Bild — identisch zu cre-crawler/dedup.py."""
from __future__ import annotations

import logging
from io import BytesIO

import httpx
from PIL import Image
import imagehash

log = logging.getLogger(__name__)


def compute_phash_from_url(url: str, timeout: float = 15.0) -> int | None:
    """Lädt Bild, normalisiert (RGB, 256x256), berechnet 64-bit pHash.

    Return: integer pHash oder None bei Fehler.
    """
    try:
        resp = httpx.get(url, timeout=timeout, follow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        log.debug("phash fetch fail %s: %s", url[:80], e)
        return None

    try:
        img = Image.open(BytesIO(resp.content)).convert("RGB")
        img.thumbnail((256, 256))
        ph = imagehash.phash(img)
        return int(str(ph), 16)
    except Exception as e:
        log.debug("phash compute fail %s: %s", url[:80], e)
        return None
