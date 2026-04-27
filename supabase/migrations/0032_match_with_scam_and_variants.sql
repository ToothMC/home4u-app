-- match_listings_for_profile v2 (Indexer-Spec v2.0 §7.2).
--
-- Änderungen ggü. der Vorgänger-Version (`match_with_richer_fields` auf Prod):
--   1. Scam-Filter:    scam_score < 0.5 OR scam_score IS NULL
--   2. Canonical:      canonical_id IS NULL OR canonical_id = id
--                      (Cross-Source-Cluster nur einmal in den Treffern)
--   3. Spec-§7.2-Formel:
--         match_score = w_cosine × cosine_sim
--                     + w_hard   × hard_match_ratio
--                     + w_scam   × (1 - scam_score)
--      mit hard_match_ratio = (price_score + room_score) / 2
--   4. Optionales p_variant_id für A/B-Tuning. Wenn gesetzt → Lookup in
--      match_score_experiments (Migration 0031). Fallback: 'default'.
--   5. Zusätzliche Return-Spalten: scam_score, scam_flags — UI/Sophie
--      sehen jetzt direkt warum etwas aus den Treffern fliegt oder bleibt.
--
-- Kein-Embedding-Fallback bleibt erhalten: wenn weder Profil noch Listing
-- ein Embedding haben, bekommt cosine den Wert 0 (ist ungerecht aber
-- konsistent mit Sticky-Pattern; wird durch hard_match_ratio kompensiert).

-- Alte Signatur droppen (4 Parameter → 5 Parameter ist signature-change,
-- create-or-replace allein reicht nicht).
drop function if exists public.match_listings_for_profile(text, uuid, uuid, integer);

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
  v_weights jsonb;
  v_w_cosine numeric;
  v_w_hard numeric;
  v_w_scam numeric;
begin
  -- Profil-Auflösung (unverändert ggü. v1)
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

  -- Gewichte aus match_score_experiments (Migration 0031). Fallback default.
  select weights into v_weights
  from match_score_experiments
  where variant_id = coalesce(p_variant_id, 'default')
    and ended_at is null;
  if v_weights is null then
    -- Variant nicht gefunden oder gestoppt → harter Fallback auf Spec-§7.2-Werte
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

      -- Soft-Match-Dimensionen (continuous, 0..1)
      greatest(0, 1 - abs(l.price - coalesce(v_profile.budget_max, l.price))
        / greatest(coalesce(v_profile.budget_max, l.price), 1)) as price_score,
      case
        when v_profile.rooms is null then 1
        when l.rooms = v_profile.rooms then 1
        when abs(l.rooms - v_profile.rooms) = 1 then 0.5
        else 0
      end as room_score,
      -- Cosine via pgvector. Distance ist 0..2 → similarity 0..1 via /2.
      case
        when v_has_profile_emb and l.embedding is not null
        then 1 - (l.embedding <=> v_profile.embedding) / 2.0
        else 0
      end as cosine_score
    from listings l
    where l.status = 'active'
      -- Spec §7.2(a) Scam-Filter
      and (l.scam_score < 0.5 or l.scam_score is null)
      -- Spec §2.3 Canonical-Filter (Cross-Source-Cluster nur einmal)
      and (l.canonical_id is null or l.canonical_id = l.id)
      -- Type / Location / Price-Range / Rooms — Hard-Filter (unverändert)
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
    c.id, c.source, c.external_id, c.type, c.property_type, c.title, c.description,
    c.location_city, c.location_district, c.price, c.currency, c.rooms, c.bathrooms,
    c.size_sqm, c.contact_channel, c.media, coalesce(c.features, '{}'::text[]),
    c.market_position, coalesce(c.market_compset_size, 0)::smallint,
    coalesce(c.scam_score, 0.0)::real as scam_score,
    coalesce(c.scam_flags, '{}'::text[]) as scam_flags,
    -- Spec-§7.2-Formel mit hard_match_ratio = avg(price, room).
    -- Score wird auf [0, 1] gecapped (numerisch sollte er das schon sein).
    least(1.0, greatest(0.0,
      v_w_cosine * c.cosine_score
      + v_w_hard  * (c.price_score + c.room_score) / 2.0
      + v_w_scam  * (1.0 - coalesce(c.scam_score, 0.0))
    ))::real as score
  from candidates c
  order by score desc nulls last
  limit greatest(1, least(p_limit, 50));
end;
$$;

-- Grants gleich wie Vorgänger (security definer + service_role + authenticated)
revoke all on function public.match_listings_for_profile(text, uuid, uuid, integer, text) from public;
grant execute on function public.match_listings_for_profile(text, uuid, uuid, integer, text)
  to authenticated, service_role;
