-- match_listings_for_profile v3: liefert zusätzlich external_id + media[]
-- für die Match-Browse-UI (Suchende-Sicht mit Bilder-Galerie).
-- Score-Logik unverändert.

drop function if exists public.match_listings_for_profile(text, uuid, uuid, int);

create or replace function public.match_listings_for_profile(
  p_anonymous_id text default null,
  p_user_id uuid default null,
  p_profile_id uuid default null,
  p_limit int default 5
)
returns table (
  listing_id uuid,
  source listing_source,
  external_id text,
  type listing_type,
  location_city text,
  location_district text,
  price numeric,
  currency char(3),
  rooms smallint,
  size_sqm smallint,
  contact_channel text,
  media text[],
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
  v_has_profile_emb boolean;
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
  v_has_profile_emb := v_profile.embedding is not null;

  return query
  with candidates as (
    select
      l.id, l.source, l.external_id, l.type, l.location_city, l.location_district,
      l.price, l.currency, l.rooms, l.size_sqm, l.contact_channel, l.media,
      greatest(0, 1 - abs(l.price - coalesce(v_profile.budget_max, l.price))
        / greatest(coalesce(v_profile.budget_max, l.price), 1)) as price_score,
      case
        when v_profile.rooms is null then 1
        when l.rooms = v_profile.rooms then 1
        when abs(l.rooms - v_profile.rooms) = 1 then 0.5
        else 0
      end as room_score,
      case
        when v_has_profile_emb and l.embedding is not null
        then 1 - (l.embedding <=> v_profile.embedding) / 2.0
        else null
      end::real as cosine_score
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
    c.id, c.source, c.external_id, c.type, c.location_city, c.location_district,
    c.price, c.currency, c.rooms, c.size_sqm, c.contact_channel, c.media,
    (case
      when c.cosine_score is not null
      then 0.50 * c.cosine_score + 0.30 * c.price_score + 0.20 * c.room_score
      else 0.70 * c.price_score + 0.30 * c.room_score
    end)::real as score
  from candidates c
  order by score desc nulls last
  limit greatest(1, least(p_limit, 50));
end;
$$;

revoke all on function public.match_listings_for_profile(text, uuid, uuid, int) from public;
grant execute on function public.match_listings_for_profile(text, uuid, uuid, int) to anon, authenticated;
