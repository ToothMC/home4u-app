"""Dedup-Helper: Cover-pHash + Phone-Hash Berechnung für Cross-Source-Matching.

pHash (perceptual hash) erkennt visuell identische Bilder, auch wenn sie
neu encoded oder anders skaliert wurden — wichtig weil Bazaraki, INDEX.cy,
BuySellCyprus etc. das selbe Inserat-Bild über eigene CDNs ausliefern.

Bigint-Repräsentation ist mit der `image_hashes.phash bigint`-Spalte und
der `phash_hamming(bigint, bigint)`-RPC kompatibel.

Phone-Hash ist sha256 über die Ziffern-Only-Form der Nummer (Cyprus +357,
international +xx). Für aktuell laufenden Bazaraki-Crawler nicht relevant
(Bazaraki versteckt Phone hinter XHR-Click), aber die Helper ist hier
zentral, damit künftige Crawler (FB, INDEX, BuySell) den gleichen Stil
nutzen.
"""
from __future__ import annotations

import hashlib
import io
import logging
import re
from typing import Optional

import httpx

log = logging.getLogger(__name__)


def compute_phash_from_url(url: str, timeout: float = 15.0) -> Optional[int]:
    """Lädt das Bild von URL, berechnet 64-bit pHash, returned als int.

    Schwächen:
    - Bei riesigen Bildern (>5 MB) brechen wir ab — wir wollen den Crawler
      nicht durch ein einzelnes Hero-Bild belasten.
    - HTTP-Fehler / Decode-Fehler → None (caller speichert dann nichts).
    """
    if not url:
        return None
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url)
            if resp.status_code != 200:
                log.debug("phash fetch %s -> HTTP %d", url, resp.status_code)
                return None
            content = resp.content
            if len(content) > 5 * 1024 * 1024:
                log.debug("phash skip oversize %d bytes %s", len(content), url)
                return None
    except Exception as e:
        log.debug("phash fetch failed %s: %s", url, e)
        return None

    return _phash_bytes(content)


def _phash_bytes(content: bytes) -> Optional[int]:
    """64-bit pHash aus Bytes. Lazy-import von Pillow + imagehash damit
    der Crawler auch ohne diese Deps starten kann (für DRY_RUN-Smoke-Tests)."""
    try:
        from PIL import Image
        import imagehash
    except ImportError as e:
        log.warning("phash deps fehlen (%s) — phash wird übersprungen", e)
        return None
    try:
        img = Image.open(io.BytesIO(content))
        # phash = imagehash.phash → 64-bit Hash, default Größe 8
        h = imagehash.phash(img)
        # imagehash.ImageHash hat .hash als bool-Array → in 64-bit int
        bits = 0
        for bit in h.hash.flatten():
            bits = (bits << 1) | int(bool(bit))
        # Postgres bigint ist signed (-2^63..2^63-1) — 64-bit unsigned
        # in signed Format konvertieren wenn nötig.
        if bits >= 2**63:
            bits -= 2**64
        return bits
    except Exception as e:
        log.debug("phash decode failed: %s", e)
        return None


_PHONE_DIGITS = re.compile(r"\D+")


def normalize_phone(raw: Optional[str], default_country: str = "357") -> Optional[str]:
    """Normalisiert eine Telefonnummer auf reine Ziffern mit Landesvorwahl.

    Beispiele:
      "+357 99 123 456" → "35799123456"
      "99 123 456"       → "35799123456" (default_country ergänzt)
      "00357 99 123 456" → "35799123456"
      "+44 20 7946 0958" → "442079460958"
    """
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None
    digits = _PHONE_DIGITS.sub("", s)
    if not digits:
        return None
    if digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) <= 10:
        # nationale Notation ohne +country — ergänzen
        digits = default_country + digits.lstrip("0")
    elif len(digits) <= 8:
        # nur lokale 7-8-stellige Nummer → mit default_country prefixen
        digits = default_country + digits
    if len(digits) < 8 or len(digits) > 15:
        return None
    return digits


def compute_phone_hash(raw: Optional[str], default_country: str = "357") -> Optional[str]:
    """sha256-Hex über die normalisierte Phone-Form. Liefert None wenn die
    Nummer nicht parsebar ist."""
    norm = normalize_phone(raw, default_country=default_country)
    if not norm:
        return None
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()
