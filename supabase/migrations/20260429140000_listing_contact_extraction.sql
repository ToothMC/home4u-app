-- 20260429140000_listing_contact_extraction.sql
--
-- Slice 2 der Verfügbarkeits-Schleife: Klartext-Kontaktdaten von Bridge-
-- Listings (Bazaraki, INDEX.cy, …) extrahieren und encrypted speichern.
--
-- Hintergrund: Bisher wurde nur ein sha256-`contact_phone_hash` gespeichert
-- (für Cross-Source-Dedup). Damit konnte Home4U Seeker-Anfragen NICHT an
-- den ursprünglichen Inserenten weiterleiten — der Outreach-Loop für
-- Bridge-Listings war geschlossen.
--
-- Lösung: zusätzlich zum Hash auch den Klartext, AES-encrypted via
-- pgp_sym_encrypt mit `app.raw_text_pepper` (gleicher Pepper wie raw_text_enc).
-- Klartext wird NUR on-demand entschlüsselt — bei einer konkreten Seeker-
-- Anfrage, durch den Outreach-Mailer/Whatsapp-Sender (eigener service_role-
-- Code-Pfad). Kein UI/Frontend bekommt jemals Klartext.
--
-- GDPR/Privacy: Verarbeitungs-Grundlage = berechtigtes Interesse (Art. 6
-- Abs. 1 lit. f DSGVO) — Weiterleitung einer konkreten Anfrage des Seekers
-- an die im Original-Inserat selbst veröffentlichte Kontaktinfo. Kein
-- Marketing, kein Profiling. Opt-out-Mechanismus muss im Outreach-Mailer
-- selbst leben (Slice 3): jede ausgehende Mail/WhatsApp enthält
-- "Inserat aus Home4U entfernen"-Link → setzt status='opted_out'.

-- ============================================================================
-- Spalten
-- ============================================================================

-- contact_phone_enc existiert schon (0001_initial_schema.sql für source='direct').
-- Wir erweitern die Nutzung auf bridge-Sources.

alter table listings
  add column if not exists contact_email_enc bytea;

-- contact_phone_country = Ländercode-Präfix (z.B. "357" für Cyprus, "44" für UK).
-- Wird im Klartext gespeichert weil:
--   1. Allein nicht identifizierend (nur Land, keine Nummer)
--   2. Outreach-Routing braucht es OHNE Decrypt (E.164-Format-Wahl, WhatsApp-
--      Template-Sprache, Anrufkosten-Schätzung).
alter table listings
  add column if not exists contact_phone_country text;

create index if not exists listings_contact_phone_country_idx
  on listings(contact_phone_country) where contact_phone_country is not null;

-- Optional: Quelle der Kontaktdaten — 'public' (vom Inserenten selbst publik
-- gemacht, z.B. auf Bazaraki-Detail-Seite sichtbar), 'platform_relay' (über
-- Plattform-Messaging, kein Klartext) oder 'broker_uploaded' (direct).
alter table listings
  add column if not exists contact_source text
  check (contact_source is null or contact_source in ('public', 'platform_relay', 'broker_uploaded'));

comment on column listings.contact_email_enc is
  'AES-encrypted Kontakt-E-Mail (pgp_sym_encrypt mit app.raw_text_pepper). Klartext nur on-demand bei Outreach.';
comment on column listings.contact_phone_country is
  'Ländercode-Präfix (z.B. "357"). Klartext, weil allein nicht identifizierend und für Routing nötig.';
comment on column listings.contact_source is
  'Provenance: public = aus Original-Inserat öffentlich entnommen, platform_relay = nur Plattform-Messaging, broker_uploaded = direct-Listing.';

-- ============================================================================
-- bulk_upsert_external_listings — Kontaktdaten-Encrypt im Upsert
-- ============================================================================
-- Erweiterung des existierenden RPC (0050) um:
--   v_row->>'contact_phone'     → contact_phone_enc (encrypted)
--   v_row->>'contact_email'     → contact_email_enc (encrypted)
--   v_row->>'contact_phone_country' → text (plain)
--   v_row->>'contact_source'    → text (plain, default 'public' für bridges)
--
-- Backward-compat: alle Felder sind optional. Crawler die das nicht senden
-- (z.B. Bazaraki bis das Click-to-Reveal-Update deployed ist) verändern die
-- bestehenden Spalten nicht (coalesce-Pattern).

create or replace function public.bulk_upsert_external_listings(
  p_source listing_source,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  v_raw_pepper := nullif(current_setting('app.raw_text_pepper', true), '');

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
      v_raw_enc := null;
      if v_raw_pepper is not null and (v_row->>'raw_text') is not null then
        v_raw_enc := pgp_sym_encrypt(v_row->>'raw_text', v_raw_pepper);
      end if;

      -- Kontakt-Klartext encrypten wenn Pepper gesetzt und Wert vorhanden.
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
          when listings.status = 'opted_out' then 'opted_out'::listing_status
          when listings.status in ('rented', 'sold') then listings.status  -- finale Stati nicht reaktivieren
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

revoke execute on function public.bulk_upsert_external_listings(listing_source, jsonb)
  from public, anon, authenticated;

-- ============================================================================
-- Decrypt-Helper für Outreach-Code (service_role only)
-- ============================================================================
-- Wird vom Outreach-Mailer (Edge Function / Server Action) aufgerufen, um
-- bei einer konkreten Seeker-Anfrage die Kontaktdaten zu entschlüsseln.
-- NIE direkt in Public-RPCs zurückgeben — strikt service_role + Audit-Log.

create or replace function public.get_listing_contact_decrypted(
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pepper text;
  v_listing listings%rowtype;
  v_phone text;
  v_email text;
begin
  v_pepper := nullif(current_setting('app.raw_text_pepper', true), '');
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
$$;

-- KRITISCH: nie an authenticated/anon — nur service_role.
revoke all on function public.get_listing_contact_decrypted(uuid)
  from public, anon, authenticated;
grant execute on function public.get_listing_contact_decrypted(uuid)
  to service_role;

comment on function public.get_listing_contact_decrypted(uuid) is
  'Outreach-only: entschlüsselt Kontaktdaten für service_role-Code. NIEMALS an Frontend exponieren. Audit jeder Aufruf via outreach_log (kommt mit Slice 3).';
