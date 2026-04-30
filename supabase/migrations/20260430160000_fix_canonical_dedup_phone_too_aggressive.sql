-- 20260430160000_fix_canonical_dedup_phone_too_aggressive.sql
--
-- Bug: find_canonical_for_signals Signal 2 matched aufgrund von
-- phone_hash + price ±5% ALLEINE → alle Listings desselben Maklers im
-- gleichen Preisband wurden als "Duplikate" eines einzigen Masters
-- markiert. Resultat: 4.363 falsche Duplikate auf einem Master,
-- 7.500+ Listings auf den Top-10-Schwarzen-Löchern. INDEX.cy zeigte
-- nur 48 von 8.533 als sichtbare canonicals.
--
-- Fix:
-- 1. Signal 2 strenger — phone_hash+price NUR matched wenn city+type+
--    rooms (+ optional size) übereinstimmen. Echtes Repost-Duplikat
--    (Makler stellt dasselbe Listing auf mehreren Plattformen) schlägt
--    weiter durch; verschiedene Listings desselben Maklers nicht mehr.
-- 2. Backfill: alle bestehenden falschen canonical_id-Verknüpfungen
--    auflösen wo city/type/property_type/rooms abweicht (sicherer
--    Heuristik-Cut: 8.563 Listings wieder sichtbar).

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

  -- Signal 1 (stark): Cover-pHash + Preis. pHash ist visuell eindeutig
  -- genug — gleiche Bilder = gleiche Wohnung.
  if p_phash is not null then
    select coalesce(l.canonical_id, l.id)
    into v_match
    from image_hashes ih
    join listings l on l.id = ih.listing_id
    where l.status = 'active'
      and (p_exclude_id is null or l.id <> p_exclude_id)
      and phash_hamming(ih.phash, p_phash) <= 8
      and (p_price is null or l.price between v_price_min and v_price_max)
    order by phash_hamming(ih.phash, p_phash) asc
    limit 1;
    if v_match is not null then return v_match; end if;
  end if;

  -- Signal 2 (mittel): Phone-Hash MIT vollem Tuple-Filter.
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

  -- Signal 3 (mittel): strenges Tuple ohne phone_hash — Fallback wenn
  -- pHash UND phone_hash beide null.
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

-- Backfill: alle bestehenden falschen Phone-Hash-Match-Verknüpfungen lösen.
update listings d
   set canonical_id = null,
       updated_at = now()
  from listings c
 where d.canonical_id = c.id
   and d.id <> c.id
   and (
     d.location_city <> c.location_city
     or d.type <> c.type
     or coalesce(d.property_type, '') <> coalesce(c.property_type, '')
     or coalesce(d.rooms, -1) <> coalesce(c.rooms, -1)
   );
