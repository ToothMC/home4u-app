-- Defense-in-depth: set_listing_media verweigert das Leerräumen bestehender
-- media[] ohne explizites p_allow_empty=true. Hintergrund: Editor- oder Card-
-- Pfade haben am 03.05.2026 ein vollständiges Listing-Foto-Set unbeabsichtigt
-- auf 0 Bilder reduziert (Quelle ungeklärt — Closure/Race-Verdacht). Dieser
-- Guard macht den Datenverlust unmöglich, egal welcher Caller buggy ist.
--
-- Caller, die wirklich alles entfernen wollen, müssen p_allow_empty=true
-- mitgeben (Editor-Trash auf letztes Bild → mit Confirm-Dialog).
--
-- Außerdem: Neue RPC update_listing_photo_room_type für die Edit-UI, damit
-- der Owner einzelnen Fotos manuell den Raumtyp zuordnen / korrigieren kann.

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

  -- Schutz: nicht versehentlich alles wegwerfen.
  if v_new_count = 0 and v_existing_count > 0 and p_allow_empty is not true then
    raise exception 'refusing_to_clear_media (existing=% , pass p_allow_empty=true to force)', v_existing_count
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
grant execute on function public.set_listing_media(uuid, text[], boolean)
  to authenticated;

-- Alte 2-arg-Signatur droppen, damit alle Aufrufer auf neue Signatur springen
-- (Default 0040: ohne p_allow_empty). Postgres erlaubt sonst beide Signaturen.
drop function if exists public.set_listing_media(uuid, text[]);

-- Neue RPC: einzelnes Foto in seinem room_type aktualisieren (manuelle
-- Korrektur durch Owner). null erlaubt, um eine fehlerhafte AI-Zuordnung
-- zurückzunehmen.
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
begin
  select owner_user_id into v_owner from listings where id = p_listing_id;
  if v_owner is null then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_caller is null or v_caller != v_owner then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update listing_photos
  set room_type = nullif(trim(p_room_type), '')
  where listing_id = p_listing_id and url = p_url;
end;
$$;

revoke all on function public.update_listing_photo_room_type(uuid, text, text) from public;
grant execute on function public.update_listing_photo_room_type(uuid, text, text)
  to authenticated;
