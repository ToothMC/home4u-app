-- BSC listet auch Anteile ("¼ share of an undivided residential field of
-- 4013 sqm") — sogar mehr als Bazaraki. BSCs Share-Hinweis steht nur im
-- Body der Detail-Seite, NICHT in title oder og:description. Die alte
-- generated column `is_share` (basiert nur auf title-Prefix) findet das
-- nicht. Wir brauchen ein schreibbares Bool, das die Crawler explizit
-- setzen koennen.
--
-- Migration:
-- 1) generated column droppen
-- 2) regulaere Bool-Spalte + Partial-Index
-- 3) Trigger: Bazaraki-Title-Pattern automatisch erkennen (sticky=true)
-- 4) Backfill Bazaraki (Daten waren in der generated column, jetzt weg)
-- 5) Index bleibt erhalten (CREATE INDEX IF NOT EXISTS)

-- Schritt 1+2: column ersetzen
alter table public.listings drop column if exists is_share;
alter table public.listings
  add column is_share boolean not null default false;

create index if not exists listings_is_share_idx
  on public.listings (is_share)
  where status='active';

-- Schritt 3: Trigger erkennt Bazaraki-Pattern. Setzt is_share auf true wenn
-- title mit "(share)" beginnt. Setzt NIE auf false zurueck — wenn ein
-- Crawler is_share=true ueberschreibt, bleibt das erhalten (sticky).
create or replace function public._auto_detect_is_share() returns trigger
language plpgsql
set search_path = 'pg_catalog, public'
as $$
begin
  if NEW.is_share = false
     and NEW.source = 'bazaraki'
     and lower(coalesce(NEW.title, '')) like '(share)%'
  then
    NEW.is_share := true;
  end if;
  return NEW;
end;
$$;

drop trigger if exists listings_auto_detect_is_share_trg on public.listings;
create trigger listings_auto_detect_is_share_trg
  before insert or update of title, source, is_share
  on public.listings
  for each row execute function _auto_detect_is_share();

-- Schritt 4: Backfill Bazaraki — der Wert war vor dem Migrations-Schritt 1
-- via generated column da, ist jetzt durch DROP COLUMN weg.
update public.listings
   set is_share = true
 where source = 'bazaraki'
   and lower(coalesce(title, '')) like '(share)%';

-- Schritt 5: bulk_upsert_external_listings akzeptiert is_share aus payload.
-- WICHTIG: Bei conflict (update) nur ueberschreiben wenn payload den Key
-- explizit hat, sonst sticky behalten — verhindert dass ein Crawler-Run
-- der das Pattern noch nicht checkt einen markierten Eintrag clearet.
create or replace function public.bulk_upsert_external_listings(p_source listing_source, p_rows jsonb)
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

      -- NEU: is_share aus payload (default false wenn nicht gesetzt)
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
        -- NEU: is_share sticky. Update nur wenn payload-Key gesetzt war
        -- ODER der Trigger einen Bazaraki-Title-Hit erkennt (siehe Trigger).
        -- Sonst behalten — verhindert dass eine Re-Crawl-Welle ohne Pattern-
        -- Detection bestehende Markierungen clearet.
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
