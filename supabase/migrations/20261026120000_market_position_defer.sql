-- Marktposition aus dem Crawler-Schreibpfad nehmen, wo sie nichts bringt.
--
-- Inzident 2026-10-23..26: BSC schrieb 3 Tage lang 0 Inserate. Jeder
-- Upsert-Block (50 Zeilen) lief ins Timeout, weil der Trigger
-- listings_market_position_trg pro Zeile compute_listing_market_position
-- aufruft: ~3 s pro Zeile (22k Vergleichsinserate, kalt von Platte gelesen),
-- dazu ~0,5 s pHash-Suche. 50 Zeilen ≈ 190 s.
--
-- 1) Trigger feuert bei UPDATE nur noch, wenn sich ein relevantes Feld
--    WIRKLICH ändert. Vorher feuerte er bei jedem Upsert, weil die RPC
--    price/type/... immer neu setzt ("UPDATE OF" prüft nur die SET-Liste).
-- 2) Kein Recompute mehr, wenn ein Inserat inaktiv wird (stale/archived):
--    inaktive Inserate sind nie Vergleichsinserate, ihre eigene Position
--    ist egal. Spart mark_stale_listings Stunden bei großen Sweeps.
-- 3) bulk_upsert_external_listings(p_defer_market => true): neue Inserate
--    bekommen keine Sofort-Berechnung, market_updated_at bleibt NULL.
--    recompute_market_positions_pending() holt das gesammelt nach — ein
--    Durchlauf über die Vergleichsinserate statt einer Abfrage pro Zeile.
-- 4) recompute_market_positions_chunk war für anon/authenticated
--    aufrufbar (5 min DB-Last per Anfrage) → nur noch service_role.

-- Kurze Sperren: lieber scheitern als Website-Abfragen lange blockieren.
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1 + 2: Trigger
-- ---------------------------------------------------------------------------
create or replace function public.trg_recompute_market_position()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Verhindere Endlos-Rekursion (UPDATE in der Funktion löst Trigger erneut aus)
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  -- Inaktive Inserate sind keine Vergleichsinserate; Position egal.
  if new.status is distinct from 'active' then
    return new;
  end if;
  -- Bulk-Import mit p_defer_market: market_updated_at bleibt NULL,
  -- recompute_market_positions_pending() rechnet gesammelt nach.
  if tg_op = 'INSERT'
     and current_setting('home4u.defer_market_position', true) = 'on' then
    return new;
  end if;
  perform public.compute_listing_market_position(new.id);
  return new;
end;
$$;

drop trigger if exists listings_market_position_trg on public.listings;
drop trigger if exists listings_market_position_ins_trg on public.listings;
drop trigger if exists listings_market_position_upd_trg on public.listings;

create trigger listings_market_position_ins_trg
  after insert on public.listings
  for each row execute function trg_recompute_market_position();

create trigger listings_market_position_upd_trg
  after update of price, size_sqm, location_city, location_district, rooms,
                  type, status, property_type, is_share
  on public.listings
  for each row
  when (
       old.price             is distinct from new.price
    or old.size_sqm          is distinct from new.size_sqm
    or old.location_city     is distinct from new.location_city
    or old.location_district is distinct from new.location_district
    or old.rooms             is distinct from new.rooms
    or old.type              is distinct from new.type
    or old.status            is distinct from new.status
    or old.property_type     is distinct from new.property_type
    or old.is_share          is distinct from new.is_share
  )
  execute function trg_recompute_market_position();

-- ---------------------------------------------------------------------------
-- 3a: Gesammelte Nachberechnung — gleiche Regeln wie
--     compute_listing_market_position, aber ein Durchlauf für viele Inserate.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_market_positions_pending(
  p_limit int default 20000,
  p_ids uuid[] default null,     -- nur diese Inserate (zum Verifizieren)
  p_apply boolean default true   -- false: nur berechnen, Ergebnis zurückgeben
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '600s'
as $$
declare
  v_targets int;
  v_updated int := 0;
  v_result jsonb;
begin
  -- Ziel-Inserate: explizite IDs oder alle ohne Berechnung
  -- (listings_market_pending_idx). Inaktive überspringt der Trigger auch.
  create temp table _mp_t (
    id uuid primary key, type listing_type, lcity text, ldistrict text,
    rooms smallint, size_sqm smallint, price numeric, is_share boolean,
    grp text, valid boolean
  ) on commit drop;

  if p_ids is not null then
    insert into _mp_t (id) select distinct unnest(p_ids);
  else
    insert into _mp_t (id)
    select l.id from listings l
    where l.market_updated_at is null and l.status = 'active'
    order by l.created_at
    limit p_limit;
  end if;

  update _mp_t t
     set type = l.type,
         lcity = lower(l.location_city),
         ldistrict = lower(l.location_district),
         rooms = l.rooms, size_sqm = l.size_sqm, price = l.price,
         is_share = l.is_share,
         grp = _property_type_group(l.property_type),
         valid = (l.is_share = false and l.size_sqm is not null and l.size_sqm >= 5
                  and l.price is not null and l.price > 0)
    from listings l
   where l.id = t.id;
  delete from _mp_t where valid is null;  -- unbekannte IDs

  select count(*) into v_targets from _mp_t;
  if v_targets = 0 then
    return jsonb_build_object('targets', 0, 'updated', 0);
  end if;

  -- Vergleichsinserate: einmal lesen, nur Städte/Typen die gebraucht werden
  create temp table _mp_c on commit drop as
  select l.id, l.type,
         lower(l.location_city) as lcity,
         lower(l.location_district) as ldistrict,
         l.rooms,
         _property_type_group(l.property_type) as grp,
         l.price::numeric / l.size_sqm as eur
  from listings l
  where l.status = 'active'
    and l.is_share = false
    and l.size_sqm is not null and l.size_sqm >= 5
    and l.price is not null and l.price > 0
    and (l.type, lower(l.location_city)) in
        (select distinct type, lcity from _mp_t where valid);
  analyze _mp_c;

  -- Stufe 1: Stadtteil-genau (wie compute_listing_market_position)
  create temp table _mp_s on commit drop as
  select t.id,
         count(c.eur)::int as n,
         (percentile_cont(0.10) within group (order by c.eur))::numeric as p10,
         (percentile_cont(0.25) within group (order by c.eur))::numeric as p25,
         (percentile_cont(0.50) within group (order by c.eur))::numeric as p50,
         (percentile_cont(0.75) within group (order by c.eur))::numeric as p75
  from _mp_t t
  left join _mp_c c
    on  c.type = t.type
    and c.lcity = t.lcity
    and c.id <> t.id
    and (t.ldistrict is null or c.ldistrict is null or c.ldistrict = t.ldistrict)
    and (t.rooms is null or c.rooms is null or abs(c.rooms - t.rooms) <= 1)
    and (t.grp = 'other' or c.grp = t.grp)
  where t.valid
  group by t.id;

  -- Stufe 2: < 8 Vergleichsinserate → ganze Stadt (Stadtteil ignoriert)
  with city as (
    select t.id,
           count(c.eur)::int as n,
           (percentile_cont(0.10) within group (order by c.eur))::numeric as p10,
           (percentile_cont(0.25) within group (order by c.eur))::numeric as p25,
           (percentile_cont(0.50) within group (order by c.eur))::numeric as p50,
           (percentile_cont(0.75) within group (order by c.eur))::numeric as p75
    from _mp_t t
    join _mp_s s on s.id = t.id and s.n < 8
    left join _mp_c c
      on  c.type = t.type
      and c.lcity = t.lcity
      and c.id <> t.id
      and (t.rooms is null or c.rooms is null or abs(c.rooms - t.rooms) <= 1)
      and (t.grp = 'other' or c.grp = t.grp)
    group by t.id
  )
  update _mp_s s
     set n = city.n, p10 = city.p10, p25 = city.p25, p50 = city.p50, p75 = city.p75
    from city
   where city.id = s.id;

  -- Ergebnis je Inserat (Logik 1:1 aus compute_listing_market_position)
  create temp table _mp_r on commit drop as
  with base as (
    select t.id, t.valid,
           case when t.valid then t.price::numeric / t.size_sqm end as per_sqm,
           s.n, s.p10, s.p25, s.p50, s.p75
    from _mp_t t
    left join _mp_s s on s.id = t.id
  )
  select b.id,
         b.per_sqm as price_per_sqm,
         case
           when not b.valid then 'unknown'
           when b.n < 8 or b.p50 is null then 'unknown'
           when b.per_sqm <= b.p10 then 'very_good'
           when b.per_sqm <= b.p25 then 'good'
           when b.per_sqm <= b.p75 then 'fair'
           when b.per_sqm <= b.p75 * 1.15 then 'above'
           else 'expensive'
         end as market_position,
         case
           when not b.valid or b.n < 8 or b.p50 is null then null
           else least(100, greatest(0, round(
             case
               when b.per_sqm <= b.p25 then (b.per_sqm / nullif(b.p25, 0)) * 25
               when b.per_sqm <= b.p50 then 25 + (b.per_sqm - b.p25) / nullif(b.p50 - b.p25, 0) * 25
               when b.per_sqm <= b.p75 then 50 + (b.per_sqm - b.p50) / nullif(b.p75 - b.p50, 0) * 25
               else 75 + least(25, (b.per_sqm - b.p75) / nullif(b.p75 * 0.5, 0) * 25)
             end
           )::int))::smallint
         end as market_percentile,
         case when b.valid then coalesce(b.n, 0) else 0 end as market_compset_size,
         case when b.valid then b.p10 end as market_p10_eur_sqm,
         case when b.valid then b.p25 end as market_p25_eur_sqm,
         case when b.valid then b.p50 end as market_median_eur_sqm,
         case when b.valid then b.p75 end as market_p75_eur_sqm
  from base b;

  if not p_apply then
    select jsonb_build_object(
             'targets', v_targets,
             'rows', coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb))
      into v_result
      from _mp_r r;
    return v_result;
  end if;

  update listings l
     set price_per_sqm         = r.price_per_sqm,
         market_position       = r.market_position,
         market_percentile     = r.market_percentile,
         market_compset_size   = r.market_compset_size,
         market_p10_eur_sqm    = r.market_p10_eur_sqm,
         market_p25_eur_sqm    = r.market_p25_eur_sqm,
         market_median_eur_sqm = r.market_median_eur_sqm,
         market_p75_eur_sqm    = r.market_p75_eur_sqm,
         market_updated_at     = now()
    from _mp_r r
   where l.id = r.id;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('targets', v_targets, 'updated', v_updated);
end;
$$;

revoke execute on function public.recompute_market_positions_pending(int, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.recompute_market_positions_pending(int, uuid[], boolean)
  to service_role;

comment on function public.recompute_market_positions_pending(int, uuid[], boolean) is
  'Rechnet market_position gesammelt nach für Inserate mit market_updated_at IS NULL '
  '(von bulk_upsert_external_listings mit p_defer_market). Gleiche Regeln wie '
  'compute_listing_market_position. p_ids + p_apply=false zum Verifizieren.';

-- ---------------------------------------------------------------------------
-- 4: Chunk-Helper nicht öffentlich
-- ---------------------------------------------------------------------------
revoke execute on function public.recompute_market_positions_chunk(int)
  from public, anon, authenticated;
grant execute on function public.recompute_market_positions_chunk(int) to service_role;

-- ---------------------------------------------------------------------------
-- 3b: Kleiner Index für "wartet auf Berechnung" (normal leer)
-- ---------------------------------------------------------------------------
create index if not exists listings_market_pending_idx
  on public.listings (created_at)
  where market_updated_at is null and status = 'active';

-- ---------------------------------------------------------------------------
-- 3c: bulk_upsert_external_listings mit p_defer_market (default false →
--     bestehende Crawler unverändert). Rumpf sonst identisch zum Stand
--     vom 2026-10-26 (aus der DB übernommen).
-- ---------------------------------------------------------------------------
drop function if exists public.bulk_upsert_external_listings(listing_source, jsonb);

create or replace function public.bulk_upsert_external_listings(
  p_source listing_source,
  p_rows jsonb,
  p_defer_market boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
set statement_timeout to '120s'
set lock_timeout to '15s'
as $function$
declare
  v_inserted int := 0;
  v_updated int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index int := 0;
  v_raw_pepper text;
  v_raw_enc bytea;
  v_phone_enc bytea;
  v_email_enc bytea;
  v_was_insert boolean;
  v_scam_checked_at timestamptz;
  v_listing_id uuid;
  v_phash bigint;
  v_phone_hash text;
  v_canonical_match uuid;
  v_cover_url text;
  v_dedups int := 0;
  v_is_share boolean;
begin
  if p_source = 'direct' then
    raise exception 'bulk_upsert_external_listings is for bridge sources only, not direct';
  end if;

  v_raw_pepper := private.app_raw_text_pepper();

  -- Marktposition für neue Inserate gesammelt nachrechnen lassen
  -- (recompute_market_positions_pending). Gilt nur für diese Transaktion.
  if p_defer_market then
    perform set_config('home4u.defer_market_position', 'on', true);
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
      v_raw_enc := null;
      if v_raw_pepper is not null and (v_row->>'raw_text') is not null then
        v_raw_enc := pgp_sym_encrypt(v_row->>'raw_text', v_raw_pepper);
      end if;

      v_phone_enc := null;
      if v_raw_pepper is not null and nullif(v_row->>'contact_phone', '') is not null then
        v_phone_enc := pgp_sym_encrypt(v_row->>'contact_phone', v_raw_pepper);
      end if;
      v_email_enc := null;
      if v_raw_pepper is not null and nullif(v_row->>'contact_email', '') is not null then
        v_email_enc := pgp_sym_encrypt(v_row->>'contact_email', v_raw_pepper);
      end if;

      v_scam_checked_at := nullif(v_row->>'scam_checked_at', '')::timestamptz;
      v_phash := nullif(v_row->>'cover_phash', '')::bigint;
      v_phone_hash := nullif(v_row->>'phone_hash', '');
      v_cover_url := null;
      if v_row ? 'media' and jsonb_typeof(v_row->'media') = 'array'
         and jsonb_array_length(v_row->'media') > 0 then
        v_cover_url := v_row->'media'->>0;
      end if;

      v_is_share := coalesce((v_row->>'is_share')::boolean, false);

      insert into listings (
        source, external_id, type, status,
        location_city, location_district, location_raw,
        price, currency, price_period,
        rooms, size_sqm,
        language, raw_text_enc, media,
        dedup_hash,
        title, description,
        energy_class, furnishing, pets_allowed,
        property_type,
        confidence, extracted_data,
        scam_score, scam_flags, scam_checked_at,
        contact_phone_hash,
        contact_phone_enc, contact_email_enc,
        contact_phone_country, contact_source,
        is_share,
        first_seen, last_seen
      )
      values (
        p_source,
        nullif(v_row->>'external_id', ''),
        (v_row->>'type')::listing_type,
        'active',
        v_row->>'location_city',
        nullif(v_row->>'location_district', ''),
        coalesce(
          nullif(v_row->>'location_district', '') || ', ' || (v_row->>'location_city'),
          v_row->>'location_city'
        ),
        (v_row->>'price')::numeric,
        coalesce(nullif(v_row->>'currency', ''), 'EUR'),
        case when (v_row->>'type') = 'sale' then 'total' else 'month' end,
        nullif(v_row->>'rooms', '')::smallint,
        nullif(v_row->>'size_sqm', '')::smallint,
        coalesce(nullif(v_row->>'language', ''), 'en'),
        v_raw_enc,
        case
          when v_row ? 'media' and jsonb_typeof(v_row->'media') = 'array'
          then array(select jsonb_array_elements_text(v_row->'media'))
          else '{}'::text[]
        end,
        v_row->>'dedup_hash',
        nullif(v_row->>'title', ''),
        nullif(v_row->>'description', ''),
        nullif(v_row->>'energy_class', ''),
        nullif(v_row->>'furnishing', ''),
        case
          when (v_row->>'pets_allowed') is null or v_row->>'pets_allowed' = '' then null
          else (v_row->>'pets_allowed')::boolean
        end,
        nullif(v_row->>'property_type', ''),
        nullif(v_row->>'confidence', '')::float,
        case when v_row ? 'extracted_data' then v_row->'extracted_data' else null end,
        coalesce((v_row->>'scam_score')::float, 0.0),
        case
          when v_row ? 'scam_flags' and jsonb_typeof(v_row->'scam_flags') = 'array'
          then array(select jsonb_array_elements_text(v_row->'scam_flags'))
          else '{}'::text[]
        end,
        v_scam_checked_at,
        v_phone_hash,
        v_phone_enc,
        v_email_enc,
        nullif(v_row->>'contact_phone_country', ''),
        coalesce(nullif(v_row->>'contact_source', ''), 'public'),
        v_is_share,
        now(), now()
      )
      on conflict (source, dedup_hash) do update set
        type = excluded.type,
        status = case
          when listings.status in ('opted_out', 'archived') then listings.status
          when listings.status = 'reserved'
            and listings.status_changed_at is not null
            and listings.status_changed_at > now() - interval '3 days'
            then listings.status
          when listings.status in ('rented', 'sold')
            and listings.status_changed_at is not null
            and listings.status_changed_at > now() - interval '7 days'
            then listings.status
          else excluded.status
        end,
        status_changed_at = case
          when listings.status in ('rented', 'sold', 'reserved')
            and (
              listings.status_changed_at is null
              or (listings.status = 'reserved'
                  and listings.status_changed_at <= now() - interval '3 days')
              or (listings.status in ('rented', 'sold')
                  and listings.status_changed_at <= now() - interval '7 days')
            )
            then now()
          else listings.status_changed_at
        end,
        location_city = excluded.location_city,
        location_district = coalesce(excluded.location_district, listings.location_district),
        location_raw = coalesce(excluded.location_raw, listings.location_raw),
        price = excluded.price,
        currency = excluded.currency,
        price_period = excluded.price_period,
        rooms = coalesce(excluded.rooms, listings.rooms),
        size_sqm = coalesce(excluded.size_sqm, listings.size_sqm),
        language = coalesce(excluded.language, listings.language),
        raw_text_enc = coalesce(excluded.raw_text_enc, listings.raw_text_enc),
        media = case
          when array_length(excluded.media, 1) is null then listings.media
          when array_length(listings.media, 1) is null then excluded.media
          when array_length(excluded.media, 1) >= array_length(listings.media, 1) then excluded.media
          else listings.media
        end,
        title = coalesce(excluded.title, listings.title),
        description = coalesce(excluded.description, listings.description),
        energy_class = coalesce(excluded.energy_class, listings.energy_class),
        furnishing = coalesce(excluded.furnishing, listings.furnishing),
        pets_allowed = coalesce(excluded.pets_allowed, listings.pets_allowed),
        property_type = coalesce(excluded.property_type, listings.property_type),
        confidence = greatest(coalesce(excluded.confidence, 0.0), coalesce(listings.confidence, 0.0)),
        extracted_data = coalesce(excluded.extracted_data, listings.extracted_data),
        scam_score = case
          when excluded.scam_checked_at is not null then excluded.scam_score
          else listings.scam_score
        end,
        scam_flags = case
          when excluded.scam_checked_at is not null then excluded.scam_flags
          else listings.scam_flags
        end,
        scam_checked_at = coalesce(excluded.scam_checked_at, listings.scam_checked_at),
        contact_phone_hash = coalesce(excluded.contact_phone_hash, listings.contact_phone_hash),
        contact_phone_enc = coalesce(excluded.contact_phone_enc, listings.contact_phone_enc),
        contact_email_enc = coalesce(excluded.contact_email_enc, listings.contact_email_enc),
        contact_phone_country = coalesce(excluded.contact_phone_country, listings.contact_phone_country),
        contact_source = coalesce(excluded.contact_source, listings.contact_source),
        is_share = (listings.is_share or excluded.is_share),
        last_seen = now(),
        updated_at = now()
      returning id, (xmax = 0) into v_listing_id, v_was_insert;

      if v_was_insert then
        v_inserted := v_inserted + 1;
      else
        v_updated := v_updated + 1;
      end if;

      if v_phash is not null then
        insert into image_hashes (listing_id, phash, media_url)
        values (v_listing_id, v_phash, v_cover_url)
        on conflict do nothing;
      end if;

      if v_phash is not null or v_phone_hash is not null then
        select canonical_id into v_canonical_match from listings where id = v_listing_id;
        if v_canonical_match is null then
          v_canonical_match := find_canonical_for_signals(
            p_phash := v_phash,
            p_phone_hash := v_phone_hash,
            p_price := (v_row->>'price')::numeric,
            p_city := v_row->>'location_city',
            p_type := (v_row->>'type')::listing_type,
            p_property_type := nullif(v_row->>'property_type', ''),
            p_rooms := nullif(v_row->>'rooms', '')::smallint,
            p_size_sqm := nullif(v_row->>'size_sqm', '')::smallint,
            p_exclude_id := v_listing_id
          );
          if v_canonical_match is not null and v_canonical_match <> v_listing_id then
            update listings set canonical_id = v_canonical_match where id = v_listing_id;
            v_dedups := v_dedups + 1;
          end if;
        end if;
      end if;

    exception when others then
      v_failed := v_failed || jsonb_build_object(
        'index', v_index - 1,
        'reason', SQLERRM
      );
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'deduped', v_dedups,
    'failed', v_failed
  );
end;
$function$;

revoke execute on function public.bulk_upsert_external_listings(listing_source, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.bulk_upsert_external_listings(listing_source, jsonb, boolean)
  to service_role;

notify pgrst, 'reload schema';
