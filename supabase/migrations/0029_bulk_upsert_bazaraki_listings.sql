-- bulk_upsert_bazaraki_listings: Schwester-RPC zu bulk_upsert_fb_listings.
-- Indexer-Spec v2.0 §4.2 (Bazaraki-Iteration 2).
--
-- Unterschiede zu bulk_upsert_fb_listings:
--   - source = 'bazaraki' (nicht 'fb')
--   - kein fb_user_id-Blacklist-Check (Bazaraki hat keinen Author-ID)
--   - kein contact_phone in Input (Phone hinter Login-Wall, G0-Gate-pending,
--     Spec §4.2 Compliance-Anmerkung). contact_phone_hash + contact_phone_enc
--     bleiben damit NULL für 'bazaraki'.
--
-- Gleiche Sticky-Pattern für scam-Felder via scam_checked_at-Indikator
-- (siehe Migration 0028).
--
-- Erwartetes Row-Schema (jsonb-Array):
-- [
--   {
--     "external_id": text,                   -- Bazaraki adv-ID
--     "type": "rent" | "sale",
--     "location_city": text,
--     "location_district": text|null,
--     "price": numeric,
--     "currency": char(3),
--     "rooms": int|null,
--     "size_sqm": int|null,
--     "language": text|null,                 -- de|en|ru|el (Default 'en')
--     "media": text[]|null,
--     "raw_text": text|null,                 -- Klartext, hier verschlüsselt
--     "title": text|null,
--     "description": text|null,
--     "energy_class": text|null,
--     "furnishing": text|null,
--     "pets_allowed": boolean|null,
--     "confidence": float|null,
--     "extracted_data": jsonb|null,
--     "scam_score": float|null,
--     "scam_flags": text[]|null,
--     "scam_checked_at": timestamptz|null,
--     "dedup_hash": text                     -- vom Caller (bazaraki:<external_id>)
--   }
-- ]

create or replace function public.bulk_upsert_bazaraki_listings(
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
  v_failed jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index int := 0;
  v_raw_pepper text;
  v_raw_enc bytea;
  v_was_insert boolean;
  v_scam_checked_at timestamptz;
begin
  v_raw_pepper := nullif(current_setting('app.raw_text_pepper', true), '');

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
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
        language, raw_text_enc, media,
        dedup_hash,
        title, description,
        energy_class, furnishing, pets_allowed,
        confidence, extracted_data,
        scam_score, scam_flags, scam_checked_at,
        first_seen, last_seen
      )
      values (
        'bazaraki',
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
        nullif(v_row->>'confidence', '')::float,
        case when v_row ? 'extracted_data' then v_row->'extracted_data' else null end,
        coalesce((v_row->>'scam_score')::float, 0.0),
        case
          when v_row ? 'scam_flags' and jsonb_typeof(v_row->'scam_flags') = 'array'
          then array(select jsonb_array_elements_text(v_row->'scam_flags'))
          else '{}'::text[]
        end,
        v_scam_checked_at,
        now(), now()
      )
      on conflict (source, dedup_hash) do update set
        type = excluded.type,
        -- Opt-out sticky (Bazaraki hat aktuell keinen Mechanismus, aber
        -- konsistent mit fb-RPC-Pattern für künftige Spec-C-Outreach)
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
        language = excluded.language,
        raw_text_enc = coalesce(excluded.raw_text_enc, listings.raw_text_enc),
        media = case when array_length(excluded.media, 1) > 0 then excluded.media else listings.media end,
        title = coalesce(excluded.title, listings.title),
        description = coalesce(excluded.description, listings.description),
        energy_class = coalesce(excluded.energy_class, listings.energy_class),
        furnishing = coalesce(excluded.furnishing, listings.furnishing),
        pets_allowed = coalesce(excluded.pets_allowed, listings.pets_allowed),
        confidence = coalesce(excluded.confidence, listings.confidence),
        extracted_data = coalesce(excluded.extracted_data, listings.extracted_data),
        -- Sticky-Pattern für scam-Felder (Migration 0028).
        scam_score = case
          when excluded.scam_checked_at is not null then excluded.scam_score
          else listings.scam_score
        end,
        scam_flags = case
          when excluded.scam_checked_at is not null then excluded.scam_flags
          else listings.scam_flags
        end,
        scam_checked_at = coalesce(excluded.scam_checked_at, listings.scam_checked_at),
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
    'failed', v_failed
  );
end;
$$;

revoke all on function public.bulk_upsert_bazaraki_listings(jsonb) from public;
grant execute on function public.bulk_upsert_bazaraki_listings(jsonb) to service_role;
