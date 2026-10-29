-- Index für die Landing-Kennzahl "Täglich neu" (components/landing/StatsStrip.tsx).
--
-- Anlass: Supabase-Warnung "Disk IO Budget wird aufgebraucht" (2026-10-29).
-- pg_stat_statements, Differenz 2026-10-23 → 2026-10-29: diese eine Abfrage
-- war mit 69 Mio. gelesenen Pages (~528 GB) der größte Disk-IO-Verbraucher
-- der Datenbank — 1.621 Aufrufe à ~5 s.
--
-- Die Abfrage
--   status = 'active' AND created_at >= now() - 24h AND canonical_id IS NULL
-- läuft mit count: "estimated". PostgREST zählt dabei exakt bis max-rows,
-- und bei ~1.000 neuen Inseraten pro Tag liegt sie immer darunter — es wird
-- also wirklich gezählt. Kein bestehender Index passt: die created_at-Indizes
-- tragen media/is_share im Prädikat. Postgres nimmt listings_is_share_idx,
-- liest alle aktiven Zeilen und verwirft fast alle.
--
-- Gemessen am 2026-10-29 (EXPLAIN ANALYZE):
--   ohne diesen Index:  Index Scan über listings_is_share_idx,
--                       256.132 Zeilen verworfen, 58.825 Pages (50.240 von
--                       Platte), 2.426 ms
--   mit diesem Index:   Index Only Scan, 622 Pages (360 von Platte), 158 ms
-- Faktor ~95 bei den gelesenen Pages. Größe: 832 kB.
--
-- created_at ändert sich nach dem INSERT nie, status und canonical_id stehen
-- schon in anderen Index-Prädikaten — der Index kostet also keine
-- zusätzlichen HOT-Updates im Crawler-Schreibpfad.
--
-- Auf Prod per CREATE INDEX CONCURRENTLY angelegt (blockiert die Crawler-
-- Upserts nicht); hier idempotent für frische Umgebungen.

create index if not exists listings_active_master_created_idx
  on public.listings (created_at desc)
  where status = 'active' and canonical_id is null;
