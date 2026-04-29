"""Telefon-Normalisierung und Hash für Cross-Source-Dedup.

Spiegelt bazaraki-crawler/src/dedup.py:normalize_phone — wir wollen identische
Hashes über alle Crawler hinweg, sonst zerbricht der Phone-basierte
canonical-Match.
"""
from __future__ import annotations

import hashlib
import re
from typing import Optional

_PHONE_DIGITS = re.compile(r"\D+")

# Häufige Cyprus-relevante Vorwahlen — Reihenfolge matters (längster zuerst).
_KNOWN_PREFIXES = ("357", "44", "30", "7", "49", "33", "39", "31", "34")


def normalize_phone(raw: Optional[str], default_country: str = "357") -> Optional[str]:
    """+357 99 123 → "35799123"; 99 123 → "35799123" mit default_country.

    Identisch zu bazaraki-crawler/src/dedup.py — bei Änderung dort
    nachziehen, sonst kollidieren die Cross-Source-Hashes.
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
        digits = default_country + digits.lstrip("0")
    elif len(digits) <= 8:
        digits = default_country + digits
    if len(digits) < 8 or len(digits) > 15:
        return None
    return digits


def country_prefix(normalized: str) -> Optional[str]:
    for p in _KNOWN_PREFIXES:
        if normalized.startswith(p):
            return p
    return None


def compute_phone_hash(raw: Optional[str], default_country: str = "357") -> Optional[str]:
    norm = normalize_phone(raw, default_country=default_country)
    if not norm:
        return None
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()
