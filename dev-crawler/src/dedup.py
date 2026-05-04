"""pHash-Compute aus Cover-Bild — identisch zu cre-crawler/dedup.py.

WICHTIG: pHash wird in postgres `bigint` (signed 64-bit) gespeichert. Werte
≥ 2**63 müssen in den negativen Bereich konvertiert werden, sonst rejected
`bulk_upsert_external_listings` die Row wegen Cast-Overflow. Gleiche Logik
wie bazaraki-crawler/dedup.py.
"""
from __future__ import annotations

import logging
from io import BytesIO

import httpx
from PIL import Image
import imagehash

log = logging.getLogger(__name__)


def compute_phash_from_url(url: str, timeout: float = 15.0) -> int | None:
    """Lädt Bild, normalisiert (RGB, 256x256), berechnet 64-bit pHash als
    signed bigint (passt in postgres bigint-Spalte image_hashes.phash).

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
        h = imagehash.phash(img)
        # Bit-für-Bit zu signed 64-bit int — identisch zu bazaraki/cre.
        bits = 0
        for bit in h.hash.flatten():
            bits = (bits << 1) | int(bool(bit))
        if bits >= 2**63:
            bits -= 2**64
        return bits
    except Exception as e:
        log.debug("phash compute fail %s: %s", url[:80], e)
        return None
