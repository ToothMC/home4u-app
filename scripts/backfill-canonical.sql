-- Einmalig im Supabase SQL-Editor ausführen (≤2 Sekunden).
-- Erzeugt eine id-basierte Backfill-Funktion ohne den created_at-LIMIT-Bug.
-- Jeder Aufruf: processiert max p_chunk_size Listings deren id > p_after_id,
-- gibt den letzten gesehenen id und Counters zurück. Der Node-Runner ruft
-- das in einer Schleife auf bis next_after_id null ist.

create or replace function public.backfill_canonical_chunk(
  p_after_id uuid default null,
  p_chunk_size int default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing record;
  v_match uuid;
  v_processed int := 0;
  v_canonicalised int := 0;
  v_last_id uuid := null;
begin
  for v_listing in
    select l.id, l.price, l.location_city, l.type, l.property_type,
           l.rooms, l.size_sqm, l.contact_phone_hash,
           ih.phash
    from listings l
    left join image_hashes ih on ih.listing_id = l.id
    where l.status = 'active'
      and l.canonical_id is null
      and (p_after_id is null or l.id > p_after_id)
    order by l.id asc
    limit p_chunk_size
  loop
    v_processed := v_processed + 1;
    v_last_id := v_listing.id;

    v_match := find_canonical_for_signals(
      p_phash := v_listing.phash,
      p_phone_hash := v_listing.contact_phone_hash,
      p_price := v_listing.price,
      p_city := v_listing.location_city,
      p_type := v_listing.type,
      p_property_type := v_listing.property_type,
      p_rooms := v_listing.rooms,
      p_size_sqm := v_listing.size_sqm,
      p_exclude_id := v_listing.id
    );

    if v_match is not null and v_match <> v_listing.id then
      update listings
        set canonical_id = v_match
        where id = v_listing.id
          and canonical_id is null;
      if found then
        v_canonicalised := v_canonicalised + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'canonicalised', v_canonicalised,
    'next_after_id', v_last_id,
    'done', v_processed < p_chunk_size
  );
end
$$;

revoke execute on function public.backfill_canonical_chunk(uuid, int)
  from public, anon, authenticated;
grant execute on function public.backfill_canonical_chunk(uuid, int)
  to service_role;
