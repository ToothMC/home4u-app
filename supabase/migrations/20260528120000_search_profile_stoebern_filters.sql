-- Such-Profil-Filter Parität mit /stoebern (2026-05-28):
-- /dashboard/searches/[id] hatte bisher keinen Property-Type-Picker und keine
-- Advanced-Filter (Bäder, Größe, Möblierung, Features, Energie, Baujahr,
-- Anteils-Inserate). Wir spiegeln das Filter-Modell aus lib/browse/filters.ts.
--
-- Bestehende singular-property_type-Spalte bleibt für Backward-Compat (Sophie
-- setzt sie via Tool-Handler). Neue property_types[] wird beim Match bevorzugt,
-- wenn nicht-leer; sonst fällt der RPC auf den singular-Wert zurück.
--
-- include_shares=false (Default) zieht is_share=false-Filter aus stoebern nach:
-- Anteils-Inserate matchen nicht mehr automatisch, sondern nur opt-in.

alter table search_profiles
  add column if not exists property_types text[],
  add column if not exists bathrooms_min smallint
    check (bathrooms_min is null or (bathrooms_min >= 0 and bathrooms_min <= 20)),
  add column if not exists size_min smallint
    check (size_min is null or (size_min >= 0 and size_min <= 10000)),
  add column if not exists size_max smallint
    check (size_max is null or (size_max >= 0 and size_max <= 10000)),
  add column if not exists furnishing text
    check (furnishing is null or furnishing in ('furnished','semi','unfurnished')),
  add column if not exists features_required text[],
  add column if not exists energy_min text
    check (energy_min is null or energy_min in ('A+','A','B','C','D','E','F','G')),
  add column if not exists year_min smallint
    check (year_min is null or (year_min >= 1800 and year_min <= 2100)),
  add column if not exists include_shares boolean not null default false;

create index if not exists search_profiles_property_types_idx
  on search_profiles using gin (property_types)
  where property_types is not null;

create index if not exists search_profiles_features_required_idx
  on search_profiles using gin (features_required)
  where features_required is not null;

-- RPC erweitern um die neuen Hard-Filter. Backward-Compat:
-- - property_types: wenn nicht-leer, expand via existing property_type_compatible
--   helper; sonst alter singular-Pfad.
-- - features_required: AND-Match auf l.features (gleiche Semantik wie stoebern
--   `.contains()`). Bestehende amenity-Token-Heuristik bleibt zusätzlich aktiv
--   (lifestyle_tags + free_text), damit Sophie-Chats weiter funktionieren.
-- - is_share: ausblenden wenn include_shares=false.
-- - bathrooms_min/size_min/size_max/furnishing/energy_min/year_min als
--   straightforward hard filter.

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
  cluster_size smallint,
  min_cluster_price numeric,
  cluster_offers_count smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_price_min numeric; v_price_max numeric; v_has_profile_emb boolean;
  v_weights jsonb; v_w_cosine numeric; v_w_hard numeric; v_w_scam numeric;
  v_required_amenities text[];
  v_energy_allowed text[];
  v_amenity_alias_map jsonb := jsonb_build_object(
    'pool', jsonb_build_array('pool', 'schwimmbad', 'swimming pool'),
    'garden', jsonb_build_array('garten', 'garden'),
    'balcony', jsonb_build_array('balkon', 'balcony'),
    'terrace', jsonb_build_array('terrasse', 'terrace'),
    'parking', jsonb_build_array('parkplatz', 'stellplatz', 'parking'),
    'covered_parking', jsonb_build_array('garage', 'covered parking'),
    'elevator', jsonb_build_array('aufzug', 'fahrstuhl', 'lift', 'elevator'),
    'air_conditioning', jsonb_build_array('klima', 'klimaanlage', 'air condition'),
    'solar', jsonb_build_array('solar', 'photovoltaik'),
    'sea_view', jsonb_build_array('meerblick', 'sea view'),
    'mountain_view', jsonb_build_array('bergblick', 'mountain view'),
    'storage', jsonb_build_array('abstellraum', 'storage'),
    'fireplace', jsonb_build_array('kamin', 'fireplace'),
    'jacuzzi', jsonb_build_array('jacuzzi', 'whirlpool'),
    'gym', jsonb_build_array('fitnessraum', 'gym'),
    'smart_home', jsonb_build_array('smart home', 'smarthome'),
    'accessible', jsonb_build_array('barrierefrei', 'accessible'),
    'furnished', jsonb_build_array('möbliert', 'moebliert', 'furnished')
  );
begin
  if p_profile_id is not null then
    select * into v_profile from search_profiles where id = p_profile_id;
  elsif p_user_id is not null then
    select * into v_profile from search_profiles where user_id = p_user_id and active = true order by updated_at desc limit 1;
  elsif p_anonymous_id is not null then
    select * into v_profile from search_profiles where anonymous_id = p_anonymous_id and active = true order by updated_at desc limit 1;
  else return;
  end if;
  if v_profile is null then return; end if;

  v_price_min := coalesce(v_profile.budget_min, 0);
  v_price_max := coalesce(v_profile.budget_max, 0);
  v_has_profile_emb := v_profile.embedding is not null;
  v_required_amenities := private.extract_amenity_tokens(v_profile.lifestyle_tags, v_profile.free_text);

  if v_profile.energy_min is not null then
    v_energy_allowed := case v_profile.energy_min
      when 'A+' then array['A+']
      when 'A'  then array['A+','A']
      when 'B'  then array['A+','A','B']
      when 'C'  then array['A+','A','B','C']
      when 'D'  then array['A+','A','B','C','D']
      when 'E'  then array['A+','A','B','C','D','E']
      when 'F'  then array['A+','A','B','C','D','E','F']
      when 'G'  then array['A+','A','B','C','D','E','F','G']
    end;
  end if;

  select weights into v_weights from match_score_experiments
    where variant_id = coalesce(p_variant_id, 'default') and ended_at is null;
  if v_weights is null then v_weights := '{"cosine": 0.6, "hard": 0.3, "scam": 0.1}'::jsonb; end if;
  v_w_cosine := (v_weights->>'cosine')::numeric;
  v_w_hard := (v_weights->>'hard')::numeric;
  v_w_scam := (v_weights->>'scam')::numeric;

  return query
  with candidates as (
    select
      l.id, l.source, l.external_id, l.type, l.property_type, l.title, l.description,
      l.location_city, l.location_district, l.price, l.currency, l.rooms, l.bathrooms,
      l.size_sqm, l.contact_channel, l.media, l.features,
      l.market_position, l.market_compset_size, l.scam_score, l.scam_flags, l.ai_analyzed_at,
      coalesce(l.canonical_id, l.id) as cluster_master,
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
      end as cosine_score,
      1.0 as amenity_score
    from listings l
    where l.status = 'active'
      and (l.source = 'direct' or l.last_seen > now() - interval '7 days')
      and (l.scam_score < 0.5 or l.scam_score is null)
      and l.type = v_profile.type
      and l.media is not null and array_length(l.media, 1) >= 1
      and (
        v_profile.location ilike '%' || l.location_city || '%'
        or l.location_city ilike '%' || v_profile.location || '%'
      )
      and (v_price_max = 0 or l.price <= v_price_max * 1.15)
      and (v_price_min = 0 or l.price >= v_price_min * 0.85)
      and (
        v_profile.rooms is null
        or (coalesce(v_profile.rooms_strict, false) and l.rooms = v_profile.rooms)
        or (not coalesce(v_profile.rooms_strict, false) and abs(coalesce(l.rooms, v_profile.rooms) - v_profile.rooms) <= 1)
      )
      -- property_types[] (Multi-Select aus UI) bevorzugt; fällt zurück auf
      -- singular property_type via compatibility-helper (Sophie + Legacy).
      and (
        coalesce(array_length(v_profile.property_types, 1), 0) > 0
        and exists (
          select 1 from unnest(v_profile.property_types) as pt
          where private.match_property_type_compatible(pt, l.property_type)
        )
        or coalesce(array_length(v_profile.property_types, 1), 0) = 0
        and private.match_property_type_compatible(v_profile.property_type, l.property_type)
      )
      and (v_profile.move_in_date is null or l.available_from is null or l.available_from <= v_profile.move_in_date)
      and (coalesce(v_profile.pets, false) = false or l.pets_allowed is null or l.pets_allowed = true)
      -- Anteils-Inserate ausblenden, wenn include_shares=false (Default).
      and (coalesce(v_profile.include_shares, false) = true or coalesce(l.is_share, false) = false)
      -- Bäder/Größe/Baujahr — null im Profil = kein Filter
      and (v_profile.bathrooms_min is null or l.bathrooms >= v_profile.bathrooms_min)
      and (v_profile.size_min is null or l.size_sqm >= v_profile.size_min)
      and (v_profile.size_max is null or l.size_sqm <= v_profile.size_max)
      and (v_profile.year_min is null or l.year_built >= v_profile.year_min)
      -- Möblierung — ilike-Pattern (Crawler-Werte sind heterogen)
      and (
        v_profile.furnishing is null
        or (v_profile.furnishing = 'furnished' and (l.furnishing ilike 'fully%' or l.furnishing ilike 'furnished'))
        or (v_profile.furnishing = 'semi' and (l.furnishing ilike 'semi%' or l.furnishing ilike 'appliances%'))
        or (v_profile.furnishing = 'unfurnished' and l.furnishing ilike 'unfurnished')
      )
      -- Energieklasse: alle Klassen ≥ Profil.energy_min
      and (v_energy_allowed is null or l.energy_class = any (v_energy_allowed))
      -- Required features (UI multi-select): ALL müssen drin sein.
      and (
        coalesce(array_length(v_profile.features_required, 1), 0) = 0
        or (l.features is not null and l.features @> v_profile.features_required)
      )
      -- Lifestyle/Free-Text amenity tokens (Sophie-Heuristik, ergänzend)
      and (
        v_required_amenities is null
        or array_length(v_required_amenities, 1) is null
        or (
          select bool_and(
            req = any(coalesce(l.features, '{}'::text[]))
            or exists (
              select 1
              from jsonb_array_elements_text(v_amenity_alias_map->req) as alias
              where lower(
                coalesce(l.title, '') || ' ' ||
                coalesce(l.description, '') || ' ' ||
                coalesce(l.extracted_data::text, '')
              ) like '%' || alias || '%'
            )
          )
          from unnest(v_required_amenities) as req
        )
      )
  ),
  with_cluster_stats as (
    select c.*,
      (
        select count(*) from listings sib
        where sib.status = 'active'
          and (sib.source = 'direct' or sib.last_seen > now() - interval '7 days')
          and coalesce(sib.canonical_id, sib.id) = c.cluster_master
          and sib.location_city = c.location_city
          and (
            (sib.location_district is null and c.location_district is null)
            or sib.location_district = c.location_district
          )
          and sib.type = c.type
          and coalesce(sib.rooms, -1) = coalesce(c.rooms, -1)
      )::smallint as cluster_offers_count,
      (
        select min(sib.price) from listings sib
        where sib.status = 'active'
          and (sib.source = 'direct' or sib.last_seen > now() - interval '7 days')
          and coalesce(sib.canonical_id, sib.id) = c.cluster_master
          and sib.location_city = c.location_city
          and (
            (sib.location_district is null and c.location_district is null)
            or sib.location_district = c.location_district
          )
          and sib.type = c.type
          and coalesce(sib.rooms, -1) = coalesce(c.rooms, -1)
      ) as min_cluster_price
    from candidates c
  ),
  scored as (
    select c.*,
      least(1.0, greatest(0.0,
        v_w_cosine * c.cosine_score
        + v_w_hard * (c.price_score + c.room_score + c.amenity_score) / 3.0
        + v_w_scam * (1.0 - coalesce(c.scam_score, 0.0))
      ))::real as score,
      coalesce(c.media[1], c.id::text) as cluster_key
    from with_cluster_stats c
  ),
  annotated as (
    select s.*,
      count(*) over (partition by s.cluster_key, s.location_city, s.type, s.property_type)::smallint as cluster_size
    from scored s
  )
  select a.id, a.source, a.external_id, a.type, a.property_type, a.title, a.description,
    a.location_city, a.location_district, a.price, a.currency, a.rooms, a.bathrooms,
    a.size_sqm, a.contact_channel, a.media, coalesce(a.features, '{}'::text[]),
    a.market_position, coalesce(a.market_compset_size, 0)::smallint,
    coalesce(a.scam_score, 0.0)::real as scam_score,
    coalesce(a.scam_flags, '{}'::text[]) as scam_flags, a.score, a.cluster_size,
    coalesce(a.min_cluster_price, a.price) as min_cluster_price,
    coalesce(a.cluster_offers_count, 1)::smallint as cluster_offers_count
  from annotated a
  order by a.score desc nulls last
  limit greatest(1, least(p_limit, 50));
end;
$$;

revoke all on function public.match_listings_for_profile(text, uuid, uuid, integer, text) from public;
grant execute on function public.match_listings_for_profile(text, uuid, uuid, integer, text)
  to authenticated, service_role;
