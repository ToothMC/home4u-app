-- 20260430090000_pepper_via_vault_and_bazaraki_phone_enc.sql
--
-- Bug-Fixes:
-- 1. `app.raw_text_pepper` als current_setting funktioniert auf Supabase
--    nicht (ALTER DATABASE/ROLE blocked) → Helper liest jetzt aus
--    Supabase Vault (Secret-Name: 'app_raw_text_pepper').
-- 2. `bulk_upsert_bazaraki_listings` schrieb weder contact_phone_enc
--    noch contact_email_enc → 27k Listings ohne Klartext. Jetzt analog
--    zu bulk_upsert_external_listings.
--
-- Zusätzlich: get_listing_contact_decrypted und bulk_upsert_external_listings
-- werden auf den Helper umgestellt (sonst können sie nicht mehr lesen/schreiben).
-- bulk_upsert_fb_listings bleibt unangetastet (verwendet 'app.contact_pepper',
-- separate Concern).

create schema if not exists private;

-- Helper: liest Pepper aus Vault. SECURITY DEFINER, weil normaler
-- Aufruf-Role keinen Zugriff auf vault.decrypted_secrets hat.
create or replace function private.app_raw_text_pepper()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pepper text;
begin
  select decrypted_secret into v_pepper
  from vault.decrypted_secrets
  where name = 'app_raw_text_pepper'
  limit 1;
  return nullif(v_pepper, '');
end;
$$;

revoke all on function private.app_raw_text_pepper() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 1. bulk_upsert_external_listings — Pepper-Quelle umstellen
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.bulk_upsert_external_listings(p_source listing_source, p_rows jsonb)
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
        property_type = coalesce(excluded.property_type, listings.property_type),
        confidence = coalesce(excluded.confidence, listings.confidence),
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

-- ─────────────────────────────────────────────────────────────────────
-- 2. bulk_upsert_bazaraki_listings — phone_enc + email_enc nachziehen
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.bulk_upsert_bazaraki_listings(p_rows jsonb)
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
        property_type = coalesce(excluded.property_type, listings.property_type),
        confidence = coalesce(excluded.confidence, listings.confidence),
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

-- ─────────────────────────────────────────────────────────────────────
-- 3. get_listing_contact_decrypted — Pepper-Quelle umstellen
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.get_listing_contact_decrypted(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'extensions'
as $function$
declare
  v_pepper text;
  v_listing listings%rowtype;
  v_phone text;
  v_email text;
begin
  v_pepper := private.app_raw_text_pepper();
  if v_pepper is null then
    return jsonb_build_object('ok', false, 'error', 'pepper_missing');
  end if;

  select * into v_listing from listings where id = p_listing_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  if v_listing.contact_phone_enc is not null then
    begin
      v_phone := pgp_sym_decrypt(v_listing.contact_phone_enc, v_pepper);
    exception when others then
      v_phone := null;
    end;
  end if;
  if v_listing.contact_email_enc is not null then
    begin
      v_email := pgp_sym_decrypt(v_listing.contact_email_enc, v_pepper);
    exception when others then
      v_email := null;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'listing_id', p_listing_id,
    'phone', v_phone,
    'email', v_email,
    'phone_country', v_listing.contact_phone_country,
    'source', v_listing.contact_source,
    'language', v_listing.language
  );
end
$function$;
