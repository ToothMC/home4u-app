-- Browse-Index für den Opt-in-Pfad "Anteils-Inserate einbeziehen" (?shares=1).
--
-- `listings_browse_created_idx` trägt `is_share = false` im Prädikat. Die
-- Stöbern-Abfrage hängt diesen Filter aber nur an, wenn die Anteils-Inserate
-- ausgeblendet bleiben sollen (lib/browse/filters.ts: `if (!f.includeShares)
-- q = q.eq("is_share", false)`). Beim Opt-in fällt er weg — und damit kann
-- Postgres den Partial-Index nicht mehr verwenden.
--
-- Gemessen am 2026-10-26 (EXPLAIN ANALYZE, warm):
--   ohne diesen Index:  Parallel Index Scan über listings_is_share_idx,
--                       187.656 Zeilen, 40.807 Pages gelesen, 5.251 ms
--   mit diesem Index:   Index Scan, 14 Pages gelesen, 4,0 ms
-- Faktor ~1.300. Warm lag der alte Pfad schon knapp unter dem
-- 8s-Statement-Timeout; kalt kippte er darüber, und die Seite lieferte dann
-- eine leere Liste.
--
-- Dasselbe Muster hatte die Startseite ("Neu reingekommen"), dort behoben in
-- b4d7d7e, indem die Abfrage `is_share = false` mitfiltert. Hier geht das
-- nicht: der Opt-in WILL die Anteils-Inserate sehen. Darum ein eigener Index
-- ohne das is_share-Prädikat.
--
-- Kosten: 1816 kB. Die 1.131 Anteils-Inserate sind 0,47 % der 243.076
-- aktiven — der Index deckt bewusst beide Pfade ab, statt nur die Differenz.
--
-- media_ok bleibt absichtlich draußen: der Wert ändert sich bei jedem
-- media-check-Lauf für viele Zeilen, ein Index darauf würde dauernd
-- umgeschrieben. Als Filter nach dem Index ist er billig, solange die
-- Sortierreihenfolge aus dem Index kommt.

create index if not exists listings_browse_created_incl_shares_idx
  on public.listings (created_at desc)
  where status = 'active' and media is not null;
