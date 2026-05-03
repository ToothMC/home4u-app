-- Atomares Foto-Entfernen + harte set_listing_media-Sperre.
--
-- Hintergrund: removeMedia im Editor hat über setMedia-Callback die outer
-- next-Variable assigned, die bei React-18-Async-Setter aber [] blieb →
-- der Code sendete dann set_listing_media(id, [], allow_empty:true) und
-- LÖSCHTE ALLE BILDER. Das ist mehrfach in Prod passiert.
--
-- Lösung:
-- 1. set_listing_media verweigert leeres Array kategorisch (auch
--    p_allow_empty=true bringt nichts mehr — der Bypass ist tot).
-- 2. Neue remove_listing_photo(id, url): atomares Single-Foto-Remove via
--    array_remove + listing_photos DELETE. Caller schickt konkrete URL,
--    DB rechnet Liste selbst aus. Kein outer-Variable-Bug möglich.
-- 3. Neue clear_listing_media(id, confirm): explizites Komplett-Clearing
--    mit confirm-String als Schutz. Aktuell von keinem Caller verwendet.

create or replace function public.set_listing_media(
  p_listing_id uuid,
  p_media text[],
  p_allow_empty boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_caller uuid := auth.uid();
  v_existing_count int;
  v_new_count int;
begin
  select owner_user_id into v_owner from listings where id = p_listing_id;
  if v_owner is null then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_caller is null or v_caller != v_owner then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  v_new_count := coalesce(array_length(p_media, 1), 0);
  select coalesce(array_length(media, 1), 0) into v_existing_count
  from listings where id = p_listing_id;

  -- Hartes Verbot: leeres Array NIEMALS akzeptieren wenn aktuell Bilder
  -- vorhanden sind. p_allow_empty bleibt aus Kompatibilität als Parameter,
  -- ist aber wirkungslos (Caller hatten falsche Werte gesetzt).
  if v_new_count = 0 and v_existing_count > 0 then
    raise exception 'set_listing_media_must_be_nonempty (existing=%, use remove_listing_photo or clear_listing_media)', v_existing_count
      using errcode = 'P0001';
  end if;

  update listings
  set media = coalesce(p_media, '{}'::text[]),
      updated_at = now()
  where id = p_listing_id;

  delete from listing_photos
  where listing_id = p_listing_id
    and (p_media is null or not (url = any(p_media)));

  if p_media is not null and array_length(p_media, 1) > 0 then
    insert into listing_photos (listing_id, url, position)
    select p_listing_id, t.url, (t.idx - 1)::int
    from unnest(p_media) with ordinality as t(url, idx)
    where not exists (
      select 1 from listing_photos lp
      where lp.listing_id = p_listing_id and lp.url = t.url
    );

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

revoke all on function public.set_listing_media(uuid, text[], boolean) from public;
grant execute on function public.set_listing_media(uuid, text[], boolean) to authenticated;

-- Atomares Single-Foto-Remove. Sicher gegen Async-Setter-Bugs: Caller
-- übergibt URL, DB nutzt array_remove → keine outer-Variable involviert.
create or replace function public.remove_listing_photo(
  p_listing_id uuid,
  p_url text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_caller uuid := auth.uid();
  v_remaining int;
begin
  select owner_user_id into v_owner from listings where id = p_listing_id;
  if v_owner is null then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_caller is null or v_caller != v_owner then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update listings
  set media = array_remove(media, p_url),
      updated_at = now()
  where id = p_listing_id;

  delete from listing_photos
  where listing_id = p_listing_id and url = p_url;

  select coalesce(array_length(media, 1), 0) into v_remaining
  from listings where id = p_listing_id;

  return v_remaining;
end;
$$;

revoke all on function public.remove_listing_photo(uuid, text) from public;
grant execute on function public.remove_listing_photo(uuid, text) to authenticated;

-- Explizites Komplett-Clearing. Verlangt Bestätigungs-String als Schutz
-- gegen versehentliche Calls. Listing-Owner only.
create or replace function public.clear_listing_media(
  p_listing_id uuid,
  p_confirm text
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
  if p_confirm != 'YES_DELETE_ALL_PHOTOS' then
    raise exception 'confirmation_required' using errcode = 'P0001';
  end if;

  select owner_user_id into v_owner from listings where id = p_listing_id;
  if v_owner is null then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_caller is null or v_caller != v_owner then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update listings set media = '{}'::text[], updated_at = now() where id = p_listing_id;
  delete from listing_photos where listing_id = p_listing_id;
end;
$$;

revoke all on function public.clear_listing_media(uuid, text) from public;
grant execute on function public.clear_listing_media(uuid, text) to authenticated;

-- update_listing_photo_room_type: jetzt UPSERT. Wenn die URL noch nicht
-- in listing_photos ist (frisch hochgeladen, noch nicht analysiert),
-- legen wir die Zeile an. Vorher war es ein silent no-op → User dachte
-- "gespeichert", aber der Wert war weg.
create or replace function public.update_listing_photo_room_type(
  p_listing_id uuid,
  p_url text,
  p_room_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_caller uuid := auth.uid();
  v_position int;
begin
  select owner_user_id into v_owner from listings where id = p_listing_id;
  if v_owner is null then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_caller is null or v_caller != v_owner then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Position aus media[]-Array herleiten (1-basiert in unnest, wir wollen 0-basiert)
  select (idx - 1)::int into v_position
  from listings l, unnest(l.media) with ordinality as t(url, idx)
  where l.id = p_listing_id and t.url = p_url
  limit 1;

  insert into listing_photos (listing_id, url, room_type, position)
  values (
    p_listing_id,
    p_url,
    nullif(trim(p_room_type), ''),
    coalesce(v_position, 0)
  )
  on conflict (listing_id, url)
  do update set room_type = nullif(trim(excluded.room_type), '');
end;
$$;

revoke all on function public.update_listing_photo_room_type(uuid, text, text) from public;
grant execute on function public.update_listing_photo_room_type(uuid, text, text) to authenticated;
