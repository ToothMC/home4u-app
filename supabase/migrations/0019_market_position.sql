-- Faire-Preis-Analyse à la mobile.de — 5-Balken-Klassifikation.
--
-- 1 Balken (orange) 'expensive': Hoher Preis        > p75 × 1.15
-- 2 Balken (orange) 'above':     Erhöhter Preis     p75 .. p75×1.15
-- 3 Balken (grün)   'fair':      Fairer Preis       p25 .. p75
-- 4 Balken (grün)   'good':      Guter Preis        p10 .. p25
-- 5 Balken (grün)   'very_good': Sehr guter Preis   ≤ p10
--
-- Vergleichsmenge: gleiche Stadt + Bezirk + Typ + Zimmer ±1 (status=active,
-- size_sqm + price vorhanden). Mind. 8 Vergleiche, sonst Stadt-only Fallback,
-- sonst 'unknown'.

alter table listings add column if not exists price_per_sqm numeric(12,2);
alter table listings add column if not exists market_position text
  check (market_position in ('very_good','good','fair','above','expensive','unknown'));
alter table listings add column if not exists market_percentile smallint
  check (market_percentile between 0 and 100);
alter table listings add column if not exists market_compset_size smallint;
alter table listings add column if not exists market_p10_eur_sqm numeric(12,2);
alter table listings add column if not exists market_p25_eur_sqm numeric(12,2);
alter table listings add column if not exists market_median_eur_sqm numeric(12,2);
alter table listings add column if not exists market_p75_eur_sqm numeric(12,2);
alter table listings add column if not exists market_updated_at timestamptz;

create index if not exists listings_market_pos_idx on listings(market_position)
  where market_position is not null;

-- Funktions-Body siehe DB-Migration. Trigger nach Insert/Update relevanter
-- Felder (price, size_sqm, location_city, location_district, rooms, type, status)
-- mit pg_trigger_depth-Guard gegen Endlos-Rekursion.
--
-- Batch: select recompute_all_market_positions(); — einmal nach Migration.
