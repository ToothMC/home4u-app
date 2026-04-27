-- Bulk-Upsert-RPCs durchgereicht für Scam-Felder (Indexer-Spec v2.0 §6.3,
-- "Beim Crawl-Upsert"). Caller berechnet Score in lib/scam/score.ts und
-- liefert das Tripel scam_score/scam_flags/scam_checked_at + confidence +
-- extracted_data mit. Wenn die Felder fehlen, bleiben bestehende Werte
-- (sticky-pattern via scam_checked_at als Indikator: nur wenn der Caller
-- "ich habe geprüft" signalisiert, werden score/flags überschrieben).
--
-- Erweitert:
--   - bulk_upsert_listings(p_broker_id, p_rows)        -- Direct/Makler-Pfad (0009)
--   - bulk_upsert_fb_listings(p_rows)                  -- FB-Crawler-Pfad   (0021)
--
-- Geänderte/neue Felder pro Row (alle optional):
--   "scam_score":        number 0..1
--   "scam_flags":        text[]
--   "scam_checked_at":   ISO timestamp (Indikator: "wurde geprüft")
--   "confidence":        number 0..1
--   "extracted_data":    jsonb (LLM-Rohextraktion)

-- =============================================================================
-- bulk_upsert_listings — Direct/Makler-Pfad (CSV-Import + Owner-Edit)
-- =============================================================================

create or replace function public.bulk_upsert_listings(
  p_broker_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_inserted int := 0;
  v_updated int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index int := 0;
  v_phone_pepper text;
  v_phone_enc bytea;
  v_listing_id uuid;
  v_was_insert boolean;
  v_scam_checked_at timestamptz;
begin
  if v_caller is not null and v_caller != p_broker_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_phone_pepper := nullif(current_setting('app.contact_pepper', true), '');

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
      v_phone_enc := null;
      if v_phone_pepper is not null and (v_row->>'contact_phone') is not null then
        v_phone_enc := pgp_sym_encrypt(v_row->>'contact_phone', v_phone_pepper);
      end if;

      v_scam_checked_at := nullif(v_row->>'scam_checked_at', '')::timestamptz;

      insert into listings (
        source, type, status,
        location_city, location_district, location_raw,
        price, currency, price_period,
        rooms, size_sqm,
        contact_name, contact_phone_enc, contact_channel,
        language, external_id, media,
        owner_user_id, dedup_hash,
        scam_score, scam_flags, scam_checked_at,
        confidence, extracted_data, contact_phone_hash,
        first_seen, last_seen
      )
      values (
        'direct',
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
        (v_row->>'rooms')::smallint,
        nullif(v_row->>'size_sqm', '')::smallint,
        nullif(v_row->>'contact_name', ''),
        v_phone_enc,
        nullif(v_row->>'contact_channel', ''),
        nullif(v_row->>'language', ''),
        nullif(v_row->>'external_id', ''),
        case
          when v_row ? 'media' and jsonb_typeof(v_row->'media') = 'array'
          then array(select jsonb_array_elements_text(v_row->'media'))
          else '{}'::text[]
        end,
        p_broker_id,
        v_row->>'dedup_hash',
        coalesce((v_row->>'scam_score')::float, 0.0),
        case
          when v_row ? 'scam_flags' and jsonb_typeof(v_row->'scam_flags') = 'array'
          then array(select jsonb_array_elements_text(v_row->'scam_flags'))
          else '{}'::text[]
        end,
        v_scam_checked_at,
        nullif(v_row->>'confidence', '')::float,
        case when v_row ? 'extracted_data' then v_row->'extracted_data' else null end,
        nullif(v_row->>'contact_phone_hash', ''),
        now(), now()
      )
      on conflict (source, dedup_hash) do update set
        type = excluded.type,
        status = 'active',
        location_city = excluded.location_city,
        location_district = excluded.location_district,
        location_raw = excluded.location_raw,
        price = excluded.price,
        currency = excluded.currency,
        price_period = excluded.price_period,
        rooms = excluded.rooms,
        size_sqm = excluded.size_sqm,
        contact_name = excluded.contact_name,
        contact_phone_enc = coalesce(excluded.contact_phone_enc, listings.contact_phone_enc),
        contact_channel = excluded.contact_channel,
        language = excluded.language,
        external_id = excluded.external_id,
        media = case when array_length(excluded.media, 1) > 0 then excluded.media else listings.media end,
        -- Scam-Felder: nur überschreiben, wenn Caller scam_checked_at mitsendet
        -- (= "habe geprüft"). Sonst sticky.
        scam_score = case
          when excluded.scam_checked_at is not null then excluded.scam_score
          else listings.scam_score
        end,
        scam_flags = case
          when excluded.scam_checked_at is not null then excluded.scam_flags
          else listings.scam_flags
        end,
        scam_checked_at = coalesce(excluded.scam_checked_at, listings.scam_checked_at),
        confidence = coalesce(excluded.confidence, listings.confidence),
        extracted_data = coalesce(excluded.extracted_data, listings.extracted_data),
        contact_phone_hash = coalesce(excluded.contact_phone_hash, listings.contact_phone_hash),
        last_seen = now(),
        updated_at = now()
      returning id, (xmax = 0) into v_listing_id, v_was_insert;

      if v_was_insert then
        v_inserted := v_inserted + 1;
      else
        v_updated := v_updated + 1;
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
    'failed', v_failed
  );
end;
$$;

revoke all on function public.bulk_upsert_listings(uuid, jsonb) from public;
grant execute on function public.bulk_upsert_listings(uuid, jsonb) to authenticated, service_role;

-- =============================================================================
-- bulk_upsert_fb_listings — FB-Crawler-Pfad (CDP-Attach)
-- =============================================================================

create or replace function public.bulk_upsert_fb_listings(
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated int := 0;
  v_opted_out int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index int := 0;
  v_phone_pepper text;
  v_raw_pepper text;
  v_phone_enc bytea;
  v_raw_enc bytea;
  v_status listing_status;
  v_was_insert boolean;
  v_scam_checked_at timestamptz;
begin
  v_phone_pepper := nullif(current_setting('app.contact_pepper', true), '');
  v_raw_pepper := nullif(current_setting('app.raw_text_pepper', true), '');

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
      v_status := 'active'::listing_status;
      if (v_row->>'contact_phone_hash') is not null and exists (
        select 1 from fb_contact_blacklist
        where contact_phone_hash = v_row->>'contact_phone_hash'
      ) then
        v_status := 'opted_out'::listing_status;
        v_opted_out := v_opted_out + 1;
      elsif (v_row->>'fb_user_id') is not null and exists (
        select 1 from fb_contact_blacklist
        where fb_user_id = v_row->>'fb_user_id'
      ) then
        v_status := 'opted_out'::listing_status;
        v_opted_out := v_opted_out + 1;
      end if;

      v_phone_enc := null;
      if v_phone_pepper is not null and (v_row->>'contact_phone') is not null then
        v_phone_enc := pgp_sym_encrypt(v_row->>'contact_phone', v_phone_pepper);
      end if;

      v_raw_enc := null;
      if v_raw_pepper is not null and (v_row->>'raw_text') is not null then
        v_raw_enc := pgp_sym_encrypt(v_row->>'raw_text', v_raw_pepper);
      end if;

      v_scam_checked_at := nullif(v_row->>'scam_checked_at', '')::timestamptz;

      insert into listings (
        source, external_id, type, status,
        location_city, location_district, location_raw,
        price, currency, price_period,
        rooms, size_sqm,
        contact_name, contact_phone_enc, contact_channel,
        language, raw_text_enc, media,
        dedup_hash,
        scam_score, scam_flags, scam_checked_at,
        confidence, extracted_data, contact_phone_hash,
        first_seen, last_seen
      )
      values (
        'fb',
        nullif(v_row->>'external_id', ''),
        (v_row->>'type')::listing_type,
        v_status,
        v_row->>'location_city',
        nullif(v_row->>'location_district', ''),
        coalesce(
          nullif(v_row->>'location_district', '') || ', ' || (v_row->>'location_city'),
          v_row->>'location_city'
        ),
        (v_row->>'price')::numeric,
        coalesce(nullif(v_row->>'currency', ''), 'EUR'),
        case when (v_row->>'type') = 'sale' then 'total' else 'month' end,
        (v_row->>'rooms')::smallint,
        nullif(v_row->>'size_sqm', '')::smallint,
        nullif(v_row->>'contact_name', ''),
        v_phone_enc,
        nullif(v_row->>'contact_channel', ''),
        nullif(v_row->>'language', ''),
        v_raw_enc,
        case
          when v_row ? 'media' and jsonb_typeof(v_row->'media') = 'array'
          then array(select jsonb_array_elements_text(v_row->'media'))
          else '{}'::text[]
        end,
        v_row->>'dedup_hash',
        coalesce((v_row->>'scam_score')::float, 0.0),
        case
          when v_row ? 'scam_flags' and jsonb_typeof(v_row->'scam_flags') = 'array'
          then array(select jsonb_array_elements_text(v_row->'scam_flags'))
          else '{}'::text[]
        end,
        v_scam_checked_at,
        nullif(v_row->>'confidence', '')::float,
        case when v_row ? 'extracted_data' then v_row->'extracted_data' else null end,
        nullif(v_row->>'contact_phone_hash', ''),
        now(), now()
      )
      on conflict (source, dedup_hash) do update set
        type = excluded.type,
        status = case
          when listings.status = 'opted_out' then 'opted_out'::listing_status
          else excluded.status
        end,
        location_city = excluded.location_city,
        location_district = excluded.location_district,
        location_raw = excluded.location_raw,
        price = excluded.price,
        currency = excluded.currency,
        price_period = excluded.price_period,
        rooms = excluded.rooms,
        size_sqm = excluded.size_sqm,
        contact_name = excluded.contact_name,
        contact_phone_enc = coalesce(excluded.contact_phone_enc, listings.contact_phone_enc),
        contact_channel = excluded.contact_channel,
        language = excluded.language,
        raw_text_enc = coalesce(excluded.raw_text_enc, listings.raw_text_enc),
        media = case when array_length(excluded.media, 1) > 0 then excluded.media else listings.media end,
        scam_score = case
          when excluded.scam_checked_at is not null then excluded.scam_score
          else listings.scam_score
        end,
        scam_flags = case
          when excluded.scam_checked_at is not null then excluded.scam_flags
          else listings.scam_flags
        end,
        scam_checked_at = coalesce(excluded.scam_checked_at, listings.scam_checked_at),
        confidence = coalesce(excluded.confidence, listings.confidence),
        extracted_data = coalesce(excluded.extracted_data, listings.extracted_data),
        contact_phone_hash = coalesce(excluded.contact_phone_hash, listings.contact_phone_hash),
        last_seen = now(),
        updated_at = now()
      returning (xmax = 0) into v_was_insert;

      if v_was_insert then
        v_inserted := v_inserted + 1;
      else
        v_updated := v_updated + 1;
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
    'opted_out', v_opted_out,
    'failed', v_failed
  );
end;
$$;

revoke all on function public.bulk_upsert_fb_listings(jsonb) from public;
grant execute on function public.bulk_upsert_fb_listings(jsonb) to service_role;
