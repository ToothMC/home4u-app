"""Lokale SQLite-State-DB: tracked welche post_ids wir schon klassifiziert haben,
damit wir bei Re-Scrolls keine LLM-Calls + DB-Upserts wiederholen.

Nicht authoritative — die DB-Side-UNIQUE auf (source, dedup_hash) ist die
echte Wahrheit. Das hier ist Cost/Latency-Schutz vor doppelten Haiku-Calls.
"""
from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

log = logging.getLogger(__name__)


SCHEMA = """
create table if not exists seen_posts (
  post_id text primary key,
  classified_category text,    -- "rent" | "sale" | "wanted" | "other" | NULL = noch nicht klassifiziert
  upserted_at text,            -- ISO-Timestamp wenn in Supabase geschrieben
  first_seen_at text not null default (datetime('now')),
  last_seen_at text not null default (datetime('now'))
);
"""


@contextmanager
def open_state(db_path: Path) -> Iterator[sqlite3.Connection]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()


def filter_unseen(conn: sqlite3.Connection, post_ids: list[str]) -> set[str]:
    """Gibt die Teilmenge zurück, die noch nicht klassifiziert wurde."""
    if not post_ids:
        return set()
    placeholders = ",".join("?" for _ in post_ids)
    rows = conn.execute(
        f"select post_id from seen_posts where post_id in ({placeholders}) "
        f"and classified_category is not null",
        post_ids,
    ).fetchall()
    seen = {r[0] for r in rows}
    # Touch last_seen für alle (auch die schon klassifizierten)
    conn.executemany(
        "insert into seen_posts(post_id) values (?) "
        "on conflict(post_id) do update set last_seen_at = datetime('now')",
        [(pid,) for pid in post_ids],
    )
    return set(post_ids) - seen


def mark_classified(conn: sqlite3.Connection, post_id: str, category: str) -> None:
    conn.execute(
        "insert into seen_posts(post_id, classified_category) values (?, ?) "
        "on conflict(post_id) do update set classified_category = excluded.classified_category, "
        "last_seen_at = datetime('now')",
        (post_id, category),
    )


def mark_upserted(conn: sqlite3.Connection, post_id: str) -> None:
    conn.execute(
        "update seen_posts set upserted_at = datetime('now'), last_seen_at = datetime('now') "
        "where post_id = ?",
        (post_id,),
    )


def stats(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        "select classified_category, count(*) from seen_posts group by classified_category"
    ).fetchall()
    out: dict[str, int] = {}
    for cat, n in rows:
        out[cat or "_unclassified"] = n
    out["_upserted"] = conn.execute(
        "select count(*) from seen_posts where upserted_at is not null"
    ).fetchone()[0]
    return out
