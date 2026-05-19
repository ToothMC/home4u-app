-- Bei Anteils-Inseraten (is_share=true) ist size_sqm = ganzes Feld und
-- price = nur Anteil. price_per_sqm wird damit dramatisch zu niedrig
-- und faerbt market_position zwangslaeufig auf "very_good" — egal wie
-- gut der Compset-Filter ist. Echtes Beispiel: 16.054 m² Plot Agia
-- Marina Chrysochous fuer 60k EUR → 3.74 EUR/m² gegen Plot-Median 49.71
-- EUR/m² → "Sehr guter Preis", obwohl es nur ein Anteil ist und das
-- Bild "PROPERTY SHARE FOR SALE" zeigt.
--
-- Fix: compute_listing_market_position skipped is_share-Listings
-- vollstaendig und setzt market_position='unknown'. UI zeigt dann nur
-- den Warn-Banner ohne irrefuehrende Preisbewertungs-Pill.
--
-- Zusaetzlich: Compset selbst filtert is_share=false, sonst koennten
-- Shares die Plot-Statistik einer kleinen Region verzerren.
--
-- Trigger feuert jetzt auch bei is_share-Aenderungen, sonst bleibt der
-- alte market_position stehen wenn ein Crawler is_share=true setzt.

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
         price, status, property_type, is_share
    into v_listing
  from listings where id = p_listing_id;

  if not found then return; end if;

  if v_listing.is_share then
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

  with comps as (
    select (l.price::numeric / l.size_sqm) as eur_per_sqm
    from listings l
    where l.id != p_listing_id
      and l.status = 'active'
      and l.is_share = false
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

  if v_compset_size < 8 then
    with comps as (
      select (l.price::numeric / l.size_sqm) as eur_per_sqm
      from listings l
      where l.id != p_listing_id
        and l.status = 'active'
        and l.is_share = false
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

drop trigger if exists listings_market_position_trg on public.listings;
create trigger listings_market_position_trg
  after insert or update of price, size_sqm, location_city, location_district,
                            rooms, type, status, property_type, is_share
  on public.listings
  for each row execute function trg_recompute_market_position();

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
where status='active' and is_share=true;
