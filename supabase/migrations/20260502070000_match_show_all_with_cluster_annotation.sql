-- 20260502070000_match_show_all_with_cluster_annotation.sql
--
-- Variante B "Transparent Cluster": Cluster-Member werden im Match-Feed
-- NICHT mehr versteckt. Stattdessen sieht der User alle Listings, jedes
-- Listing mit Annotation "auch verfügbar bei N anderen, ab €X" wenn es Teil
-- eines pHash/canonical-Clusters ist.
--
-- Hintergrund: Variante A (Cluster-Member hidden, nur Leader sichtbar)
-- hatte Stockfoto-Bug — verschiedene Apartments mit gleichem Werbefoto
-- wurden gemerged, der vermeintliche "Leader" war oft NICHT der günstigste,
-- 190k-Apartments wurden hinter 1.5M-Leadern versteckt. Cleanup-Schwellen
-- (>30% Spread) sind reaktiv, nicht präventiv.
--
-- Neue Logik: kein Hiding. canonical_id wird zur reinen Annotation:
--   - cluster_offers_count = Anzahl Listings im selben Cluster (1 = unique)
--   - min_cluster_price = günstigster Preis im Cluster (für "günstiger ab"-Hinweis)
--   - cluster_size (cover-photo-basiert) bleibt als sekundärer Indikator
--
-- Änderungen ggü. Vorgänger (cluster_offers_phash_no_price_funcs_only):
-- 1. Filter `(canonical_id is null or canonical_id = id)` entfernt
-- 2. DISTINCT ON über cluster_key in `deduped` entfernt — alle Listings
--    bleiben sichtbar, cluster_size bleibt als Window-Count
--
-- find_canonical_for_signals + canonical_id-Spalte bleiben unverändert —
-- wird vom Crawler weiter beim Insert gesetzt für die Annotation.

drop function if exists public.match_listings_for_profile(text, uuid, uuid, integer, text);

create or replace function public.match_listings_for_profile(
  p_anonymous_id text default null,
  p_user_id uuid default null,
  p_profile_id uuid default null,
  p_limit integer default 5,
  p_variant_id text default null
)
returns table (
  listing_id uuid, source listing_source, external_id text, type listing_type,
  property_type text, title text, description text,
  location_city text, location_district text,
  price numeric, currency character, rooms smallint, bathrooms smallint, size_sqm smallint,
  contact_channel text, media text[], features text[],
  market_position text, market_compset_size smallint,
  scam_score real, scam_flags text[], score real,
  cluster_size smallint, min_cluster_price numeric, cluster_offers_count smallint
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile record;
  v_price_min numeric; v_price_max numeric; v_has_profile_emb boolean;
  v_weights jsonb; v_w_cosine numeric; v_w_hard numeric; v_w_scam numeric;
  v_required_amenities text[];
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

  select weights into v_weights from match_score_experiments
    where variant_id = coalesce(p_variant_id, 'default') and ended_at is null;
  if v_weights is null then v_weights := '{"cosine": 0.6, "hard": 0.3, "scam": 0.1}'::jsonb; end if;
  v_w_cosine := (v_weights->>'cosine')::numeric;
  v_w_hard := (v_weights->>'hard')::numeric;
  v_w_scam := (v_weights->>'scam')::numeric;

  return query
  with cluster_stats as (
    -- Pro canonical-Cluster: günstigster Preis + Anzahl aller Anbieter
    -- (Master selbst + alle Listings mit canonical_id = master.id).
    -- Wird jetzt als Annotation an JEDEM Member geliefert, nicht nur am Master.
    select
      coalesce(l.canonical_id, l.id) as cluster_master_id,
      min(l.price) as min_price,
      count(*)::smallint as offers_count
    from listings l
    where l.status = 'active'
    group by coalesce(l.canonical_id, l.id)
  ),
  candidates as (
    select
      l.id, l.source, l.external_id, l.type, l.property_type, l.title, l.description,
      l.location_city, l.location_district, l.price, l.currency, l.rooms, l.bathrooms,
      l.size_sqm, l.contact_channel, l.media, l.features,
      l.market_position, l.market_compset_size, l.scam_score, l.scam_flags, l.ai_analyzed_at,
      cs.min_price as min_cluster_price,
      cs.offers_count as cluster_offers_count,
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
    -- KEY-CHANGE 1: Cluster-Aggregat per canonical-Master, nicht per listing.id.
    -- Jeder Member bekommt das Aggregat seines Clusters via canonical_id.
    left join cluster_stats cs on cs.cluster_master_id = coalesce(l.canonical_id, l.id)
    where l.status = 'active'
      and (l.scam_score < 0.5 or l.scam_score is null)
      -- KEY-CHANGE 2: kein canonical_id-IS-NULL-Filter mehr — Members
      -- werden gleichberechtigt mit Leadern angezeigt.
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
      and private.match_property_type_compatible(v_profile.property_type, l.property_type)
      and (v_profile.move_in_date is null or l.available_from is null or l.available_from <= v_profile.move_in_date)
      and (coalesce(v_profile.pets, false) = false or l.pets_allowed is null or l.pets_allowed = true)
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
  scored as (
    select c.*,
      least(1.0, greatest(0.0,
        v_w_cosine * c.cosine_score
        + v_w_hard * (c.price_score + c.room_score + c.amenity_score) / 3.0
        + v_w_scam * (1.0 - coalesce(c.scam_score, 0.0))
      ))::real as score,
      coalesce(c.media[1], c.id::text) as cluster_key
    from candidates c
  ),
  -- KEY-CHANGE 3: kein DISTINCT ON mehr — alle Listings sichtbar.
  -- cluster_size bleibt als Window-Count (cover-photo-basierte Hint, NICHT
  -- canonical-id-basiert; legacy aus Migration 0038, jetzt rein informativ).
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

revoke all on function public.match_listings_for_profile(text, uuid, uuid, integer, text)
  from public, anon;
grant execute on function public.match_listings_for_profile(text, uuid, uuid, integer, text)
  to authenticated, service_role;

comment on function public.match_listings_for_profile(text, uuid, uuid, integer, text) is
'Variante B "Transparent Cluster": kein Hiding von canonical-Members. Jedes Listing kommt einzeln zurück, mit min_cluster_price + cluster_offers_count als Annotation für "günstiger ab €X bei N Anbietern"-Hint im Frontend.';
