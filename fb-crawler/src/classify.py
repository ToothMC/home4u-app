"""Haiku-4.5-Klassifikator: Ist dieser FB-Post ein Immobilien-Inserat?

Kosten-Optimierung: Wir batchen mehrere Posts in einem Call, mit
Tool-Use-Schema, das pro Post genau ein Result-Objekt liefert. System-Prompt
ist ephemeral cached.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import anthropic

from .parser import RawPost

log = logging.getLogger(__name__)

MODEL_HAIKU = os.getenv("ANTHROPIC_MODEL_HAIKU", "claude-haiku-4-5")
BATCH_SIZE = 20  # max Posts pro Klassifikator-Call
MAX_TEXT_CHARS = 1500  # pro Post — FB-Posts sind meist kürzer


CLASSIFY_TOOL = {
    "name": "submit_classifications",
    "description": (
        "Liefert pro Eingabe-Post genau ein Klassifikations-Objekt. "
        "Reihenfolge muss exakt der Eingabe entsprechen."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {
                            "type": "integer",
                            "description": "0-basierter Index aus der Eingabe",
                        },
                        "category": {
                            "type": "string",
                            "enum": ["rent", "sale", "wanted", "other"],
                            "description": (
                                "rent = Inserat zur Miete; sale = Inserat zum Kauf; "
                                "wanted = Suchanfrage (User sucht Wohnung) — NICHT indexieren; "
                                "other = kein Immobilien-Inserat"
                            ),
                        },
                        "language": {
                            "type": "string",
                            "enum": ["de", "en", "ru", "el", "unknown"],
                        },
                        "confidence": {
                            "type": "number",
                            "description": "0..1 Selbsteinschätzung",
                        },
                    },
                    "required": ["index", "category", "language", "confidence"],
                },
            },
        },
        "required": ["results"],
    },
}


SYSTEM_PROMPT = """Du bist Home4Us FB-Post-Klassifikator für Cyprus-Immobilien.

Aufgabe: Pro Eingabe-Post entscheiden, ob es ein Immobilien-INSERAT ist
(Vermieter/Verkäufer bietet Objekt an), eine SUCHANFRAGE (jemand sucht eine
Wohnung), oder etwas anderes.

Kategorien:
- rent: Miet-Inserat — typische Marker: "for rent", "zu vermieten", "сдаётся",
  "ενοικιάζεται", "monthly", "available from", Preis pro Monat
- sale: Kauf-Inserat — "for sale", "zu verkaufen", "продаётся", "πωλείται",
  Gesamtpreis (oft 6-stellig)
- wanted: Suchanfrage — "looking for", "ищу", "ψάχνω", "wer hat", "I need
  a flat", Budget-Range angegeben aber kein konkretes Objekt
- other: Diskussion, Möbel-Verkauf, Restaurant-Empfehlung, Mietrecht-Fragen,
  Werbung für Makler-Dienste ohne konkretes Objekt, Spam

Sprache: de/en/ru/el — bei Mischsprache die dominante. unknown nur wenn
unklar.

Confidence < 0.6 → Plattform sortiert raus. Lieber `other` mit hoher
Confidence als `rent` mit niedriger.

Reihenfolge der Ergebnisse muss exakt der Reihenfolge der Eingabe entsprechen.
"""


@dataclass
class Classification:
    post_id: str
    category: str       # "rent" | "sale" | "wanted" | "other"
    language: str       # "de" | "en" | "ru" | "el" | "unknown"
    confidence: float


def _format_batch(posts: list[RawPost]) -> str:
    lines = ["Klassifiziere folgende FB-Posts:"]
    for idx, p in enumerate(posts):
        text = p.text[:MAX_TEXT_CHARS]
        lines.append(f"\n--- Post {idx} ---\n{text}")
    return "\n".join(lines)


def _client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY fehlt — siehe .env.example"
        )
    return anthropic.Anthropic(api_key=api_key)


def classify_posts(posts: list[RawPost]) -> list[Classification]:
    """Batched-Call. Gibt eine Classification pro Eingabe-Post zurück (Reihenfolge identisch)."""
    if not posts:
        return []

    client = _client()
    out: list[Classification] = []

    for i in range(0, len(posts), BATCH_SIZE):
        batch = posts[i : i + BATCH_SIZE]
        user_text = _format_batch(batch)
        try:
            response = client.messages.create(
                model=MODEL_HAIKU,
                max_tokens=2048,
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                tools=[CLASSIFY_TOOL],
                tool_choice={"type": "tool", "name": "submit_classifications"},
                messages=[{"role": "user", "content": user_text}],
            )
        except Exception as e:
            log.error("Klassifikator-Call fehlgeschlagen: %s", e)
            # Bei Fehler alle Posts dieses Batches als "other"/conf=0 markieren
            for p in batch:
                out.append(Classification(p.post_id, "other", "unknown", 0.0))
            continue

        tool_use = next(
            (c for c in response.content if c.type == "tool_use" and c.name == "submit_classifications"),
            None,
        )
        if tool_use is None:
            log.warning("Klassifikator: kein tool_use in Response — alle als other markiert")
            for p in batch:
                out.append(Classification(p.post_id, "other", "unknown", 0.0))
            continue

        results = tool_use.input.get("results", []) if isinstance(tool_use.input, dict) else []
        # Map per index — falls die LLM Reihenfolge bricht, gehen wir per index
        by_idx = {r.get("index"): r for r in results if isinstance(r, dict)}
        for idx, p in enumerate(batch):
            r = by_idx.get(idx)
            if r is None:
                out.append(Classification(p.post_id, "other", "unknown", 0.0))
                continue
            cat = r.get("category", "other")
            if cat not in ("rent", "sale", "wanted", "other"):
                cat = "other"
            lang = r.get("language", "unknown")
            if lang not in ("de", "en", "ru", "el", "unknown"):
                lang = "unknown"
            conf = float(r.get("confidence", 0.0) or 0.0)
            out.append(Classification(p.post_id, cat, lang, conf))

    return out
