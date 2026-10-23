-- /stoebern: Regionsfilter indexierbar machen.
--
-- Vorher: location_city ILIKE 'Paphos%' + ORDER BY created_at. Postgres ging
-- die neuesten Inserate über listings_browse_type_created_ok_idx einzeln durch
-- und verwarf z.B. für "Kaufen + Paphos" 9.002 Zeilen, um 24 zu finden
-- (gemessen 6,8 s, cold cache). Zusammen mit der Zählung lief das
-- regelmäßig ins 8-s-Statement-Timeout → die Seite zeigte "0 Treffer".
--
-- Jetzt: Region als IMMUTABLE-SQL-Funktion (wird inlined) + Computed Field
-- `region` für PostgREST (?region=eq.paphos) + passender Ausdrucks-Index.

create or replace function public.listing_region_of(city text)
returns text language sql immutable parallel safe as $$
  select case
    when city ilike 'paphos%'    then 'paphos'
    when city ilike 'limassol%'  then 'limassol'
    when city ilike 'nicosia%'   then 'nicosia'
    when city ilike 'larnaca%'   then 'larnaca'
    when city ilike 'famagusta%' then 'famagusta'
  end
$$;

create or replace function public.region(l public.listings)
returns text language sql immutable parallel safe as $$
  select public.listing_region_of(l.location_city)
$$;

grant execute on function public.listing_region_of(text) to anon, authenticated, service_role;
grant execute on function public.region(public.listings) to anon, authenticated, service_role;

-- Auf Prod per pg_cron-Einmaljob gebaut (CONCURRENTLY braucht bei der
-- aktuellen Disk-IO länger als das 2-min-Limit des SQL-Editors/MCP).
create index concurrently if not exists listings_browse_region_type_created_idx
  on public.listings (public.listing_region_of(location_city), type, created_at desc)
  where status = 'active' and is_share = false and media is not null and media_ok is not false;

-- Planner-Statistik für den Regions-Ausdruck (sonst rät Postgres die
-- Trefferzahl: "Kaufen + Paphos" geschätzt 845 statt real 24.251).
create statistics if not exists public.listings_region_type_stats (mcv)
  on (public.listing_region_of(location_city)), type from public.listings;
