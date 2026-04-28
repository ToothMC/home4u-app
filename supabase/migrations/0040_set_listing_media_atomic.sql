-- Atomarer Editor-Helper: Source-of-Truth ist das Editor-`media[]`-Array.
-- Der Call:
--  1. Updated listings.media[] und updated_at
--  2. Löscht listing_photos-Rows deren URL nicht (mehr) im Array ist
--  3. Inserted neue Rows für URLs die noch nicht in listing_photos sind
--  4. Updated position für alle überlebenden Rows = neuer Array-Index
--     (preserves room_type / caption — die werden NICHT überschrieben)
--
-- Vorher: Editor schrieb nur listings.media. analyze/import schreiben in
-- listing_photos. public-listing.ts liest bevorzugt listing_photos →
-- Editor-Reorder/Delete waren unsichtbar im Public-View.

create or replace function public.set_listing_media(
  p_listing_id uuid,
  p_media text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_caller uuid := auth.uid();
begin
  -- Ownership-Check: nur owner darf media bearbeiten
  select owner_user_id into v_owner from listings where id = p_listing_id;
  if v_owner is null then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_caller is null or v_caller != v_owner then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- 1. listings.media als Source-of-Truth aktualisieren
  update listings
  set media = coalesce(p_media, '{}'::text[]),
      updated_at = now()
  where id = p_listing_id;

  -- 2. listing_photos-Rows löschen, deren URL nicht mehr im neuen Array ist
  delete from listing_photos
  where listing_id = p_listing_id
    and (p_media is null or not (url = any(p_media)));

  -- 3. Neue URLs in listing_photos einfügen (preserves alte room_type wenn URL bleibt)
  if p_media is not null and array_length(p_media, 1) > 0 then
    insert into listing_photos (listing_id, url, position)
    select p_listing_id, t.url, (t.idx - 1)::int
    from unnest(p_media) with ordinality as t(url, idx)
    where not exists (
      select 1 from listing_photos lp
      where lp.listing_id = p_listing_id and lp.url = t.url
    );

    -- 4. Position aller überlebenden Rows auf neuen Array-Index setzen
    update listing_photos lp
    set position = (sub.new_pos - 1)::int
    from (
      select t.url, t.ord as new_pos
      from unnest(p_media) with ordinality as t(url, ord)
    ) sub
    where lp.listing_id = p_listing_id
      and lp.url = sub.url;
  end if;
end;
$$;

revoke all on function public.set_listing_media(uuid, text[]) from public;
grant execute on function public.set_listing_media(uuid, text[])
  to authenticated;
