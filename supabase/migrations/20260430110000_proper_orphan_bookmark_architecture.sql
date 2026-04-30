-- 20260430110000_proper_orphan_bookmark_architecture.sql
--
-- Re-Architektur: matches identifiziert sich über den Seeker (user_id /
-- anonymous_id) — search_profile_id ist nur noch optionaler Kontext.
--
-- Ablöse von 20260430100000 (auto-derived search_profiles): Auto-Profile
-- waren ein Pflaster, weil matches.search_profile_id nicht NULL sein
-- konnte. Jetzt sauber: orphan-Bookmarks werden zu orphan-Matches mit
-- NULL profile, ohne dass wir Fake-Profile erfinden müssen.
--
-- Voraussetzung: matches ist aktuell leer (0 Zeilen) — sonst wäre der
-- Backfill aus search_profile.user_id nötig. Migration ist trotzdem
-- defensiv geschrieben falls sich das ändert.

-- 1. Identitäts-Spalten direkt auf matches.
alter table matches
  add column if not exists seeker_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists seeker_anonymous_id text;

-- 2. Backfill aus search_profile.user_id / anonymous_id (für falls jemals
--    Daten vorhanden sind — aktuell leer, no-op).
update matches m
   set seeker_user_id = sp.user_id,
       seeker_anonymous_id = sp.anonymous_id
  from search_profiles sp
 where sp.id = m.search_profile_id
   and m.seeker_user_id is null
   and m.seeker_anonymous_id is null;

-- 3. Constraint: jeder Match braucht einen Seeker (user_id ODER anonymous_id).
alter table matches
  add constraint matches_has_seeker
  check (seeker_user_id is not null or seeker_anonymous_id is not null);

-- 4. matches.search_profile_id wird optional + ON DELETE SET NULL
alter table matches drop constraint matches_search_profile_id_fkey;
alter table matches alter column search_profile_id drop not null;
alter table matches
  add constraint matches_search_profile_id_fkey
  foreign key (search_profile_id) references search_profiles(id) on delete set null;

-- 5. Unique-Constraint auf (seeker, listing_id) statt (profile, listing_id).
--    Generated Column für stabile Komposit-Identität.
alter table matches drop constraint matches_search_profile_id_listing_id_key;
alter table matches
  add column if not exists seeker_key text
  generated always as (coalesce(seeker_user_id::text, seeker_anonymous_id, '')) stored;
create unique index if not exists matches_seeker_listing_uniq
  on matches (seeker_key, listing_id);
create index if not exists matches_seeker_user_idx on matches (seeker_user_id);

-- 6. RLS-Policy: nicht mehr über search_profile join, sondern direkt
--    über seeker_user_id. Anonyme Sichtbarkeit muss über RPC laufen
--    (kein anonymer auth.uid() vorhanden).
drop policy if exists matches_seeker_read on matches;
create policy matches_seeker_read on matches
  for select using (seeker_user_id is not null and seeker_user_id = auth.uid());

-- 7. seeker_request_match: profile_id ist optional, seeker-Spalten werden
--    immer gesetzt, Conflict-Auflösung auf seeker_key.
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
  v_seeker_user_id uuid;
  v_seeker_anonymous_id text;
begin
  if p_listing_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_listing_id');
  end if;

  v_seeker_user_id := v_user_id;
  v_seeker_anonymous_id := case when v_user_id is null then p_anonymous_id else null end;
  if v_seeker_user_id is null and v_seeker_anonymous_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_seeker_identity');
  end if;

  -- Profil ist optional Metadata. Wenn explizit übergeben → validieren.
  -- Wenn weggelassen → NULL, kein "no_active_profile"-Fehler mehr.
  if p_search_profile_id is not null then
    select * into v_profile from search_profiles
      where id = p_search_profile_id
        and (
          (v_seeker_user_id is not null and user_id = v_seeker_user_id)
          or (v_seeker_anonymous_id is not null and anonymous_id = v_seeker_anonymous_id)
        );
    if v_profile is null then
      return jsonb_build_object('ok', false, 'error', 'profile_not_owned');
    end if;
  end if;

  select * into v_listing from listings where id = p_listing_id;
  if v_listing is null then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  -- Upsert auf (seeker, listing). Wenn schon ein Match existiert →
  -- seeker_interest refreshen, profile-Anker beibehalten falls alter Match
  -- bereits einen hatte (v_profile.id ist möglicherweise NULL).
  insert into matches (
    search_profile_id, listing_id, seeker_interest, seeker_decided_at,
    seeker_user_id, seeker_anonymous_id
  )
  values (
    v_profile.id, p_listing_id, true, now(),
    v_seeker_user_id, v_seeker_anonymous_id
  )
  on conflict (seeker_key, listing_id)
    do update set
      seeker_interest = true,
      seeker_decided_at = now(),
      search_profile_id = coalesce(excluded.search_profile_id, matches.search_profile_id)
  returning id into v_match_id;

  update matches
     set connected_at = coalesce(connected_at, now())
   where id = v_match_id and owner_interest = true;

  return jsonb_build_object('ok', true, 'match_id', v_match_id);
end;
$$;

-- 8. inquire_from_bookmark: keine Auto-Derive mehr, NULL profile ist OK.
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

  v_result := public.seeker_request_match(
    p_anonymous_id := null,
    p_listing_id := v_bookmark.listing_id,
    p_search_profile_id := v_bookmark.search_profile_id  -- darf NULL sein
  );
  return v_result;
end;
$$;

-- 9. toggle_listing_bookmark: zurück zur ursprünglichen Form, kein
--    auto-derive mehr — orphan-Bookmarks sind jetzt valide.
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

-- 10. Cleanup: Helper, Spalte, Auto-Profile.
drop function if exists private.ensure_bookmark_search_profile(uuid);

-- Auto-Profile löschen — bookmark.search_profile_id wird via SET NULL frei.
delete from search_profiles where auto_created = true;

alter table search_profiles drop column if exists auto_created;
