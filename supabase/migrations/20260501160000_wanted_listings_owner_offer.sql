-- 20260501160000_wanted_listings_owner_offer.sql
--
-- Feature: „Such-Inserat" / Wanted-Listing.
--
-- Suchende, die ihr search_profile als published_as_wanted=true freigeben,
-- erscheinen auf der öffentlichen /gesuche-Liste. Eigentümer können dort eines
-- ihrer Listings explizit anbieten — das erstellt einen Match mit
-- owner_interest=true, seeker_interest=NULL (pending). Sucher antwortet im
-- bestehenden Matches-Inbox-Flow (match_messages).
--
-- Anti-Spam:
--   - Owner muss min. 1 eigenes Listing haben (sonst kein Anbieter-Status).
--   - Rate-Limit: max. 5 Owner-Offers in den letzten 24h pro Owner.
--
-- Privacy:
--   - Email-Adressen bleiben unsichtbar — Match-Inbox ist die einzige Brücke.
--   - Public-Liste zeigt nur strukturelle Felder + free_text (vom Sucher
--     bewusst freigeschaltet via Toggle). Keine user_id, kein Display-Name.
--   - Service-Role-Reads aus dem Next-Server beschränken sich auf safe-Felder.

alter table public.search_profiles
  add column if not exists published_as_wanted boolean not null default false,
  add column if not exists wanted_published_at timestamptz;

-- Trigger: wanted_published_at automatisch setzen wenn Toggle auf true geht.
-- Hilft beim Sortieren („neueste Gesuche zuerst") und beim späteren Aufräumen
-- abgelaufener Profile (z.B. > 90 Tage alt → auto-unpublish).
create or replace function public._touch_wanted_published_at()
returns trigger language plpgsql as $$
begin
  if new.published_as_wanted is true and (old.published_as_wanted is distinct from true) then
    new.wanted_published_at := now();
  elsif new.published_as_wanted is false then
    new.wanted_published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists _touch_wanted_published_at on public.search_profiles;
create trigger _touch_wanted_published_at
  before update on public.search_profiles
  for each row execute function public._touch_wanted_published_at();

create index if not exists idx_search_profiles_wanted_published
  on public.search_profiles (wanted_published_at desc)
  where published_as_wanted = true and active = true;


-- RPC: Eigentümer bietet eines seiner Listings auf ein veröffentlichtes
-- Such-Profil an. Erstellt einen Match mit owner_interest=true, der Sucher
-- sieht das in seinem bestehenden Matches-Inbox.
--
-- Returns:
--   {ok: true,  match_id: uuid, connected: bool}     bei Erfolg
--   {ok: false, error: '<code>', detail?: '<msg>'}   bei Validation-Fail
--
-- Error-Codes:
--   not_authenticated   — auth.uid() ist null
--   listing_not_owned   — listing gehört nicht dem caller
--   profile_not_public  — search_profile ist nicht published_as_wanted=true
--   profile_not_active  — search_profile.active = false
--   rate_limited        — > 5 Offers in den letzten 24h durch diesen Owner
create or replace function public.owner_offer_to_seeker(
  p_listing_id uuid,
  p_search_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_listing listings%rowtype;
  v_profile search_profiles%rowtype;
  v_recent_offers int;
  v_match_id uuid;
  v_connected boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_listing from listings where id = p_listing_id;
  if v_listing is null or v_listing.owner_user_id is distinct from v_user_id then
    return jsonb_build_object('ok', false, 'error', 'listing_not_owned');
  end if;

  select * into v_profile from search_profiles where id = p_search_profile_id;
  if v_profile is null or v_profile.published_as_wanted is not true then
    return jsonb_build_object('ok', false, 'error', 'profile_not_public');
  end if;
  if v_profile.active is not true then
    return jsonb_build_object('ok', false, 'error', 'profile_not_active');
  end if;

  -- Rate-Limit: max 5 Offers / 24h durch diesen Owner. Zählt nur Offers an
  -- öffentliche Profile (= aus der /gesuche-Liste), nicht die owner_respond_
  -- match-Akzeptanzen für eingehende seeker-Anfragen.
  select count(*) into v_recent_offers
    from matches m
    join listings l on l.id = m.listing_id
   where l.owner_user_id = v_user_id
     and m.owner_interest = true
     and m.owner_decided_at > now() - interval '24 hours'
     and m.search_profile_id is not null
     and exists (
       select 1 from search_profiles sp
        where sp.id = m.search_profile_id
          and sp.published_as_wanted = true
     );
  if v_recent_offers >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited',
      'detail', 'Max 5 Anbieter-Anfragen pro Tag');
  end if;

  insert into matches (
    listing_id, search_profile_id,
    owner_interest, owner_decided_at,
    seeker_user_id, seeker_anonymous_id
  )
  values (
    p_listing_id, p_search_profile_id,
    true, now(),
    v_profile.user_id, v_profile.anonymous_id
  )
  on conflict (seeker_key, listing_id)
    do update set
      owner_interest = true,
      owner_decided_at = now(),
      search_profile_id = coalesce(excluded.search_profile_id, matches.search_profile_id)
  returning id into v_match_id;

  -- Wenn Sucher schon vorher Interesse bekundet hatte (z.B. via /listings/[id]),
  -- ist das jetzt ein Connection.
  update matches
     set connected_at = coalesce(connected_at, now())
   where id = v_match_id and seeker_interest = true
   returning true into v_connected;

  return jsonb_build_object(
    'ok', true,
    'match_id', v_match_id,
    'connected', coalesce(v_connected, false)
  );
end;
$function$;

grant execute on function public.owner_offer_to_seeker(uuid, uuid) to authenticated;


-- RPC: öffentliche Wanted-Liste mit anonymisierten Feldern. Verwendet vom
-- Next-Server-Component für /gesuche. Service-Role kann die Tabelle direkt
-- lesen, aber dieser RPC garantiert Spalten-Whitelist (keine versehentliche
-- Email-Exposure beim Schema-Refactor in 6 Monaten).
create or replace function public.list_wanted_profiles(
  p_limit int default 50,
  p_offset int default 0,
  p_type listing_type default null,
  p_city text default null
)
returns table (
  id uuid,
  type listing_type,
  property_type text,
  location text,
  budget_min numeric,
  budget_max numeric,
  currency char(3),
  rooms smallint,
  rooms_strict boolean,
  household text,
  lifestyle_tags text[],
  pets boolean,
  free_text text,
  move_in_date date,
  wanted_published_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    sp.id, sp.type, sp.property_type, sp.location,
    sp.budget_min, sp.budget_max, sp.currency,
    sp.rooms, sp.rooms_strict,
    sp.household, sp.lifestyle_tags, sp.pets,
    sp.free_text, sp.move_in_date, sp.wanted_published_at
  from public.search_profiles sp
  where sp.published_as_wanted = true
    and sp.active = true
    and (p_type is null or sp.type = p_type)
    and (p_city is null or sp.location ilike '%' || p_city || '%')
  order by sp.wanted_published_at desc nulls last
  limit greatest(1, least(p_limit, 200))
  offset greatest(0, p_offset);
$function$;

grant execute on function public.list_wanted_profiles(int, int, listing_type, text) to anon, authenticated;


-- RPC: ein einzelnes Wanted-Profil (für /gesuche/[id]). Gleiche Spalten-
-- Whitelist wie list_wanted_profiles, plus owner-listings-Picker-Hilfe:
-- der Aufrufer (Owner) kriegt ein eligible_listings-Array zurück, aus dem
-- er sein Angebot wählen kann. Eligible = caller-owned + active + Type passt.
create or replace function public.get_wanted_profile(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_profile jsonb;
  v_eligible jsonb;
begin
  select to_jsonb(t) into v_profile
    from (
      select
        sp.id, sp.type, sp.property_type, sp.location,
        sp.budget_min, sp.budget_max, sp.currency,
        sp.rooms, sp.rooms_strict,
        sp.household, sp.lifestyle_tags, sp.pets,
        sp.free_text, sp.move_in_date, sp.wanted_published_at
      from public.search_profiles sp
      where sp.id = p_id
        and sp.published_as_wanted = true
        and sp.active = true
    ) t;
  if v_profile is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Owner-Picker: nur wenn eingeloggt + eigene Listings vorhanden
  if v_user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'title', l.title,
      'location_city', l.location_city,
      'location_district', l.location_district,
      'price', l.price,
      'currency', l.currency,
      'rooms', l.rooms,
      'size_sqm', l.size_sqm,
      'property_type', l.property_type,
      'media', l.media,
      'cover_url', case when array_length(l.media, 1) > 0 then l.media[1] else null end
    ) order by l.created_at desc), '[]'::jsonb) into v_eligible
      from listings l
     where l.owner_user_id = v_user_id
       and l.status = 'active'
       and l.type = (v_profile->>'type')::listing_type;
  else
    v_eligible := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile', v_profile,
    'eligible_listings', v_eligible
  );
end;
$function$;

grant execute on function public.get_wanted_profile(uuid) to anon, authenticated;
