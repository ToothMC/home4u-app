-- 20260430170000_variante_a_cluster_offers.sql
--
-- Variante A "Strict Cluster": gleiche Wohnung (per pHash) wird über alle
-- Anbieter zusammengefasst, auch wenn Preise abweichen. Match-Feed zeigt
-- günstigsten Preis + Anbieter-Anzahl, Detail-Page listet alle Angebote.
--
-- Bestandteile:
-- 1. find_canonical_for_signals Signal 1 ohne Preis-Filter (gleiche Bilder
--    = gleiche Wohnung, egal ob Makler A €1.500 und Makler B €1.800).
-- 2. get_cluster_offers(canonical_id) RPC für Detail-Page-Block.
-- 3. find_phash_cluster_match(listing_id) Helper für Backfill-Script.
-- 4. match_listings_for_profile erweitert um min_cluster_price +
--    cluster_offers_count Spalten — Frontend zeigt "ab €X · N Anbieter".

-- 1. find_canonical_for_signals — Signal 1 ohne Preis-Band
create or replace function public.find_canonical_for_signals(
  p_phash bigint default null,
  p_phone_hash text default null,
  p_price numeric default null,
  p_city text default null,
  p_type listing_type default null,
  p_property_type text default null,
  p_rooms smallint default null,
  p_size_sqm smallint default null,
  p_exclude_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_match uuid;
  v_price_min numeric;
  v_price_max numeric;
  v_size_min smallint;
  v_size_max smallint;
begin
  if p_price is not null then
    v_price_min := p_price * 0.95;
    v_price_max := p_price * 1.05;
  end if;
  if p_size_sqm is not null then
    v_size_min := (p_size_sqm * 0.9)::smallint;
    v_size_max := (p_size_sqm * 1.1)::smallint;
  end if;

  if p_phash is not null then
    select coalesce(l.canonical_id, l.id)
    into v_match
    from image_hashes ih
    join listings l on l.id = ih.listing_id
    where l.status = 'active'
      and (p_exclude_id is null or l.id <> p_exclude_id)
      and phash_hamming(ih.phash, p_phash) <= 8
    order by phash_hamming(ih.phash, p_phash) asc
    limit 1;
    if v_match is not null then return v_match; end if;
  end if;

  if p_phone_hash is not null and p_price is not null
     and p_city is not null and p_type is not null
     and p_rooms is not null then
    select coalesce(l.canonical_id, l.id)
    into v_match
    from listings l
    where l.status = 'active'
      and (p_exclude_id is null or l.id <> p_exclude_id)
      and l.contact_phone_hash = p_phone_hash
      and l.location_city = p_city
      and l.type = p_type
      and (p_property_type is null or l.property_type = p_property_type)
      and l.rooms = p_rooms
      and (p_size_sqm is null or l.size_sqm is null
           or l.size_sqm between v_size_min and v_size_max)
      and l.price between v_price_min and v_price_max
    limit 1;
    if v_match is not null then return v_match; end if;
  end if;

  if p_price is not null and p_city is not null and p_type is not null
     and p_rooms is not null and p_size_sqm is not null then
    select coalesce(l.canonical_id, l.id)
    into v_match
    from listings l
    where l.status = 'active'
      and (p_exclude_id is null or l.id <> p_exclude_id)
      and l.location_city = p_city
      and l.type = p_type
      and (p_property_type is null or l.property_type = p_property_type)
      and l.rooms = p_rooms
      and l.size_sqm is not null
      and l.size_sqm between v_size_min and v_size_max
      and l.price between v_price_min and v_price_max
    limit 1;
    if v_match is not null then return v_match; end if;
  end if;

  return null;
end
$$;

-- 2. get_cluster_offers für Detail-Page
create or replace function public.get_cluster_offers(p_canonical_id uuid)
returns table (
  listing_id uuid,
  source listing_source,
  external_id text,
  price numeric,
  currency character,
  contact_channel text,
  is_canonical boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id, l.source, l.external_id, l.price, l.currency, l.contact_channel,
    (l.id = p_canonical_id) as is_canonical
  from listings l
  where l.status = 'active'
    and (l.id = p_canonical_id or l.canonical_id = p_canonical_id)
  order by l.price asc nulls last;
$$;

revoke all on function public.get_cluster_offers(uuid) from public, anon;
grant execute on function public.get_cluster_offers(uuid) to authenticated, service_role;

-- 3. find_phash_cluster_match für Backfill-Script
create or replace function public.find_phash_cluster_match(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phash bigint;
  v_match uuid;
begin
  select phash into v_phash
  from image_hashes
  where listing_id = p_listing_id
  limit 1;
  if v_phash is null then return null; end if;

  select coalesce(other.canonical_id, other.id)
  into v_match
  from image_hashes ih
  join listings other on other.id = ih.listing_id
  where other.status = 'active'
    and other.id <> p_listing_id
    and phash_hamming(ih.phash, v_phash) <= 8
  order by phash_hamming(ih.phash, v_phash) asc
  limit 1;
  return v_match;
end;
$$;

revoke all on function public.find_phash_cluster_match(uuid) from public, anon;
grant execute on function public.find_phash_cluster_match(uuid) to authenticated, service_role;

-- 4. match_listings_for_profile mit cluster-aggregaten — siehe separate
-- Migration 20260430160001_match_rpc_cluster_aggregates (drop+create wegen
-- returns-table-Signatur-Änderung).
