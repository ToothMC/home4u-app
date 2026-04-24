-- Fix: match_listings_for_profile muss nach Login auch über user_id lookupen.
-- Ersetzt die RPC aus 0004.

create or replace function public.match_listings_for_profile(
  p_anonymous_id text default null,
  p_user_id uuid default null,
  p_profile_id uuid default null,
  p_limit int default 5
)
returns table (
  listing_id uuid,
  source listing_source,
  type listing_type,
  location_city text,
  location_district text,
  price numeric,
  currency char(3),
  rooms smallint,
  size_sqm smallint,
  contact_channel text,
  score real
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_price_min numeric;
  v_price_max numeric;
begin
  if p_profile_id is not null then
    select * into v_profile from search_profiles where id = p_profile_id;
  elsif p_user_id is not null then
    select * into v_profile from search_profiles
    where user_id = p_user_id and active = true
    order by updated_at desc limit 1;
  elsif p_anonymous_id is not null then
    select * into v_profile from search_profiles
    where anonymous_id = p_anonymous_id and active = true
    order by updated_at desc limit 1;
  else
    return;
  end if;

  if v_profile is null then
    return;
  end if;

  v_price_min := coalesce(v_profile.budget_min, 0);
  v_price_max := coalesce(v_profile.budget_max, 0);

  return query
  with candidates as (
    select
      l.id,
      l.source,
      l.type,
      l.location_city,
      l.location_district,
      l.price,
      l.currency,
      l.rooms,
      l.size_sqm,
      l.contact_channel,
      (
        greatest(
          0,
          1 - abs(l.price - coalesce(v_profile.budget_max, l.price))
              / greatest(coalesce(v_profile.budget_max, l.price), 1)
        ) * 0.7
        + case
            when v_profile.rooms is null then 0.3
            when l.rooms = v_profile.rooms then 0.3
            when abs(l.rooms - v_profile.rooms) = 1 then 0.15
            else 0
          end
      )::real as score
    from listings l
    where l.status = 'active'
      and l.type = v_profile.type
      and (
        v_profile.location ilike '%' || l.location_city || '%'
        or l.location_city ilike '%' || v_profile.location || '%'
      )
      and (v_price_max = 0 or l.price <= v_price_max * 1.15)
      and (v_price_min = 0 or l.price >= v_price_min * 0.85)
      and (v_profile.rooms is null or abs(coalesce(l.rooms, v_profile.rooms) - v_profile.rooms) <= 1)
  )
  select
    c.id,
    c.source,
    c.type,
    c.location_city,
    c.location_district,
    c.price,
    c.currency,
    c.rooms,
    c.size_sqm,
    c.contact_channel,
    c.score
  from candidates c
  order by c.score desc nulls last
  limit greatest(1, least(p_limit, 20));
end;
$$;

-- Die alte 4-arg Signatur aus 0004 aufräumen, damit nur eine existiert
drop function if exists public.match_listings_for_profile(text, uuid, int);

revoke all on function public.match_listings_for_profile(text, uuid, uuid, int) from public;
grant execute on function public.match_listings_for_profile(text, uuid, uuid, int)
  to anon, authenticated;
