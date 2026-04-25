-- Bulk-Import für Makler (CSV → listings)
-- Audit-Tabelle, Mapping-Persistenz pro Broker, Bulk-Upsert-RPC.

-- -----------------------------------------------------------------------------
-- listing_imports — Audit pro Upload
-- -----------------------------------------------------------------------------

create type listing_import_status as enum ('pending', 'completed', 'failed');

create table listing_imports (
  id uuid primary key default uuid_generate_v4(),
  broker_id uuid not null references auth.users(id) on delete cascade,
  file_name text,
  file_signature text,
  total_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  failed_rows integer not null default 0,
  skipped_rows integer not null default 0,
  status listing_import_status not null default 'pending',
  failure_detail text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index listing_imports_broker_idx on listing_imports(broker_id, created_at desc);

alter table listing_imports enable row level security;
create policy "listing_imports_owner_rw" on listing_imports
  for all using (auth.uid() = broker_id) with check (auth.uid() = broker_id);

-- -----------------------------------------------------------------------------
-- broker_import_mappings — gemerktes Mapping pro Broker pro Header-Signatur
-- -----------------------------------------------------------------------------

create table broker_import_mappings (
  broker_id uuid not null references auth.users(id) on delete cascade,
  header_signature text not null,
  mapping jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (broker_id, header_signature)
);

alter table broker_import_mappings enable row level security;
create policy "broker_import_mappings_owner_rw" on broker_import_mappings
  for all using (auth.uid() = broker_id) with check (auth.uid() = broker_id);

-- -----------------------------------------------------------------------------
-- listings.external_id Index für Re-Import-Dedup
-- -----------------------------------------------------------------------------

create index if not exists listings_external_id_idx on listings(source, external_id)
  where external_id is not null;

-- -----------------------------------------------------------------------------
-- bulk_upsert_listings — RPC für Bulk-Insert/Update
-- -----------------------------------------------------------------------------
-- Erwartetes Input-JSON (Array):
-- [
--   {
--     "type": "rent" | "sale",
--     "location_city": text,
--     "location_district": text|null,
--     "price": numeric,
--     "currency": char(3),
--     "rooms": int,
--     "size_sqm": int|null,
--     "contact_name": text|null,
--     "contact_phone": text|null,        -- Klartext, wird hier verschlüsselt
--     "contact_channel": text|null,
--     "language": text|null,             -- de|en|ru|el
--     "external_id": text|null,
--     "media": text[]|null,
--     "dedup_hash": text                 -- vom Caller berechnet
--   },
--   ...
-- ]
--
-- Response: { inserted, updated, failed: [{index, reason}] }

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
begin
  -- Auth: nur der Broker selbst oder service_role darf importieren
  if v_caller is not null and v_caller != p_broker_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- Pepper aus app-setting holen (optional; wenn leer, kein Encrypt)
  v_phone_pepper := nullif(current_setting('app.contact_pepper', true), '');

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
      -- Phone-Verschlüsselung wenn Pepper konfiguriert
      v_phone_enc := null;
      if v_phone_pepper is not null and (v_row->>'contact_phone') is not null then
        v_phone_enc := pgp_sym_encrypt(v_row->>'contact_phone', v_phone_pepper);
      end if;

      insert into listings (
        source, type, status,
        location_city, location_district, location_raw,
        price, currency, price_period,
        rooms, size_sqm,
        contact_name, contact_phone_enc, contact_channel,
        language, external_id, media,
        owner_user_id, dedup_hash,
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
