-- 20260430120000_match_filter_amenity_keywords.sql
--
-- match_listings_for_profile filtert jetzt auf Ausstattungs-Keywords aus
-- lifestyle_tags + free_text. Symptom vorher: User schreibt "mit pool" →
-- Match-Liste filtert nicht.
--
-- Hybrider Filter: ('pool' = ANY(features))  OR  description/title ILIKE '%pool%'.
-- listings.features ist heute (2026-04-30) bei 0/35k Listings befüllt —
-- der Text-Fallback macht den Filter sofort nutzbar. Sobald Crawler
-- Features extrahieren, gewinnt der strukturierte Pfad automatisch.
--
-- Mehrere Keywords werden mit AND verknüpft (Schnittmenge): "pool, garten"
-- liefert nur Listings mit beiden Hinweisen.
--
-- Negationen ("ohne pool") werden NICHT erkannt — User soll Sophie nutzen
-- für nuancierte Suchen, freie Eingaben sind best-effort positiv.

-- ─────────────────────────────────────────────────────────────────────
-- Helper: extrahiert kanonische Feature-Tokens aus Free-Text + Tags.
-- ─────────────────────────────────────────────────────────────────────
create or replace function private.extract_amenity_tokens(
  p_lifestyle_tags text[],
  p_free_text text
)
returns text[]
language plpgsql
immutable
as $$
declare
  v_input text;
  v_tokens text[] := '{}';
  v_alias_map jsonb := jsonb_build_object(
    'pool',             jsonb_build_array('pool', 'schwimmbad', 'swimming'),
    'garden',           jsonb_build_array('garten', 'garden'),
    'balcony',          jsonb_build_array('balkon', 'balcony'),
    'terrace',          jsonb_build_array('terrasse', 'terrace'),
    'parking',          jsonb_build_array('parkplatz', 'stellplatz', 'parking'),
    'covered_parking',  jsonb_build_array('garage', 'covered parking'),
    'elevator',         jsonb_build_array('aufzug', 'fahrstuhl', 'lift', 'elevator'),
    'air_conditioning', jsonb_build_array('klima', 'klimaanlage', 'air condition', 'aircon', ' ac '),
    'solar',            jsonb_build_array('solar', 'photovoltaik'),
    'sea_view',         jsonb_build_array('meerblick', 'sea view', 'seaview'),
    'mountain_view',    jsonb_build_array('bergblick', 'mountain view'),
    'storage',          jsonb_build_array('abstellraum', 'storage'),
    'fireplace',        jsonb_build_array('kamin', 'fireplace'),
    'jacuzzi',          jsonb_build_array('jacuzzi', 'whirlpool'),
    'gym',              jsonb_build_array('fitnessraum', 'fitness studio', 'gym'),
    'smart_home',       jsonb_build_array('smart home', 'smarthome', 'smart-home'),
    'accessible',       jsonb_build_array('barrierefrei', 'accessible', 'rollstuhl'),
    'pets_allowed',     jsonb_build_array('haustiere erlaubt', 'pet friendly', 'pet-friendly'),
    'furnished',        jsonb_build_array('möbliert', 'moebliert', 'furnished')
  );
  v_canonical text;
  v_aliases jsonb;
  v_alias text;
begin
  v_input := lower(coalesce(p_free_text, '') || ' ' ||
                   array_to_string(coalesce(p_lifestyle_tags, '{}'::text[]), ' '));
  if v_input is null or trim(v_input) = '' then
    return '{}'::text[];
  end if;

  -- Whitespace + Padding zur Token-Begrenzung — verhindert dass " ac " in
  -- "back" matched.
  v_input := ' ' || v_input || ' ';

  for v_canonical, v_aliases in select * from jsonb_each(v_alias_map) loop
    for v_alias in select jsonb_array_elements_text(v_aliases) loop
      if position(v_alias in v_input) > 0 then
        v_tokens := array_append(v_tokens, v_canonical);
        exit;  -- nächster canonical
      end if;
    end loop;
  end loop;

  return v_tokens;
end;
$$;

revoke all on function private.extract_amenity_tokens(text[], text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- match_listings_for_profile mit Amenity-Filter erweitern.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.match_listings_for_profile(
  p_anonymous_id text default null,
  p_user_id uuid default null,
  p_profile_id uuid default null,
  p_limit integer default 5,
  p_variant_id text default null
)
returns table (
  listing_id uuid,
  source listing_source,
  external_id text,
  type listing_type,
  property_type text,
  title text,
  description text,
  location_city text,
  location_district text,
  price numeric,
  currency character,
  rooms smallint,
  bathrooms smallint,
  size_sqm smallint,
  contact_channel text,
  media text[],
  features text[],
  market_position text,
  market_compset_size smallint,
  scam_score real,
  scam_flags text[],
  score real,
  cluster_size smallint
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
  v_weights jsonb;
  v_w_cosine numeric;
  v_w_hard numeric;
  v_w_scam numeric;
  v_required_amenities text[];
  v_amenity_alias_map jsonb := jsonb_build_object(
    'pool',             jsonb_build_array('pool', 'schwimmbad', 'swimming pool'),
    'garden',           jsonb_build_array('garten', 'garden'),
    'balcony',          jsonb_build_array('balkon', 'balcony'),
    'terrace',          jsonb_build_array('terrasse', 'terrace'),
    'parking',          jsonb_build_array('parkplatz', 'stellplatz', 'parking'),
    'covered_parking',  jsonb_build_array('garage', 'covered parking'),
    'elevator',         jsonb_build_array('aufzug', 'fahrstuhl', 'lift', 'elevator'),
    'air_conditioning', jsonb_build_array('klima', 'klimaanlage', 'air condition'),
    'solar',            jsonb_build_array('solar', 'photovoltaik'),
    'sea_view',         jsonb_build_array('meerblick', 'sea view'),
    'mountain_view',    jsonb_build_array('bergblick', 'mountain view'),
    'storage',          jsonb_build_array('abstellraum', 'storage'),
    'fireplace',        jsonb_build_array('kamin', 'fireplace'),
    'jacuzzi',          jsonb_build_array('jacuzzi', 'whirlpool'),
    'gym',              jsonb_build_array('fitnessraum', 'gym'),
    'smart_home',       jsonb_build_array('smart home', 'smarthome'),
    'accessible',       jsonb_build_array('barrierefrei', 'accessible'),
    'furnished',        jsonb_build_array('möbliert', 'moebliert', 'furnished')
  );
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
  v_required_amenities := private.extract_amenity_tokens(
    v_profile.lifestyle_tags, v_profile.free_text
  );

  select weights into v_weights
  from match_score_experiments
  where variant_id = coalesce(p_variant_id, 'default')
    and ended_at is null;
  if v_weights is null then
    v_weights := '{"cosine": 0.6, "hard": 0.3, "scam": 0.1}'::jsonb;
  end if;
  v_w_cosine := (v_weights->>'cosine')::numeric;
  v_w_hard   := (v_weights->>'hard')::numeric;
  v_w_scam   := (v_weights->>'scam')::numeric;

  return query
  with candidates as (
    select
      l.id, l.source, l.external_id, l.type, l.property_type, l.title, l.description,
      l.location_city, l.location_district, l.price, l.currency, l.rooms, l.bathrooms,
      l.size_sqm, l.contact_channel, l.media, l.features,
      l.market_position, l.market_compset_size,
      l.scam_score, l.scam_flags,
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
        else 0
      end as cosine_score
    from listings l
    where l.status = 'active'
      and (l.scam_score < 0.5 or l.scam_score is null)
      and (l.canonical_id is null or l.canonical_id = l.id)
      and l.type = v_profile.type
      and (
        v_profile.location ilike '%' || l.location_city || '%'
        or l.location_city ilike '%' || v_profile.location || '%'
      )
      and (v_price_max = 0 or l.price <= v_price_max * 1.15)
      and (v_price_min = 0 or l.price >= v_price_min * 0.85)
      and (
        v_profile.rooms is null
        or (
          coalesce(v_profile.rooms_strict, false)
          and l.rooms = v_profile.rooms
        )
        or (
          not coalesce(v_profile.rooms_strict, false)
          and abs(coalesce(l.rooms, v_profile.rooms) - v_profile.rooms) <= 1
        )
      )
      and (v_profile.property_type is null or l.property_type = v_profile.property_type)
      and (
        v_profile.move_in_date is null
        or l.available_from is null
        or l.available_from <= v_profile.move_in_date
      )
      and (
        coalesce(v_profile.pets, false) = false
        or l.pets_allowed is null
        or l.pets_allowed = true
      )
      -- Amenity-Filter: jeder geforderte Feature muss entweder strukturiert
      -- in features stecken ODER textlich in title/description vorkommen.
      and (
        v_required_amenities is null
        or array_length(v_required_amenities, 1) is null
        or (
          select bool_and(
            -- structured match
            req = any(coalesce(l.features, '{}'::text[]))
            -- ODER text-match auf irgendeinen Alias des Features
            or exists (
              select 1
              from jsonb_array_elements_text(v_amenity_alias_map->req) as alias
              where lower(coalesce(l.title, '') || ' ' || coalesce(l.description, ''))
                like '%' || alias || '%'
            )
          )
          from unnest(v_required_amenities) as req
        )
      )
  ),
  scored as (
    select
      c.*,
      least(1.0, greatest(0.0,
        v_w_cosine * c.cosine_score
        + v_w_hard  * (c.price_score + c.room_score) / 2.0
        + v_w_scam  * (1.0 - coalesce(c.scam_score, 0.0))
      ))::real as score,
      coalesce(c.media[1], c.id::text) as cluster_key
    from candidates c
  ),
  deduped as (
    select distinct on (
      s.cluster_key, s.location_city, s.type, s.property_type
    )
      s.*,
      count(*) over (
        partition by s.cluster_key, s.location_city, s.type, s.property_type
      )::smallint as cluster_size
    from scored s
    order by
      s.cluster_key, s.location_city, s.type, s.property_type,
      s.score desc nulls last
  )
  select
    d.id, d.source, d.external_id, d.type, d.property_type, d.title, d.description,
    d.location_city, d.location_district, d.price, d.currency, d.rooms, d.bathrooms,
    d.size_sqm, d.contact_channel, d.media, coalesce(d.features, '{}'::text[]),
    d.market_position, coalesce(d.market_compset_size, 0)::smallint,
    coalesce(d.scam_score, 0.0)::real as scam_score,
    coalesce(d.scam_flags, '{}'::text[]) as scam_flags,
    d.score,
    d.cluster_size
  from deduped d
  order by d.score desc nulls last
  limit greatest(1, least(p_limit, 50));
end;
$$;
