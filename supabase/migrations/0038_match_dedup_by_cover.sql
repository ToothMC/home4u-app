-- match_listings_for_profile v3: Cover-Cluster-Dedup.
--
-- Hintergrund (2026-04-28): Nach dem ersten Bazaraki-Vollcrawl (27k Listings)
-- zeigt sich, dass viele Inserate (besonders Plots) mit identischer Cover-URL
-- auftauchen — Broker re-listen periodisch, oder verwenden ein Branded-Default-
-- Bild über ihre ganze Portfolio-Sammlung. Beides flutet den Match-Feed mit
-- visuell identischen Karten.
--
-- Lösung: dedup im RPC nach (media[1], city, type, property_type). Innerhalb
-- jedes Clusters wird das Listing mit dem höchsten Score behalten, die
-- Cluster-Größe als neuer Return-Wert mitgeschickt — UI kann „+N weitere"
-- rendern.
--
-- Listings ohne media (NULL) werden NICHT zusammengefasst — jedes ist eindeutig.
-- Source-agnostisch: funktioniert auch für FB-Listings (gleiche FB-CDN-URL →
-- selber Cluster). Cross-Source-Dedup mit verschiedenen URLs braucht pHash
-- (image_hashes-Tabelle, Migration 0025) → separates Folge-Ticket.
--
-- Spec-§7.2-Score-Formel und alle anderen Filter unverändert ggü. v2 (0032).

drop function if exists public.match_listings_for_profile(text, uuid, uuid, integer, text);

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
  cluster_size smallint  -- NEU: 1 = unique, ≥2 = visuelle Duplikate vorhanden
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
begin
  -- Profil-Auflösung (unverändert ggü. v2)
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

  -- Gewichte aus match_score_experiments. Fallback: Spec-§7.2-Werte.
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
      and (v_profile.rooms is null or abs(coalesce(l.rooms, v_profile.rooms) - v_profile.rooms) <= 1)
  ),
  scored as (
    select
      c.*,
      least(1.0, greatest(0.0,
        v_w_cosine * c.cosine_score
        + v_w_hard  * (c.price_score + c.room_score) / 2.0
        + v_w_scam  * (1.0 - coalesce(c.scam_score, 0.0))
      ))::real as score,
      -- Cluster-Signatur: gleiche Cover-URL + Stadt + Type + Property-Type.
      -- Listings ohne media[1] kriegen ihre id als Signatur → eindeutig.
      coalesce(c.media[1], c.id::text) as cluster_key
    from candidates c
  ),
  deduped as (
    -- DISTINCT ON behält die erste Zeile pro cluster_key. Sortierung nach
    -- score DESC innerhalb der Cluster-Signatur → das beste Listing bleibt.
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

revoke all on function public.match_listings_for_profile(text, uuid, uuid, integer, text) from public;
grant execute on function public.match_listings_for_profile(text, uuid, uuid, integer, text)
  to authenticated, service_role;
