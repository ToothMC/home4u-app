-- 20260430200000_preserve_drill_data_on_list_upsert.sql
--
-- Bug-Fix: bulk_upsert_external_listings überschrieb beim List-only-Touch
-- (max_pages=N ohne Detail-Drill, oder skip_details=1) die bereits gedrillten
-- Felder (size_sqm, location_district, property_type) mit NULL und kürzte
-- die volle Galerie auf den 1-Cover-Set zurück.
--
-- Beobachtung Run #21: 253 Listings touched, davon nur 2 mit district/size
-- — die 2 sind die einzigen die *vor* dem Run schon drilled waren, alle
-- anderen Drill-Daten wurden bei früheren List-Touches gewischt.
--
-- Fix: Schreib-Felder auf COALESCE umstellen, damit drill-only-Felder
-- erhalten bleiben wenn der aktuelle Crawl-Run sie nicht hat.
--   - size_sqm, location_district → COALESCE (Drill-only)
--   - rooms → COALESCE (List-Slug liefert idR auch was, aber Drill kann
--             Chars genauer auswerten — coalesce schützt das genauere)
--   - media → behalten wenn neue Liste kürzer ist (list=1 vs drill=N)
--   - property_type → schon coalesced, ok
--
-- price/currency/status/last_seen bleiben direktes Overwrite (sind frisch
-- aus der List-Page und sollen den DB-Stand updaten).

create or replace function public.bulk_upsert_external_listings(
  p_source listing_source,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
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
begin
  if p_source = 'direct' then
    raise exception 'bulk_upsert_external_listings is for bridge sources only, not direct';
  end if;

  v_raw_pepper := private.app_raw_text_pepper();

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
        -- Drill-only Felder: COALESCE schützt vorhandene Werte vor List-only-NULL
        location_district = coalesce(excluded.location_district, listings.location_district),
        location_raw = coalesce(excluded.location_raw, listings.location_raw),
        price = excluded.price,
        currency = excluded.currency,
        price_period = excluded.price_period,
        -- rooms: Drill-Chars genauer als List-Slug, COALESCE behält genauere Daten
        rooms = coalesce(excluded.rooms, listings.rooms),
        size_sqm = coalesce(excluded.size_sqm, listings.size_sqm),
        language = coalesce(excluded.language, listings.language),
        raw_text_enc = coalesce(excluded.raw_text_enc, listings.raw_text_enc),
        -- Galerie: nur überschreiben wenn neue >= alte (verhindert dass list-only
        -- 1-Cover die volle 12-Bilder-Galerie ersetzt)
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
        -- confidence: Drill setzt 0.85, list-only 0.5 — höchsten Wert behalten
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
