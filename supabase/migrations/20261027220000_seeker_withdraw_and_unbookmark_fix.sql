-- 1. seeker_withdraw_match: Eigentümer-Check über matches.seeker_user_id /
--    seeker_anonymous_id statt Inner Join auf search_profiles.
--
--    Seit 20260430110000 ist matches.search_profile_id optional (ON DELETE
--    SET NULL, Anfragen aus Favoriten ohne Suchprofil). Der alte Inner Join
--    fand solche Matches nicht → 'match_not_found', obwohl sie in der Outbox
--    (match_seeker_outbox) und auf /matches/[id] angezeigt wurden. Folge:
--    "Anfrage zurückziehen" ging bei diesen Anfragen nie.
--    search_profiles bleibt als Fallback für Alt-Matches ohne seeker_*-Spalten.
create or replace function public.seeker_withdraw_match(
  p_match_id uuid,
  p_anonymous_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_seeker_uid uuid;
  v_seeker_anon text;
  v_sp_uid uuid;
  v_sp_anon text;
begin
  if p_match_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_match_id');
  end if;

  select m.seeker_user_id, m.seeker_anonymous_id, sp.user_id, sp.anonymous_id
    into v_seeker_uid, v_seeker_anon, v_sp_uid, v_sp_anon
    from matches m
    left join search_profiles sp on sp.id = m.search_profile_id
   where m.id = p_match_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'match_not_found');
  end if;

  if v_user_id is not null
     and (v_seeker_uid = v_user_id or v_sp_uid = v_user_id) then
    -- ok
  elsif p_anonymous_id is not null and p_anonymous_id <> ''
     and (v_seeker_anon = p_anonymous_id or v_sp_anon = p_anonymous_id) then
    -- ok
  else
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from matches where id = p_match_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 2. toggle_listing_bookmark: Entfernen auch bei nicht-aktiven Inseraten.
--
--    Der Aktiv-Check lief vor dem Toggle, also auch beim Entfernen. Auf der
--    Detailseite eines stale/rented/reserved Inserats zeigte das Herz
--    "gespeichert", ein Klick lieferte aber 'listing_not_found' und der
--    Favorit blieb. Neu speichern geht weiterhin nur bei aktiven Inseraten.
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

  if v_user_id is not null then
    select id into v_existing from listing_bookmarks
    where user_id = v_user_id and listing_id = p_listing_id;
  else
    select id into v_existing from listing_bookmarks
    where anonymous_id = p_anonymous_id and listing_id = p_listing_id;
  end if;

  if v_existing is not null then
    delete from listing_bookmarks where id = v_existing;
    return jsonb_build_object('ok', true, 'saved', false);
  end if;

  if not exists (select 1 from listings where id = p_listing_id and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  if v_user_id is not null then
    insert into listing_bookmarks (listing_id, user_id, source_context, search_profile_id)
    values (p_listing_id, v_user_id, p_source, p_search_profile_id);
  else
    insert into listing_bookmarks (listing_id, anonymous_id, source_context, search_profile_id)
    values (p_listing_id, p_anonymous_id, p_source, p_search_profile_id);
  end if;
  return jsonb_build_object('ok', true, 'saved', true);
end;
$$;
