"""Haiku-4.5-Strukturextraktor für FB-Posts, die der Klassifikator als
rent/sale durchgewunken hat.

Schema-Vorbild: home4u-app/lib/import/extract.ts (CSV/PDF-Pfad). Hier
zugeschnitten auf FB: einzelner Post pro Call (kein Batching, weil
Tool-Use-Round-Trip + Cache-Hit pro Post günstig genug bleibt und Fehler
isoliert werden), Stadt-Hint aus Group-Config.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass

import anthropic

from .classify import Classification
from .parser import RawPost

log = logging.getLogger(__name__)

MODEL_HAIKU = os.getenv("ANTHROPIC_MODEL_HAIKU", "claude-haiku-4-5")
MAX_TEXT_CHARS = 4000
MIN_CONFIDENCE = 0.5


EXTRACTION_TOOL = {
    "name": "submit_listing",
    "description": "Strukturierte Felder aus dem FB-Inserat extrahieren.",
    "input_schema": {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": ["rent", "sale"]},
            "location_city": {
                "type": "string",
                "description": "Stadt (Limassol, Paphos, Larnaca, Nicosia, Famagusta).",
            },
            "location_district": {
                "type": "string",
                "description": "Stadtteil/Viertel falls genannt (z.B. Germasogeia).",
            },
            "price": {
                "type": "number",
                "description": (
                    "Numerischer Preis ohne Währungssymbol. Bei Miete: Monatspreis. "
                    "Bei Kauf: Gesamtpreis."
                ),
            },
            "currency": {
                "type": "string",
                "description": "ISO-3-Code. € → EUR, $ → USD, £ → GBP. Default EUR.",
            },
            "rooms": {
                "type": "integer",
                "description": (
                    "Zimmerzahl bzw. Schlafzimmer. 0 = Studio. "
                    "Wenn nur m² angegeben, NICHT schätzen — leer lassen."
                ),
            },
            "size_sqm": {
                "type": "integer",
                "description": "Wohnfläche in m². sqft → m² umrechnen (1 sqft = 0.0929 m²).",
            },
            "contact_name": {"type": "string"},
            "contact_phone": {
                "type": "string",
                "description": "E.164-Format. CY-Default-Vorwahl +357.",
            },
            "contact_channel": {
                "type": "string",
                "enum": ["whatsapp", "telegram", "messenger", "phone", "email"],
                "description": "Bevorzugter Kontakt-Kanal falls erkennbar.",
            },
            "confidence": {
                "type": "number",
                "description": (
                    "0..1 Selbsteinschätzung. < 0.5 → Plattform verwirft."
                ),
            },
            "note": {"type": "string", "description": "Optionaler Hinweis."},
        },
        "required": ["type", "location_city", "price", "currency", "confidence"],
    },
}

SYSTEM_PROMPT = """Du bist Home4Us Daten-Extraktor für FB-Immobilien-Inserate aus Cyprus.

Aufgabe: Aus dem Post-Text die strukturierten Felder via submit_listing extrahieren.

Regeln:
- Stadt: bevorzuge die explizit im Text genannte Stadt; wenn keine genannt,
  nutze den City-Hint aus dem User-Prompt.
- Preise: Tausender-Trenner '.' und ',' richtig interpretieren.
  "1.500" / "€1500/month" / "EUR 1500" → 1500.
- Telefon: in E.164. Cyprus = +357. "99 12 34 56" → "+35799123456".
- Kontakt-Kanal: aus Hinweisen wie "WhatsApp only", "DM me", "ring",
  "telegram @user".
- Confidence < 0.5 wenn Pflichtfeld unklar ist — trotzdem submitten.
- NIEMALS Werte erfinden. Was nicht im Text steht, leer lassen.
"""


@dataclass
class Extraction:
    type: str | None  # "rent" | "sale"
    location_city: str | None
    location_district: str | None
    price: float | None
    currency: str
    rooms: int | None
    size_sqm: int | None
    contact_name: str | None
    contact_phone: str | None    # E.164 normalisiert
    contact_channel: str | None
    confidence: float
    note: str | None
    # LLM-Rohausgabe (tool_use.input). Wird in listings.extracted_data
    # persistiert, damit Re-Processing ohne Re-Crawl möglich ist
    # (Indexer-Spec v2.0 §2.1 extracted_data).
    raw_extraction: dict | None = None


def _client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY fehlt — siehe .env.example")
    return anthropic.Anthropic(api_key=api_key)


def extract_listing(post: RawPost, classification: Classification, city_hint: str) -> Extraction | None:
    """Single-Call-Extraktor. Gibt None zurück wenn confidence < MIN_CONFIDENCE
    oder Pflichtfeld fehlt — Caller soll diesen Post dann skippen.

    `city_hint` kommt aus der GroupConfig (z.B. "Limassol"), wird im Prompt als
    Default mitgegeben."""
    client = _client()

    user_text = (
        f"Stadt-Hint (Default falls im Text nicht genannt): {city_hint}\n"
        f"Erkannte Sprache: {classification.language}\n"
        f"Erkannte Kategorie: {classification.category}\n\n"
        f"Post-Text:\n{post.text[:MAX_TEXT_CHARS]}"
    )

    try:
        response = client.messages.create(
            model=MODEL_HAIKU,
            max_tokens=1024,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[EXTRACTION_TOOL],
            tool_choice={"type": "tool", "name": "submit_listing"},
            messages=[{"role": "user", "content": user_text}],
        )
    except Exception as e:
        log.error("Extraktor-Call fehlgeschlagen für post_id=%s: %s", post.post_id, e)
        return None

    tool_use = next(
        (c for c in response.content if c.type == "tool_use" and c.name == "submit_listing"),
        None,
    )
    if tool_use is None or not isinstance(tool_use.input, dict):
        log.warning("Extraktor: kein tool_use für post_id=%s", post.post_id)
        return None

    raw = tool_use.input
    type_ = raw.get("type") if raw.get("type") in ("rent", "sale") else None
    confidence = float(raw.get("confidence", 0.0) or 0.0)

    if confidence < MIN_CONFIDENCE:
        log.info("Extraktor: confidence %.2f < %.2f für post_id=%s — skip",
                 confidence, MIN_CONFIDENCE, post.post_id)
        return None

    price = _to_number(raw.get("price"))
    if type_ is None or not raw.get("location_city") or price is None or price <= 0:
        log.info("Extraktor: Pflichtfeld fehlt für post_id=%s", post.post_id)
        return None

    return Extraction(
        type=type_,
        location_city=str(raw["location_city"]).strip(),
        location_district=_str_or_none(raw.get("location_district")),
        price=price,
        currency=_normalize_currency(raw.get("currency")),
        rooms=_to_int(raw.get("rooms")),
        size_sqm=_to_int(raw.get("size_sqm")),
        contact_name=_str_or_none(raw.get("contact_name")),
        contact_phone=_normalize_phone(raw.get("contact_phone")),
        contact_channel=_str_or_none(raw.get("contact_channel")),
        confidence=confidence,
        note=_str_or_none(raw.get("note")),
        raw_extraction=dict(raw),
    )


# ---------- Normalisierung (Vorbild: lib/import/extract.ts:381-429) ----------


def _str_or_none(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _to_number(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if v == v else None  # NaN-check
    s = re.sub(r"[^\d.,-]", "", str(v))
    if not s:
        return None
    last_comma = s.rfind(",")
    last_dot = s.rfind(".")
    if last_comma == -1 and last_dot == -1:
        normalized = s
    elif last_comma > last_dot:
        normalized = s.replace(".", "").replace(",", ".")
    else:
        normalized = s.replace(",", "")
    try:
        return float(normalized)
    except ValueError:
        return None


def _to_int(v) -> int | None:
    n = _to_number(v)
    return int(n) if n is not None else None


def _normalize_currency(input_) -> str:
    if not input_:
        return "EUR"
    t = str(input_).strip().upper()
    if t in ("€", "EUR", "EURO"):
        return "EUR"
    if t in ("$", "USD"):
        return "USD"
    if t in ("£", "GBP"):
        return "GBP"
    if t in ("₽", "RUB"):
        return "RUB"
    if re.fullmatch(r"[A-Z]{3}", t):
        return t
    return "EUR"


def _normalize_phone(input_) -> str | None:
    if not input_:
        return None
    cleaned = re.sub(r"[^\d+]", "", str(input_))
    if not cleaned:
        return None
    if cleaned.startswith("+"):
        return cleaned if re.fullmatch(r"\+\d{8,15}", cleaned) else None
    if cleaned.startswith("00"):
        cand = "+" + cleaned[2:]
        return cand if re.fullmatch(r"\+\d{8,15}", cand) else None
    if 8 <= len(cleaned) <= 10:
        return "+357" + cleaned.lstrip("0")
    return None
