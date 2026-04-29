-- 0048_find_canonical_for_signals.sql
--
-- Cross-Source-Dedup-RPC: für ein neu eingehendes Listing prüfen ob es
-- bereits canonical existiert. Wird vor jedem Insert vom Crawler/Importer
-- aufgerufen — Match → canonical_id auf bestehendes setzen, sonst neu.
--
-- Multi-Signal:
--   1. Cover-pHash Hamming-Distance ≤ 8 (perceptual ähnlich) + Preis ±5%
--   2. Phone-Hash identisch + Preis ±5%
--   3. (city, type, property_type, rooms, price ±5%, size_sqm ±10%) Tuple-Match
--
-- Schwellwerte konservativ — lieber doppelt insert als falscher Merge.
-- Liefert canonical_id der besten Übereinstimmung oder NULL.
--
-- Performance: Phone-Hash + City/Type sind indexed; pHash-Hamming läuft nur
-- auf bereits durch andere Filter reduziertem Set.

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
set search_path = public, pg_temp
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

  -- Signal 1 (stark): Cover-pHash + Preis
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

  -- Signal 2 (stark): Phone-Hash + Preis
  if p_phone_hash is not null and p_price is not null then
    select coalesce(l.canonical_id, l.id)
    into v_match
    from listings l
    where l.status = 'active'
      and (p_exclude_id is null or l.id <> p_exclude_id)
      and l.contact_phone_hash = p_phone_hash
      and l.price between v_price_min and v_price_max
    limit 1;
    if v_match is not null then return v_match; end if;
  end if;

  -- Signal 3 (mittel): strenges Tuple — nur wenn ALLE Felder inkl. size_sqm
  -- vorhanden sind. Lockerer Tuple-Match (ohne size) erzeugt zu viele
  -- Fehlpositive (Bazaraki-Statistik: 53% der Listings haben Tuple-Twin
  -- ohne size_sqm zu prüfen — die meisten sind verschiedene Apartments
  -- mit zufällig gleichen Specs).
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

revoke execute on function public.find_canonical_for_signals(
  bigint, text, numeric, text, listing_type, text, smallint, smallint, uuid
) from public, anon, authenticated;
