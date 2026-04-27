"""FB-Crawler-Konfiguration: Group-Liste, Stadt-Resolver, ENV-Tuning."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


CITIES_CANONICAL = ["Limassol", "Paphos", "Larnaca", "Nicosia", "Famagusta"]


@dataclass(frozen=True)
class GroupConfig:
    id: str            # FB-Group-Numerical-ID (oder REPLACE_ME_*)
    slug: str          # URL-Slug, falls Gruppe noch keine numerische ID hat
    city: str          # Display-Stadt (matcht listings.location_city)
    type_hint: str | None  # "rent" | "sale" | None (vom Klassifikator entscheiden lassen)
    name: str

    def matches_url_path(self, path: str) -> bool:
        """Match facebook.com/groups/<id-or-slug>/...

        Beispiel-Pfade:
          /groups/123456789/
          /groups/limassol-rentals/posts/
          /groups/limassol-rentals/permalink/...
        """
        # Normalisieren auf führendes /groups/<token>/
        parts = [p for p in path.split("/") if p]
        if len(parts) < 2 or parts[0] != "groups":
            return False
        token = parts[1]
        return token == self.id or token == self.slug


def _groups_path() -> Path:
    return Path(__file__).parent / "groups.json"


def load_all_groups() -> list[GroupConfig]:
    raw = json.loads(_groups_path().read_text())
    out: list[GroupConfig] = []
    for g in raw.get("groups", []):
        if g.get("city") not in CITIES_CANONICAL:
            raise ValueError(f"groups.json: unbekannte Stadt {g.get('city')!r}")
        type_hint = g.get("type_hint")
        if type_hint is not None and type_hint not in ("rent", "sale"):
            raise ValueError(f"groups.json: ungültiger type_hint {type_hint!r}")
        out.append(GroupConfig(
            id=g["id"], slug=g.get("slug", ""),
            city=g["city"], type_hint=type_hint, name=g.get("name", g["id"]),
        ))
    return out


def env_int(key: str, default: int) -> int:
    raw = os.getenv(key, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_str(key: str, default: str) -> str:
    return os.getenv(key, "").strip() or default


def env_list(key: str) -> list[str] | None:
    raw = os.getenv(key, "").strip()
    if not raw:
        return None
    return [s.strip().lower() for s in raw.split(",") if s.strip()]


def env_path(key: str, default: str) -> Path:
    raw = os.getenv(key, "").strip() or default
    return Path(os.path.expanduser(raw))


# Runtime-Config aus Env
CDP_PORT = env_int("CDP_PORT", 9222)
POLL_INTERVAL_SECONDS = env_int("POLL_INTERVAL_SECONDS", 30)
DRY_RUN = os.getenv("DRY_RUN") == "1"
SKIP_LLM = os.getenv("SKIP_LLM") == "1"
STATE_DB_PATH = env_path("STATE_DB_PATH", "~/.home4u-fb-state/seen.sqlite")


def selected_groups() -> list[GroupConfig]:
    """Filtert nach ENV CITIES und/oder GROUP_IDS. Defaults: alle aus groups.json
    (außer REPLACE_ME_*-Platzhalter, die werden immer übersprungen)."""
    all_groups = load_all_groups()
    cities_filter = env_list("CITIES")
    ids_filter = env_list("GROUP_IDS")

    out: list[GroupConfig] = []
    for g in all_groups:
        if g.id.startswith("REPLACE_ME_"):
            continue
        if cities_filter and g.city.lower() not in cities_filter:
            continue
        if ids_filter and g.id.lower() not in ids_filter and g.slug.lower() not in ids_filter:
            continue
        out.append(g)
    return out


def find_group_for_path(path: str) -> GroupConfig | None:
    """Resolve einen URL-Path zu einer konfigurierten Gruppe."""
    for g in load_all_groups():
        if g.matches_url_path(path):
            return g
    return None
