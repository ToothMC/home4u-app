-- Listing-Pipeline (CRM-Style): Swipe-Right legt jetzt nur noch ein Bookmark an,
-- nicht direkt einen Match. Anfragen entstehen erst per bewusstem Klick aus den
-- Favoriten heraus. Damit der Anfrage-Klick weiß, aus welcher Suche der User kam,
-- merken wir die search_profile_id beim Bookmarken.

-- 1) Spalte: aus welcher Suche stammt der Bookmark?
alter table listing_bookmarks
  add column if not exists search_profile_id uuid null
    references search_profiles(id) on delete set null;

create index if not exists listing_bookmarks_search_profile_idx
  on listing_bookmarks(search_profile_id) where search_profile_id is not null;

-- 2) toggle_listing_bookmark: optionaler p_search_profile_id Param.
--    Beim INSERT wird er mitgeschrieben; bei Toggle-Off ignoriert.
create or replace function public.toggle_listing_bookmark(
  p_listing_id uuid,
  p_anonymous_id text default null,
  p_source text default null,
  p_search_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing uuid;
begin
  if v_user_id is null and (p_anonymous_id is null or p_anonymous_id = '') then
    return jsonb_build_object('ok', false, 'error', 'no_owner');
  end if;
  if not exists (select 1 from listings where id = p_listing_id and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  if v_user_id is not null then
    select id into v_existing from listing_bookmarks
    where user_id = v_user_id and listing_id = p_listing_id;
    if v_existing is not null then
      delete from listing_bookmarks where id = v_existing;
      return jsonb_build_object('ok', true, 'saved', false);
    end if;
    insert into listing_bookmarks (listing_id, user_id, source_context, search_profile_id)
    values (p_listing_id, v_user_id, p_source, p_search_profile_id);
    return jsonb_build_object('ok', true, 'saved', true);
  else
    select id into v_existing from listing_bookmarks
    where anonymous_id = p_anonymous_id and listing_id = p_listing_id;
    if v_existing is not null then
      delete from listing_bookmarks where id = v_existing;
      return jsonb_build_object('ok', true, 'saved', false);
    end if;
    insert into listing_bookmarks (listing_id, anonymous_id, source_context, search_profile_id)
    values (p_listing_id, p_anonymous_id, p_source, p_search_profile_id);
    return jsonb_build_object('ok', true, 'saved', true);
  end if;
end;
$$;

-- Alte Signatur zurückziehen (positional Aufrufe würden sonst auf die alte zeigen).
revoke all on function public.toggle_listing_bookmark(uuid, text, text) from public, anon, authenticated, service_role;
drop function if exists public.toggle_listing_bookmark(uuid, text, text);

revoke all on function public.toggle_listing_bookmark(uuid, text, text, uuid) from public;
grant execute on function public.toggle_listing_bookmark(uuid, text, text, uuid)
  to authenticated, anon, service_role;

-- 3) seeker_request_match: optionaler p_search_profile_id Param. Wenn übergeben,
--    wird dieses Profil genutzt statt automatisch das aktivste zu wählen. So kann
--    der Inquire-aus-Bookmark-Pfad gezielt das richtige Profil ansprechen, auch
--    wenn der User mehrere aktive Suchen hat.
create or replace function public.seeker_request_match(
  p_anonymous_id text default null,
  p_listing_id uuid default null,
  p_search_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile search_profiles%rowtype;
  v_listing listings%rowtype;
  v_match_id uuid;
begin
  if p_listing_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_listing_id');
  end if;

  -- Profil bestimmen: explizit übergebenes hat Vorrang, sonst aktivstes auto-pick.
  if p_search_profile_id is not null then
    select * into v_profile from search_profiles
      where id = p_search_profile_id
        and (
          (v_user_id is not null and user_id = v_user_id)
          or (p_anonymous_id is not null and anonymous_id = p_anonymous_id)
        );
  elsif v_user_id is not null then
    select * into v_profile from search_profiles
      where user_id = v_user_id and active = true
      order by updated_at desc limit 1;
  elsif p_anonymous_id is not null then
    select * into v_profile from search_profiles
      where anonymous_id = p_anonymous_id and active = true
      order by updated_at desc limit 1;
  end if;

  if v_profile is null then
    return jsonb_build_object('ok', false, 'error', 'no_active_profile');
  end if;

  select * into v_listing from listings where id = p_listing_id;
  if v_listing is null then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  insert into matches (search_profile_id, listing_id, seeker_interest, seeker_decided_at)
  values (v_profile.id, p_listing_id, true, now())
  on conflict (search_profile_id, listing_id)
    do update set seeker_interest = true, seeker_decided_at = now()
  returning id into v_match_id;

  update matches
     set connected_at = coalesce(connected_at, now())
   where id = v_match_id and owner_interest = true;

  return jsonb_build_object('ok', true, 'match_id', v_match_id);
end;
$$;

revoke all on function public.seeker_request_match(text, uuid) from public, anon, authenticated, service_role;
drop function if exists public.seeker_request_match(text, uuid);

revoke all on function public.seeker_request_match(text, uuid, uuid) from public;
grant execute on function public.seeker_request_match(text, uuid, uuid) to anon, authenticated;

-- 4) inquire_from_bookmark: nimmt einen Bookmark, ruft intern die Match-Logik
--    mit der gespeicherten search_profile_id auf. Idempotent. Auth-only.
create or replace function public.inquire_from_bookmark(
  p_bookmark_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_bookmark listing_bookmarks%rowtype;
  v_result jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_bookmark from listing_bookmarks
    where id = p_bookmark_id and user_id = v_user_id;
  if v_bookmark is null then
    return jsonb_build_object('ok', false, 'error', 'bookmark_not_found');
  end if;

  if v_bookmark.search_profile_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_search_profile');
  end if;

  v_result := public.seeker_request_match(
    p_anonymous_id := null,
    p_listing_id := v_bookmark.listing_id,
    p_search_profile_id := v_bookmark.search_profile_id
  );
  return v_result;
end;
$$;

revoke all on function public.inquire_from_bookmark(uuid) from public;
grant execute on function public.inquire_from_bookmark(uuid) to authenticated;
