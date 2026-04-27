-- FB-Indexer (Spur 1.1): Opt-Out-Blacklist + Bulk-Upsert-RPC mit
-- Phone- und Raw-Text-Encryption (analog zu bulk_upsert_listings, aber für
-- source='fb', kein broker_id-Check, service_role-only).

-- -----------------------------------------------------------------------------
-- Blacklist: Telefonnummern (gehasht) + FB-User-IDs, die "nicht kontaktieren"
-- markiert sind. Wird vom FB-Crawler vor jedem Upsert geprüft; bei Match wird
-- status='opted_out' gesetzt statt 'active'.
-- -----------------------------------------------------------------------------

create table if not exists fb_contact_blacklist (
  id uuid primary key default uuid_generate_v4(),
  contact_phone_hash text,           -- sha256(E.164-normalisierte Phone)
  fb_user_id text,                   -- numerische FB-User-ID, falls bekannt
  reason text,
  created_at timestamptz not null default now(),
  check (contact_phone_hash is not null or fb_user_id is not null)
);

create unique index if not exists fb_contact_blacklist_phone_uidx
  on fb_contact_blacklist(contact_phone_hash) where contact_phone_hash is not null;
create unique index if not exists fb_contact_blacklist_fbuser_uidx
  on fb_contact_blacklist(fb_user_id) where fb_user_id is not null;

alter table fb_contact_blacklist enable row level security;
-- Nur service_role schreibt/liest; keine public policy.

-- -----------------------------------------------------------------------------
-- bulk_upsert_fb_listings: vom FB-Crawler nach jedem Polling-Pass aufgerufen.
-- Service-Role-only (kein auth.uid()-Check, anders als bulk_upsert_listings).
--
-- Verschlüsselt contact_phone + raw_text wenn Pepper konfiguriert
-- (app.contact_pepper bzw. app.raw_text_pepper).
-- Konfliktauflösung: (source='fb', dedup_hash) → UPDATE last_seen + price + status.
--
-- Erwartetes Row-Schema (jsonb-Array):
-- [
--   {
--     "external_id": text,                -- FB-Post-ID
--     "type": "rent" | "sale",
--     "location_city": text,
--     "location_district": text|null,
--     "price": numeric,
--     "currency": char(3),
--     "rooms": int,
--     "size_sqm": int|null,
--     "contact_name": text|null,
--     "contact_phone": text|null,         -- Klartext, hier verschlüsselt
--     "contact_phone_hash": text|null,    -- sha256-Klartext, für Blacklist-Match
--     "contact_channel": text|null,
--     "language": text|null,              -- de|en|ru|el
--     "media": text[]|null,
--     "raw_text": text|null,              -- Klartext, hier verschlüsselt
--     "fb_user_id": text|null,            -- für Blacklist-Match
--     "dedup_hash": text                  -- vom Caller berechnet (fb:<post_id>)
--   },
--   ...
-- ]
--
-- Response: { ok, inserted, updated, opted_out, failed: [{index, reason}] }
-- -----------------------------------------------------------------------------

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
begin
  v_phone_pepper := nullif(current_setting('app.contact_pepper', true), '');
  v_raw_pepper := nullif(current_setting('app.raw_text_pepper', true), '');

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
      -- Blacklist-Check: Phone-Hash oder FB-User-ID
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

      insert into listings (
        source, external_id, type, status,
        location_city, location_district, location_raw,
        price, currency, price_period,
        rooms, size_sqm,
        contact_name, contact_phone_enc, contact_channel,
        language, raw_text_enc, media,
        dedup_hash,
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
        now(), now()
      )
      on conflict (source, dedup_hash) do update set
        type = excluded.type,
        -- Opt-Out ist sticky: einmal opted_out, immer opted_out
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
