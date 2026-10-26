"""Merkzettel für Sitemap-Inserate, deren Detailseite "gelöscht" zeigt.

BSC lässt gelöschte Inserate in der Sitemap stehen. Sie landen nie in der DB,
gelten also bei jedem Lauf wieder als "neu" — und weil die Neu-Schlange in
Sitemap-Reihenfolge läuft, holt jeder Lauf dieselben toten Seiten vorne
erneut (1,3 s pro Seite). Diese Datei merkt sie sich lokal auf dem Runner.

Format: eine Zeile pro ID, "<id>\t<YYYY-MM-DD>". Einträge älter als TTL
werden ignoriert (und dann neu geprüft). Datei weg = alles wird einmal neu
geprüft, mehr nicht.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)


def default_path() -> Path:
    base = os.getenv("BSC_STATE_DIR", "").strip() or os.path.expanduser("~/.cache/home4u-bsc")
    return Path(base) / "archived_ids.tsv"


def load(path: Path, ttl_days: int, today: _dt.date | None = None) -> set[str]:
    today = today or _dt.date.today()
    cutoff = today - _dt.timedelta(days=ttl_days)
    out: set[str] = set()
    try:
        with path.open(encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) != 2 or not parts[0]:
                    continue
                try:
                    seen = _dt.date.fromisoformat(parts[1])
                except ValueError:
                    continue
                if seen >= cutoff:
                    out.add(parts[0])
    except FileNotFoundError:
        return set()
    except OSError as e:
        log.warning("archived-cache %s nicht lesbar: %s", path, e)
    return out


def append(path: Path, ids: list[str], today: _dt.date | None = None) -> None:
    if not ids:
        return
    stamp = (today or _dt.date.today()).isoformat()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.writelines(f"{i}\t{stamp}\n" for i in ids)
    except OSError as e:
        log.warning("archived-cache %s nicht schreibbar: %s", path, e)
