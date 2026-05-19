-- Bug: compute_listing_market_position vergleicht jede Immobilie gegen den
-- gesamten Mix in der Stadt — Grundstücke (~150 €/m²) gegen Wohnungen
-- (~3.500 €/m²), Häuser gegen Plots etc. Ein Plot fuer 172 €/m² landete
-- so immer auf "Sehr guter Preis" obwohl die Vergleichsmenge dominant
-- aus Wohnungen besteht. UI zeigt dann irrefuehrend "DIESE WOHNUNG /
-- 172 €/m² / MARKT-MEDIAN 3.481 €/m²" fuer ein Grundstueck.
--
-- Fix: property_type_group() klassifiziert in 5 Buckets, compset wird auf
-- die gleiche Gruppe beschraenkt. Trigger feuert zusaetzlich bei
-- property_type-Aenderungen.

-- Helper: semantische Gruppierung der property_type-Werte. Seltene Typen
-- (villa, penthouse, townhouse, bungalow, maisonette) werden mit dem
-- naechstliegenden grossen Bucket gepoolt, damit compset_size gesund
-- bleibt. 'other' ist explizit ein No-Op-Bucket → kein Filter.
create or replace function public._property_type_group(p text) returns text
language sql immutable parallel safe
set search_path = 'pg_catalog'
as $$
  select case lower(coalesce(p,''))
    when 'apartment' then 'residential_apartment'
    when 'studio' then 'residential_apartment'
    when 'penthouse' then 'residential_apartment'
    when 'maisonette' then 'residential_apartment'
    when 'house' then 'residential_house'
    when 'villa' then 'residential_house'
    when 'townhouse' then 'residential_house'
    when 'bungalow' then 'residential_house'
    when 'plot' then 'plot'
    when 'land' then 'plot'
    when 'commercial' then 'commercial'
    when 'building' then 'commercial'
    when 'room' then 'room'
    else 'other'
  end
$$;

create or replace function public.compute_listing_market_position(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_listing record;
  v_group text;
  v_p10 numeric;
  v_p25 numeric;
  v_p50 numeric;
  v_p75 numeric;
  v_compset_size int;
  v_per_sqm numeric;
  v_position text;
  v_percentile smallint;
begin
  select id, type, location_city, location_district, rooms, size_sqm,
         price, status, property_type
    into v_listing
  from listings where id = p_listing_id;

  if not found then return; end if;

  if v_listing.size_sqm is null or v_listing.size_sqm < 5
     or v_listing.price is null or v_listing.price <= 0 then
    update listings set
      price_per_sqm = null,
      market_position = 'unknown',
      market_percentile = null,
      market_compset_size = 0,
      market_p10_eur_sqm = null,
      market_p25_eur_sqm = null,
      market_median_eur_sqm = null,
      market_p75_eur_sqm = null,
      market_updated_at = now()
    where id = p_listing_id;
    return;
  end if;

  v_per_sqm := v_listing.price::numeric / v_listing.size_sqm;
  v_group := _property_type_group(v_listing.property_type);

  -- Stadt+Bezirk
  with comps as (
    select (l.price::numeric / l.size_sqm) as eur_per_sqm
    from listings l
    where l.id != p_listing_id
      and l.status = 'active'
      and l.type = v_listing.type
      and l.size_sqm is not null and l.size_sqm >= 5
      and l.price is not null and l.price > 0
      and lower(l.location_city) = lower(v_listing.location_city)
      and (
        v_listing.location_district is null
        or l.location_district is null
        or lower(l.location_district) = lower(v_listing.location_district)
      )
      and (
        v_listing.rooms is null
        or l.rooms is null
        or abs(coalesce(l.rooms, v_listing.rooms) - v_listing.rooms) <= 1
      )
      -- NEU: property_type-Gruppe muss passen. 'other' = kein Filter
      -- (Fallback, damit Listings ohne klassifizierbaren Typ nicht
      -- unbewertet bleiben).
      and (
        v_group = 'other'
        or _property_type_group(l.property_type) = v_group
      )
  )
  select count(*),
    percentile_cont(0.10) within group (order by eur_per_sqm),
    percentile_cont(0.25) within group (order by eur_per_sqm),
    percentile_cont(0.50) within group (order by eur_per_sqm),
    percentile_cont(0.75) within group (order by eur_per_sqm)
  into v_compset_size, v_p10, v_p25, v_p50, v_p75
  from comps;

  -- Fallback 1: Stadt-only (ohne Bezirk)
  if v_compset_size < 8 then
    with comps as (
      select (l.price::numeric / l.size_sqm) as eur_per_sqm
      from listings l
      where l.id != p_listing_id
        and l.status = 'active'
        and l.type = v_listing.type
        and l.size_sqm is not null and l.size_sqm >= 5
        and l.price is not null and l.price > 0
        and lower(l.location_city) = lower(v_listing.location_city)
        and (
          v_listing.rooms is null
          or l.rooms is null
          or abs(coalesce(l.rooms, v_listing.rooms) - v_listing.rooms) <= 1
        )
        and (
          v_group = 'other'
          or _property_type_group(l.property_type) = v_group
        )
    )
    select count(*),
      percentile_cont(0.10) within group (order by eur_per_sqm),
      percentile_cont(0.25) within group (order by eur_per_sqm),
      percentile_cont(0.50) within group (order by eur_per_sqm),
      percentile_cont(0.75) within group (order by eur_per_sqm)
    into v_compset_size, v_p10, v_p25, v_p50, v_p75
    from comps;
  end if;

  if v_compset_size < 8 or v_p50 is null then
    update listings set
      price_per_sqm = v_per_sqm,
      market_position = 'unknown',
      market_percentile = null,
      market_compset_size = coalesce(v_compset_size, 0),
      market_p10_eur_sqm = v_p10,
      market_p25_eur_sqm = v_p25,
      market_median_eur_sqm = v_p50,
      market_p75_eur_sqm = v_p75,
      market_updated_at = now()
    where id = p_listing_id;
    return;
  end if;

  -- 5-Balken-Klassifikation
  if v_per_sqm <= v_p10 then v_position := 'very_good';
  elsif v_per_sqm <= v_p25 then v_position := 'good';
  elsif v_per_sqm <= v_p75 then v_position := 'fair';
  elsif v_per_sqm <= v_p75 * 1.15 then v_position := 'above';
  else v_position := 'expensive';
  end if;

  v_percentile := least(100, greatest(0, round(
    case
      when v_per_sqm <= v_p25 then (v_per_sqm / nullif(v_p25, 0)) * 25
      when v_per_sqm <= v_p50 then 25 + (v_per_sqm - v_p25) / nullif(v_p50 - v_p25, 0) * 25
      when v_per_sqm <= v_p75 then 50 + (v_per_sqm - v_p50) / nullif(v_p75 - v_p50, 0) * 25
      else 75 + least(25, (v_per_sqm - v_p75) / nullif(v_p75 * 0.5, 0) * 25)
    end
  )::int));

  update listings set
    price_per_sqm = v_per_sqm,
    market_position = v_position,
    market_percentile = v_percentile,
    market_compset_size = v_compset_size,
    market_p10_eur_sqm = v_p10,
    market_p25_eur_sqm = v_p25,
    market_median_eur_sqm = v_p50,
    market_p75_eur_sqm = v_p75,
    market_updated_at = now()
  where id = p_listing_id;
end;
$function$;

-- Trigger neu setzen damit auch property_type-Aenderungen einen Recompute
-- ausloesen (vorher nur price/size/location/rooms/type/status).
drop trigger if exists listings_market_position_trg on public.listings;
create trigger listings_market_position_trg
  after insert or update of price, size_sqm, location_city, location_district,
                            rooms, type, status, property_type
  on public.listings
  for each row execute function trg_recompute_market_position();

-- Batched recompute-Helper, damit ein Full-Recompute (80k+ Rows) nicht
-- in einer einzigen Transaktion laeuft. Aufruf:
--   select recompute_market_positions_chunk(2000);
-- bis Rueckgabewert 0 ist. Verarbeitet nur Eintraege, deren market_updated_at
-- aelter ist als now() — also alle ausser denen, die der Trigger inzwischen
-- selbst neu berechnet hat.
create or replace function public.recompute_market_positions_chunk(p_limit int default 1000)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_count int := 0;
  v_cutoff timestamptz := now();
begin
  for v_id in
    select id from listings
    where status = 'active'
      and (market_updated_at is null or market_updated_at < v_cutoff)
    order by market_updated_at nulls first
    limit p_limit
  loop
    perform public.compute_listing_market_position(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
