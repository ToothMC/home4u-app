-- Double-Opt-in Match-Flow
-- RPCs für Seeker-Request, Owner-Response, Inbox + Outbox.
-- Alle SECURITY DEFINER, mit strengen Auth-Checks im Body.

-- Seeker bekundet Interesse an einem Listing.
-- Erlaubt sowohl eingeloggte (user_id) als auch anonyme (anonymous_id) Seekers.
create or replace function public.seeker_request_match(
  p_anonymous_id text default null,
  p_listing_id uuid default null
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

  -- aktives Profil finden (user_id oder anonymous_id)
  if v_user_id is not null then
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

  -- Upsert in matches
  insert into matches (search_profile_id, listing_id, seeker_interest, seeker_decided_at)
  values (v_profile.id, p_listing_id, true, now())
  on conflict (search_profile_id, listing_id)
    do update set seeker_interest = true, seeker_decided_at = now()
  returning id into v_match_id;

  -- Wenn Owner schon zugestimmt hat: connected_at setzen
  update matches
     set connected_at = coalesce(connected_at, now())
   where id = v_match_id and owner_interest = true;

  return jsonb_build_object('ok', true, 'match_id', v_match_id);
end;
$$;

revoke all on function public.seeker_request_match(text, uuid) from public;
grant execute on function public.seeker_request_match(text, uuid) to anon, authenticated;

-- Owner antwortet auf eine Match-Anfrage (annehmen oder ablehnen).
create or replace function public.owner_respond_match(
  p_match_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_match matches%rowtype;
  v_listing_owner uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_match from matches where id = p_match_id;
  if v_match is null then
    return jsonb_build_object('ok', false, 'error', 'match_not_found');
  end if;

  select owner_user_id into v_listing_owner from listings where id = v_match.listing_id;
  if v_listing_owner is distinct from v_user_id then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update matches
     set owner_interest = p_accept,
         owner_decided_at = now(),
         connected_at = case
           when p_accept and seeker_interest then coalesce(connected_at, now())
           else null
         end
   where id = p_match_id;

  return jsonb_build_object(
    'ok', true,
    'accepted', p_accept,
    'connected', p_accept and v_match.seeker_interest
  );
end;
$$;

revoke all on function public.owner_respond_match(uuid, boolean) from public;
grant execute on function public.owner_respond_match(uuid, boolean) to authenticated;

-- Inbox-Query für Owner: Matches für ihre eigenen Listings, noch offen oder neu.
create or replace function public.match_owner_inbox()
returns table (
  match_id uuid,
  listing_id uuid,
  listing_city text,
  listing_district text,
  listing_price numeric,
  listing_rooms smallint,
  score real,
  seeker_interest boolean,
  seeker_decided_at timestamptz,
  owner_interest boolean,
  owner_decided_at timestamptz,
  connected_at timestamptz,
  seeker_profile jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return;
  end if;

  return query
  select
    m.id,
    l.id,
    l.location_city,
    l.location_district,
    l.price,
    l.rooms,
    m.score,
    m.seeker_interest,
    m.seeker_decided_at,
    m.owner_interest,
    m.owner_decided_at,
    m.connected_at,
    jsonb_build_object(
      'location', sp.location,
      'budget_max', sp.budget_max,
      'rooms', sp.rooms,
      'household', sp.household,
      'move_in_date', sp.move_in_date,
      'lifestyle_tags', sp.lifestyle_tags,
      -- Kontakt-E-Mail nur wenn connected, sonst null
      'email',
        case when m.connected_at is not null and sp.user_id is not null
          then (select email from auth.users u where u.id = sp.user_id)
          else null
        end
    )
  from matches m
  join listings l on l.id = m.listing_id
  join search_profiles sp on sp.id = m.search_profile_id
  where l.owner_user_id = v_user_id
    and m.seeker_interest = true
  order by m.seeker_decided_at desc;
end;
$$;

revoke all on function public.match_owner_inbox() from public;
grant execute on function public.match_owner_inbox() to authenticated;

-- Outbox-Query für Seeker: eigene Match-Anfragen und deren Status.
create or replace function public.match_seeker_outbox(
  p_anonymous_id text default null
)
returns table (
  match_id uuid,
  listing_id uuid,
  listing_city text,
  listing_district text,
  listing_price numeric,
  listing_rooms smallint,
  listing_size_sqm smallint,
  listing_contact_channel text,
  listing_media text[],
  score real,
  seeker_interest boolean,
  owner_interest boolean,
  connected_at timestamptz,
  owner_contact jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  return query
  select
    m.id,
    l.id,
    l.location_city,
    l.location_district,
    l.price,
    l.rooms,
    l.size_sqm,
    l.contact_channel,
    l.media,
    m.score,
    m.seeker_interest,
    m.owner_interest,
    m.connected_at,
    -- Kontakt nur wenn connected
    case when m.connected_at is not null then
      jsonb_build_object(
        'channel', l.contact_channel,
        'phone', case when l.contact_phone_enc is not null then '***' else null end,
        'email',
          (select email from auth.users u where u.id = l.owner_user_id)
      )
      else null
    end as owner_contact
  from matches m
  join listings l on l.id = m.listing_id
  join search_profiles sp on sp.id = m.search_profile_id
  where m.seeker_interest = true
    and (
      (v_user_id is not null and sp.user_id = v_user_id)
      or (p_anonymous_id is not null and sp.anonymous_id = p_anonymous_id)
    )
  order by m.seeker_decided_at desc;
end;
$$;

revoke all on function public.match_seeker_outbox(text) from public;
grant execute on function public.match_seeker_outbox(text) to anon, authenticated;
