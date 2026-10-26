"""Offline-Tests: Recheck aus der DB, Redirect-Deutung, Verschränkung.

Kein Netz, keine DB — Session, RPCs und Uhr sind ersetzt.
"""
from __future__ import annotations

import datetime as dt

import pytest

from src import archived_cache, detail, main as m
from src.detail import STATUS_ACTIVE, STATUS_ARCHIVED, STATUS_ERROR, classify_redirect, check_detail
from src.sitemap import ListingURL, parse_sitemap_index

BASE = "https://www.buysellcyprus.com"


def url_for(lid: str, district: str = "zakaki") -> str:
    return f"{BASE}/property-for-sale/limassol/{district}/2-bed-apartment-for-sale-{district}-limassol-{lid}.html"


def lurl(lid: str, district: str = "zakaki") -> ListingURL:
    return ListingURL(lid, url_for(lid, district), "limassol", district,
                      f"2-bed-apartment-for-sale-{district}-limassol")


def page(lid: str, price: str | None = "€350,000") -> str:
    tail = f" - {price}" if price else ""
    return (f"<html><head><title>2 Bedroom Apartment for sale in Zakaki (ID:{lid}){tail}"
            f" - BuySellCyprus.com</title></head><body>2 Bathrooms 85 sqm</body></html>")


class FakeSession:
    """routes: url → (status, body, location)"""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls: list[tuple[str, bool]] = []

    def fetch(self, url, timeout=30, retries=3, allow_redirects=True):
        self.calls.append((url, allow_redirects))
        if url not in self.routes:
            raise RuntimeError("no route")
        return self.routes[url]


# ---------------------------------------------------------------- redirects

@pytest.mark.parametrize("location,kind", [
    (f"{BASE}/properties-for-sale/location-Ypsonas-Limassol/page-1", "removed"),
    (BASE, "removed"),
    (f"{BASE}/", "removed"),
    ("/properties-for-sale/location-Acropolis-Nicosia/page-1", "removed"),
    (url_for("1243857", "latsia"), "moved"),
    (url_for("9999999"), "unknown"),          # fremde ID
    (f"{BASE}/login", "unknown"),
    ("https://evil.example/properties-for-sale/x", "unknown"),
    (None, "unknown"),
])
def test_classify_redirect(location, kind):
    assert classify_redirect(url_for("1243857", "dali"), location, "1243857")[0] == kind


def test_check_detail_redirect_to_search_is_archived():
    u = lurl("1201887")
    s = FakeSession({u.detail_url: (301, "", f"{BASE}/properties-for-sale/location-Zakaki/page-1")})
    assert check_detail(s, u) == (STATUS_ARCHIVED, None)
    assert s.calls == [(u.detail_url, False)]  # Redirect NICHT blind gefolgt


def test_check_detail_moved_follows_same_id_and_reports_new_url():
    u = lurl("1243857", "dali")
    new = url_for("1243857", "latsia")
    s = FakeSession({u.detail_url: (301, "", new), new: (200, page("1243857"), None)})
    status, p = check_detail(s, u)
    assert status == STATUS_ACTIVE
    assert p.detail_url == new and p.price == 350000


def test_check_detail_404_no_price_mismatch_unknown():
    u = lurl("1")
    assert check_detail(FakeSession({u.detail_url: (404, "", None)}), u)[0] == STATUS_ARCHIVED
    assert check_detail(FakeSession({u.detail_url: (200, page("1", None), None)}), u)[0] == STATUS_ARCHIVED
    # Seite eines anderen Inserats → kein Lebenszeichen
    assert check_detail(FakeSession({u.detail_url: (200, page("2"), None)}), u)[0] == STATUS_ERROR
    assert check_detail(FakeSession({u.detail_url: (301, "", f"{BASE}/login")}), u)[0] == STATUS_ERROR
    assert check_detail(FakeSession({u.detail_url: (403, "Just a moment", None)}), u)[0] == STATUS_ERROR
    assert check_detail(FakeSession({}), u)[0] == STATUS_ERROR


# ---------------------------------------------------------------- sitemap index

def test_sitemap_index_rewrites_gz_and_keeps_all_files():
    body = "<sitemapindex>" + "".join(
        f"<sitemap>\n\t<loc>{BASE}/sitemap{i}.xml.gz</loc>\n</sitemap>" for i in range(1, 12)
    ) + "</sitemapindex>"
    files = parse_sitemap_index(body)
    assert len(files) == 11
    assert files[-1] == f"{BASE}/sitemap11.xml"
    assert all(f.endswith(".xml") for f in files)


# ---------------------------------------------------------------- recheck helpers

def test_build_recheck_items_prefers_db_url_falls_back_to_sitemap():
    cands = [
        {"external_id": "1", "source_url": url_for("1"), "price": 100},
        {"external_id": "2", "source_url": None, "price": 100},           # Sitemap-Fallback
        {"external_id": "3", "source_url": "kaputt", "price": 100},       # weder noch
        {"external_id": "4", "source_url": url_for("5"), "price": 100},   # URL zu fremder ID
        {"external_id": "1", "source_url": url_for("1"), "price": 100},   # doppelt
    ]
    items, meta, no_url = m.build_recheck_items(cands, {"2": lurl("2"), "4": lurl("4")})
    assert [i.listing_id for i in items] == ["1", "2", "4"]
    assert items[2].detail_url == url_for("4")
    assert no_url == 1 and set(meta) == {"1", "2", "4"}


def test_needs_upsert():
    p = detail.ParsedListing.__new__(detail.ParsedListing)
    p.price, p.detail_url = 350000.0, url_for("1")
    assert not m.needs_upsert(p, {"price": 350000, "source_url": url_for("1")})
    assert m.needs_upsert(p, {"price": 340000, "source_url": url_for("1")})
    assert m.needs_upsert(p, {"price": 350000, "source_url": url_for("1", "latsia")})
    assert m.needs_upsert(p, {"price": None, "source_url": url_for("1")})
    assert m.needs_upsert(p, None)


def test_gone_share_guard():
    assert not m.gone_share_exceeded(10, 30, 0.5)   # zu wenige
    assert not m.gone_share_exceeded(25, 75, 0.5)
    assert m.gone_share_exceeded(60, 40, 0.5)


def test_scheduler_time_share_with_unequal_costs():
    """Neu kostet 4,5 s, Recheck 1,3 s — Zeitanteil soll ~70 % bleiben."""
    t = {True: 0.0, False: 0.0}
    n = {True: 0, False: 0}
    for _ in range(3000):
        rc = m.pick_recheck(t[True], t[False], 0.7, True, True)
        t[rc] += 1.3 if rc else 4.5
        n[rc] += 1
    share = t[True] / (t[True] + t[False])
    assert 0.68 < share < 0.72
    assert n[False] > 300  # Neu kommt auch voran
    assert not m.pick_recheck(0, 0, 0.7, False, True)
    assert m.pick_recheck(100, 0, 0.7, True, False)


# ---------------------------------------------------------------- archived cache

def test_archived_cache_roundtrip_and_ttl(tmp_path):
    p = tmp_path / "x" / "archived.tsv"
    old, today = dt.date(2026, 8, 1), dt.date(2026, 10, 26)
    archived_cache.append(p, ["1", "2"], today=old)
    archived_cache.append(p, ["3"], today=today)
    p.open("a").write("kaputt\n")
    assert archived_cache.load(p, 60, today=today) == {"3"}
    assert archived_cache.load(p, 120, today=today) == {"1", "2", "3"}
    assert archived_cache.load(tmp_path / "fehlt.tsv", 60) == set()


# ---------------------------------------------------------------- Lauf simuliert

class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def time(self):
        return self.t

    def sleep(self, s):
        self.t += s


def test_run_backlog_does_not_starve_recheck(monkeypatch, tmp_path):
    """5.000 neue im Rückstau, 3.000 Recheck-Kandidaten, 90-min-Budget:
    Recheck muss trotzdem drankommen, Gelöschte stale, Lebende angetippt."""
    clock = Clock()
    monkeypatch.setattr(m, "time", clock)
    monkeypatch.setenv("SUPABASE_URL", "http://x")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setenv("BSC_STATE_DIR", str(tmp_path))
    monkeypatch.setenv("SKIP_PHASH", "1")
    for k in ("MAX_LISTINGS", "DRY_RUN", "FORCE_REFETCH", "DEFER_MARKET_POSITION",
              "RECHECK_SHARE", "RECHECK_PER_RUN"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(m, "BscSession", lambda: None)

    sitemap = [lurl(str(100000 + i)) for i in range(5000)]       # alles neu
    gone_new = {u.listing_id for u in sitemap[:300]}              # vorne tote
    cands = [{"external_id": str(i), "source_url": url_for(str(i)), "price": 350000,
              "last_seen": "2026-05-18"} for i in range(1, 3001)]
    gone_rc = {str(i) for i in range(1, 3001) if i % 8 == 0}     # 12,5 % gelöscht
    moved_rc = {"7"}

    monkeypatch.setattr(m, "discover_all_listings", lambda s: sitemap)
    monkeypatch.setattr(m, "lookup_known_ids", lambda ids: (set(), set()))
    monkeypatch.setattr(m, "recheck_candidates", lambda age, lim: cands[:lim])

    def fake_check(session, item):
        lid = item.listing_id
        is_new = int(lid) >= 100000
        clock.t += 0.3
        if lid in gone_rc or lid in gone_new:
            return STATUS_ARCHIVED, None
        p = detail.ParsedListing.__new__(detail.ParsedListing)
        p.listing_id, p.price, p.media = lid, 350000.0, []
        p.detail_url = url_for(lid, "latsia") if lid in moved_rc else item.detail_url
        if is_new:
            clock.t += 3.2  # Insert-Kosten (pro Item verbucht)
        return STATUS_ACTIVE, p

    monkeypatch.setattr(m, "check_detail", fake_check)
    stale, touched, upserted = [], [], []
    monkeypatch.setattr(m, "mark_stale_ids", lambda ids: stale.extend(ids) or len(ids))
    monkeypatch.setattr(m, "touch_ids", lambda ids: touched.extend(ids) or len(ids))
    monkeypatch.setattr(m, "upsert_listings", lambda b: upserted.extend(x.listing_id for x in b)
                        or {"inserted": len(b), "updated": 0, "failed": []})
    monkeypatch.setattr(m, "_mark_stale_rpc", lambda: 0)

    assert m.main() == 0

    n_rc = len(set(stale) | set(touched) | ({"7"} & set(upserted)))
    assert n_rc > 2500, n_rc                 # Recheck kam trotz Rückstau dran
    assert set(stale) <= gone_rc and len(stale) > 300
    assert "7" in upserted and "7" not in touched   # umgezogen → Upsert
    assert not (set(touched) & gone_rc)
    assert any(int(i) >= 100000 for i in upserted)  # Neu kam auch voran
    # tote neue IDs sind gemerkt und werden nächstes Mal übersprungen
    assert archived_cache.load(archived_cache.default_path(), 60) == gone_new


def test_run_guard_stops_mass_stale(monkeypatch, tmp_path):
    clock = Clock()
    monkeypatch.setattr(m, "time", clock)
    monkeypatch.setenv("SUPABASE_URL", "http://x")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setenv("BSC_STATE_DIR", str(tmp_path))
    for k in ("MAX_LISTINGS", "DRY_RUN", "FORCE_REFETCH", "DEFER_MARKET_POSITION"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(m, "BscSession", lambda: None)
    monkeypatch.setattr(m, "discover_all_listings", lambda s: [lurl("1")])
    monkeypatch.setattr(m, "lookup_known_ids", lambda ids: ({"1"}, set()))
    cands = [{"external_id": str(i), "source_url": url_for(str(i)), "price": 1}
             for i in range(10, 400)]
    monkeypatch.setattr(m, "recheck_candidates", lambda age, lim: cands[:lim])
    monkeypatch.setattr(m, "check_detail", lambda s, it: (STATUS_ARCHIVED, None))
    stale = []
    monkeypatch.setattr(m, "mark_stale_ids", lambda ids: stale.extend(ids) or len(ids))
    monkeypatch.setattr(m, "touch_ids", lambda ids: len(ids))
    monkeypatch.setattr(m, "_mark_stale_rpc", lambda: 0)

    assert m.main() == 1
    assert stale == []
