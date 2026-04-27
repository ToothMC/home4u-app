-- district_price_stats: Median + Quartile + Count pro (city, district, type),
-- als Basis für Preis-Anomalie-Heuristik in lib/scam/score.ts (§6.2).
--
-- Materialized View, weil:
--   - Median (percentile_cont) ist nicht inkrementell aggregierbar
--   - Score-Engine ruft pro Listing 1× ab → muss schnell sein
--   - Listing-Volume rechtfertigt nicht Live-Aggregat bei jedem Insert
--
-- Refresh: pg_cron oder externer Scheduler täglich 03:00 UTC, plus manuell
-- über public.refresh_district_price_stats().

create materialized view if not exists district_price_stats as
select
  location_city,
  coalesce(location_district, '__unknown__') as location_district,
  type,
  percentile_cont(0.50) within group (order by price) as median,
  percentile_cont(0.25) within group (order by price) as p25,
  percentile_cont(0.75) within group (order by price) as p75,
  count(*) as n,
  min(price) as min_price,
  max(price) as max_price,
  now() as refreshed_at
from listings
where status = 'active'
  and price is not null
  and price > 0
group by location_city, coalesce(location_district, '__unknown__'), type;

-- Unique-Index ist Voraussetzung für CONCURRENTLY-Refresh.
create unique index if not exists district_price_stats_pk
  on district_price_stats(location_city, location_district, type);

create or replace function public.refresh_district_price_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently district_price_stats;
exception
  when feature_not_supported or object_not_in_prerequisite_state then
    -- Erstes Refresh kann nicht concurrently sein (kein Index-Inhalt yet).
    refresh materialized view district_price_stats;
end;
$$;

revoke all on function public.refresh_district_price_stats() from public;
grant execute on function public.refresh_district_price_stats() to service_role;

-- Initial-Refresh, damit die View nicht leer in Prod landet.
-- (refresh_district_price_stats fängt den concurrently-Fehler.)
select public.refresh_district_price_stats();
