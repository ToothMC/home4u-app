-- 20260430100000_auto_link_bookmark_search_profile.sql
--
-- Regel: Jeder Favorit muss eine search_profile-Verknüpfung haben, damit
-- inquire_from_bookmark funktioniert. Bisher konnte der Bookmark-Save
-- ohne Suche entstehen → orphan, "Bitte aus Suche speichern"-Disabled-State.
--
-- Lösung: Wenn beim Bookmark-Save kein p_search_profile_id mitkommt,
-- legen wir on-the-fly ein "auto"-Profil aus den Listing-Parametern an
-- (active=false, auto_created=true). Diese Auto-Profile:
--   • zählen NICHT zum 3-Suchen-Limit (nur active=true zählt)
--   • erscheinen NICHT im Dashboard "Meine Suchen" (nur active=true)
--   • match_listings_for_profile pickt eh nur active=true → kein Konflikt
--   • aber: liefern dem Anbieter im Inquire-Flow vollen Kontext

-- 1. Spalte für Markierung
alter table search_profiles
  add column if not exists auto_created boolean not null default false;

-- 2. Helper: derive + insert + link für eine bookmark-id
create or replace function private.ensure_bookmark_search_profile(
  p_bookmark_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bookmark listing_bookmarks%rowtype;
  v_listing listings%rowtype;
  v_new_profile_id uuid;
  v_owner_user_id uuid;
  v_owner_anonymous_id text;
  v_budget_max numeric;
  v_budget_min numeric;
begin
  select * into v_bookmark from listing_bookmarks where id = p_bookmark_id;
  if v_bookmark is null then
    return null;
  end if;
  if v_bookmark.search_profile_id is not null then
    return v_bookmark.search_profile_id;
  end if;

  select * into v_listing from listings where id = v_bookmark.listing_id;
  if v_listing is null then
    return null;
  end if;

  v_owner_user_id := v_bookmark.user_id;
  v_owner_anonymous_id := v_bookmark.anonymous_id;

  -- Budget-Range: ±20% vom Listing-Preis. Sale-Listings sind absolut groß,
  -- deswegen für Sale-Range engern: ±15%.
  if v_listing.type = 'sale' then
    v_budget_max := round(v_listing.price * 1.15);
    v_budget_min := round(v_listing.price * 0.85);
  else
    v_budget_max := round(v_listing.price * 1.20);
    v_budget_min := round(v_listing.price * 0.80);
  end if;

  insert into search_profiles (
    user_id, anonymous_id,
    location, type, property_type,
    budget_min, budget_max,
    rooms,
    active, auto_created
  )
  values (
    v_owner_user_id, v_owner_anonymous_id,
    coalesce(v_listing.location_district || ', ' || v_listing.location_city, v_listing.location_city),
    v_listing.type,
    v_listing.property_type,
    v_budget_min, v_budget_max,
    v_listing.rooms,
    false,  -- nicht aktiv → kein Match-Pipeline-Side-Effect, nicht im Dashboard
    true
  )
  returning id into v_new_profile_id;

  update listing_bookmarks
    set search_profile_id = v_new_profile_id
    where id = p_bookmark_id;

  return v_new_profile_id;
end;
$$;

revoke all on function private.ensure_bookmark_search_profile(uuid) from public, anon, authenticated;

-- 3. inquire_from_bookmark — Fehler `no_search_profile` entfernen, statt
--    dessen on-the-fly auto-derive
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
  v_search_profile_id uuid;
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

  v_search_profile_id := v_bookmark.search_profile_id;
  if v_search_profile_id is null then
    -- Auto-derive aus Listing-Parametern → Anbieter kriegt sinnvollen Kontext.
    v_search_profile_id := private.ensure_bookmark_search_profile(p_bookmark_id);
    if v_search_profile_id is null then
      return jsonb_build_object('ok', false, 'error', 'auto_profile_failed');
    end if;
  end if;

  v_result := public.seeker_request_match(
    p_anonymous_id := null,
    p_listing_id := v_bookmark.listing_id,
    p_search_profile_id := v_search_profile_id
  );
  return v_result;
end;
$$;

-- 4. toggle_listing_bookmark — nach INSERT auto-derive aufrufen wenn
--    kein p_search_profile_id vom Client kam.
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
  v_new_bookmark_id uuid;
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
    values (p_listing_id, v_user_id, p_source, p_search_profile_id)
    returning id into v_new_bookmark_id;
    -- Wenn Client kein search_profile_id mitschickte → auto-derive damit
    -- der "Anfragen"-Button später nicht disabled erscheint.
    if p_search_profile_id is null then
      perform private.ensure_bookmark_search_profile(v_new_bookmark_id);
    end if;
    return jsonb_build_object('ok', true, 'saved', true);
  else
    select id into v_existing from listing_bookmarks
    where anonymous_id = p_anonymous_id and listing_id = p_listing_id;
    if v_existing is not null then
      delete from listing_bookmarks where id = v_existing;
      return jsonb_build_object('ok', true, 'saved', false);
    end if;
    insert into listing_bookmarks (listing_id, anonymous_id, source_context, search_profile_id)
    values (p_listing_id, p_anonymous_id, p_source, p_search_profile_id)
    returning id into v_new_bookmark_id;
    if p_search_profile_id is null then
      perform private.ensure_bookmark_search_profile(v_new_bookmark_id);
    end if;
    return jsonb_build_object('ok', true, 'saved', true);
  end if;
end;
$$;

-- 5. Backfill: für alle bestehenden orphan-Bookmarks ein auto-profile erzeugen
do $$
declare
  r record;
begin
  for r in select id from listing_bookmarks where search_profile_id is null loop
    perform private.ensure_bookmark_search_profile(r.id);
  end loop;
end;
$$;
