"""Pre-Touch darf keine Leichen auffrischen (Befund 2026-10-26)."""
from src.supabase_writer import is_touchable


def test_only_active_with_intact_cover_is_touchable():
    assert is_touchable({"status": "active", "media_ok": True})
    assert is_touchable({"status": "active", "media_ok": None})  # noch ungeprüft
    assert not is_touchable({"status": "active", "media_ok": False})  # Bild gelöscht
    assert not is_touchable({"status": "stale", "media_ok": True})
    assert not is_touchable({"status": "archived", "media_ok": None})
    assert not is_touchable({})
