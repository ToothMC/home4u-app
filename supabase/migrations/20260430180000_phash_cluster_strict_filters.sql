-- 20260430180000_phash_cluster_strict_filters.sql
--
-- pHash-Cluster verschärfen, nachdem Variante A massive False-Cluster
-- erzeugt hat (Stock-Photos, Branded-Default-Cover, Plot/Land-Maps):
--   - 73er-Cluster: 1-Bed Larnaca Apartments mit gleichem Cover-Stock-Foto
--   - 30er-Cluster: Residential Plots mit Maps-Cover
-- Nach Cleanup: max-Cluster 14, nur noch 4 mit >10, 991 realistische 2-4er.
--
-- 1. find_canonical_for_signals Signal 1: pHash NUR mit
--    city + type + rooms-Tuple, NUR für bewohnbare Property-Types
--    (apartment/house/villa/townhouse/maisonette/penthouse).
--    Plot/Land/rooms=0 explizit ausgeschlossen.
-- 2. find_phash_cluster_match (Backfill-Helper) ebenfalls strenger.
-- 3. backfill_phash_cluster_batch (Bulk) ebenfalls strenger.
-- 4. Backfill: bestehende falsche Cluster aufbrechen wo
--    city/type/rooms-Mismatch ODER Plot/Land-Master ODER
--    District-Asymmetrie ODER Preis-/Size-Spread > 30/40%.

-- Cleanup-Statements (idempotent, lieber zuviel als zuwenig):

-- A) Cluster mit city/type/rooms-Mismatch
update listings d
   set canonical_id = null, updated_at = now()
  from listings c
 where d.canonical_id = c.id and d.id <> c.id
   and (
     d.location_city <> c.location_city
     or d.type <> c.type
     or coalesce(d.rooms, -1) <> coalesce(c.rooms, -1)
   );

-- B) Cluster mit District-Mismatch
update listings d
   set canonical_id = null, updated_at = now()
  from listings c
 where d.canonical_id = c.id and d.id <> c.id
   and (
     (d.location_district is not null and c.location_district is not null
      and d.location_district <> c.location_district)
     or
     (c.location_district is null and d.location_district is not null
      and exists (
        select 1 from listings d2
        where d2.canonical_id = c.id and d2.id <> d.id and d2.id <> c.id
          and d2.location_district is not null
          and d2.location_district <> d.location_district
      ))
   );

-- C) Cluster mit Preis-Spread > 30% oder Size-Spread > 40%
update listings d
   set canonical_id = null, updated_at = now()
  from listings c
 where d.canonical_id = c.id and d.id <> c.id
   and (
     abs(d.price - c.price) / nullif(greatest(c.price, 1), 0) > 0.30
     or (d.size_sqm is not null and c.size_sqm is not null
         and abs(d.size_sqm::numeric - c.size_sqm::numeric)
             / nullif(greatest(c.size_sqm::numeric, 1), 0) > 0.40)
   );

-- D) Plot/Land-Cluster komplett aufbrechen
update listings d
   set canonical_id = null, updated_at = now()
  from listings c
 where d.canonical_id = c.id and d.id <> c.id
   and (d.property_type in ('plot','land') or c.property_type in ('plot','land')
        or coalesce(d.rooms, 0) = 0 or coalesce(c.rooms, 0) = 0);

-- Forward-Fix: find_canonical_for_signals
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
  v_price_min numeric; v_price_max numeric;
  v_size_min smallint; v_size_max smallint;
begin
  if p_price is not null then
    v_price_min := p_price * 0.95;
    v_price_max := p_price * 1.05;
  end if;
  if p_size_sqm is not null then
    v_size_min := (p_size_sqm * 0.9)::smallint;
    v_size_max := (p_size_sqm * 1.1)::smallint;
  end if;

  if p_phash is not null and p_city is not null and p_type is not null
     and p_rooms is not null and p_rooms > 0
     and (p_property_type is null or p_property_type not in ('plot','land')) then
    select coalesce(l.canonical_id, l.id) into v_match
    from image_hashes ih
    join listings l on l.id = ih.listing_id
    where l.status = 'active'
      and (p_exclude_id is null or l.id <> p_exclude_id)
      and phash_hamming(ih.phash, p_phash) <= 8
      and l.location_city = p_city
      and l.type = p_type
      and l.rooms = p_rooms
      and (l.property_type is null or l.property_type not in ('plot','land'))
    order by phash_hamming(ih.phash, p_phash) asc
    limit 1;
    if v_match is not null then return v_match; end if;
  end if;

  if p_phone_hash is not null and p_price is not null
     and p_city is not null and p_type is not null and p_rooms is not null then
    select coalesce(l.canonical_id, l.id) into v_match
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
    select coalesce(l.canonical_id, l.id) into v_match
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
