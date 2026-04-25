-- match_owner_inbox v2: liefert zusätzlich listing_media[] + listing_size_sqm
-- für die visuelle Inbox-UI (Karten mit Cover-Bild + erweitertes Profil).
-- Auth-Logik unverändert (auth.uid() muss Owner des Listings sein).

drop function if exists public.match_owner_inbox();

create or replace function public.match_owner_inbox()
returns table (
  match_id uuid,
  listing_id uuid,
  listing_city text,
  listing_district text,
  listing_price numeric,
  listing_rooms smallint,
  listing_size_sqm smallint,
  listing_media text[],
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
    l.size_sqm,
    l.media,
    m.score,
    m.seeker_interest,
    m.seeker_decided_at,
    m.owner_interest,
    m.owner_decided_at,
    m.connected_at,
    jsonb_build_object(
      'location', sp.location,
      'budget_min', sp.budget_min,
      'budget_max', sp.budget_max,
      'rooms', sp.rooms,
      'household', sp.household,
      'move_in_date', sp.move_in_date,
      'lifestyle_tags', sp.lifestyle_tags,
      'pets', sp.pets,
      'free_text', sp.free_text,
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
