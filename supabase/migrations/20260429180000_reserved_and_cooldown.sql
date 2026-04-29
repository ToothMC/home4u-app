-- 20260429180000_reserved_and_cooldown.sql
--
-- Macht aus dem strikten Final-Lock von rented/sold ein selbst-heilendes
-- System mit Cooldown — und führt 'reserved' als Zwischen-Status ein.
--
-- HINTERGRUND
-- ===========
-- Bisher: Makler-Klick „vermietet" setzt status='rented' final. Crawler-
-- Logik lässt rented unangetastet. Problem: Wenn der Makler sein Bazaraki-
-- Inserat NICHT zeitgleich offline nimmt, sehen Suchende es weiter auf
-- Bazaraki, gehen direkt vorbei, das Pingpong fängt von vorne an —
-- genau das Verhalten, das wir verhindern wollten.
--
-- Neu: Cooldown-Modell. Makler-Klick ist „Wahrheit zum Zeitpunkt t" — die
-- Welt darf sich ändern.
--
--   Innerhalb 7 Tagen seit status_changed_at: rented/sold/reserved bleibt.
--   Nach 7 Tagen + Inserat ist im Crawl-Sitemap noch sichtbar:
--     -> Crawler darf wieder auf 'active' setzen (selbst-heilend).
--   Aus dem Sitemap verschwunden: bleibt rented (mark_stale eskaliert).
--   opted_out / archived: immer final, kein Cooldown.
--
-- ZUSÄTZLICH
-- ==========
-- 1. 'reserved' als neuer Status zwischen active und rented:
--    - Makler hat mündliche Zusage, will temporär vom Markt
--    - Match-Such-RPC filtert ihn raus (nicht in Treffern)
--    - Cooldown ist kürzer als rented -> nach 3d wieder active
--      (siehe v_cooldown_days-Logik unten)
--
-- 2. Cross-Source-Cascade in apply_listing_report:
--    Wenn ein Listing rented/sold/reserved gesetzt wird, werden ALLE
--    anderen Listings im selben canonical-Cluster mit-aktualisiert.
--    Sonst sieht der Suchende denselben Inserat noch über Bazaraki, weil
--    nur die INDEX-Variante (auf der geklickt wurde) finalisiert wäre.

-- ----------------------------------------------------------------------------
-- 1) Enum erweitern
-- ----------------------------------------------------------------------------

alter type listing_status add value if not exists 'reserved';

-- ----------------------------------------------------------------------------
-- 2) Spalte status_changed_at — getrennt von updated_at, das auch bei
--    nicht-Status-Änderungen tickt.
-- ----------------------------------------------------------------------------

alter table listings
  add column if not exists status_changed_at timestamptz;

-- Initial-Wert: für bestehende rented/sold/stale-Listings den letzten Status-
-- Wechsel-Zeitpunkt schätzen aus updated_at (best-effort).
update listings
   set status_changed_at = updated_at
 where status_changed_at is null
   and status in ('rented', 'sold', 'opted_out', 'archived', 'stale');

create index if not exists listings_status_changed_idx
  on listings(status_changed_at)
  where status in ('rented', 'sold', 'reserved');

comment on column listings.status_changed_at is
  'Zeitpunkt des letzten Status-Wechsels. Gesetzt vom apply_listing_report-RPC und vom bulk_upsert (Auto-Reaktivierung nach Cooldown).';
