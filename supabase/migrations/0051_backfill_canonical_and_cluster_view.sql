-- 0051_backfill_canonical_and_cluster_view.sql
--
-- 1. Backfill canonical_id für bestehende Listings (Bazaraki ~27k +
--    INDEX.cy ~45k + FB), die VOR Migration 0050 reinkamen oder über das
--    alte bulk_upsert_bazaraki_listings (0029, ohne Dedup-Logik).
-- 2. Cluster-View `canonical_clusters` für Observability.
-- 3. Markiert die deprecated source-spezifischen RPCs (0029, 0049).
--
-- Ablauf Backfill:
--   - Iteriert über listings.status='active' WHERE canonical_id IS NULL
--   - Reihenfolge: created_at ASC → ältere Listings werden Canonicals,
--     jüngere zeigen darauf
--   - Für jede Zeile: find_canonical_for_signals mit gespeicherten
--     pHash/phone_hash/Preis-Tupel-Signalen
--   - Setzt canonical_id wenn Match ≠ self
--   - Idempotent: Re-Run setzt nichts neu, weil canonical_id IS NULL Filter
--   - Progress-Log alle 1000 Zeilen via RAISE NOTICE
--
-- Schwellwerte sind die von 0048 (pHash Hamming ≤8, Preis ±5%, size ±10%).
-- Konservativ: lieber doppelt insert lassen als falsch mergen.

-- 1. Backfill-Funktion (separat, manuell ausführbar)
create or replace function public.backfill_canonical_ids(
  p_batch_size int default 1000,
  p_max_rows int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing record;
  v_match uuid;
  v_processed int := 0;
  v_canonicalised int := 0;
  v_phash bigint;
begin
  for v_listing in
    select l.id, l.price, l.location_city, l.type, l.property_type,
           l.rooms, l.size_sqm, l.contact_phone_hash,
           ih.phash
    from listings l
    left join image_hashes ih on ih.listing_id = l.id
    where l.status = 'active'
      and l.canonical_id is null
    order by l.created_at asc
    limit coalesce(p_max_rows, 2147483647)
  loop
    v_processed := v_processed + 1;

    v_match := find_canonical_for_signals(
      p_phash := v_listing.phash,
      p_phone_hash := v_listing.contact_phone_hash,
      p_price := v_listing.price,
      p_city := v_listing.location_city,
      p_type := v_listing.type,
      p_property_type := v_listing.property_type,
      p_rooms := v_listing.rooms,
      p_size_sqm := v_listing.size_sqm,
      p_exclude_id := v_listing.id
    );

    if v_match is not null and v_match <> v_listing.id then
      update listings
        set canonical_id = v_match
        where id = v_listing.id
          and canonical_id is null;
      if found then
        v_canonicalised := v_canonicalised + 1;
      end if;
    end if;

    if v_processed % p_batch_size = 0 then
      raise notice 'backfill_canonical_ids progress: % rows processed, % canonicalised',
        v_processed, v_canonicalised;
    end if;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'canonicalised', v_canonicalised
  );
end
$$;

revoke execute on function public.backfill_canonical_ids(int, int)
  from public, anon, authenticated;

comment on function public.backfill_canonical_ids(int, int) is
  'DEPRECATED — Limit-Bug: re-scant immer dieselbe earliest-Window. Nutze backfill_canonical_chunk(p_after_id, p_chunk_size) via GitHub Action.';

-- 1b. Cursor-basierte Variante OHNE Re-Scan-Bug.
-- Iteriert per id-Cursor (id > p_after_id), liefert next_after_id für
-- Pagination. Wird von .github/workflows/backfill-canonical.yml in einer
-- Schleife aufgerufen — kein Browser-Gateway-Timeout.

create or replace function public.backfill_canonical_chunk(
  p_after_id uuid default null,
  p_chunk_size int default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing record;
  v_match uuid;
  v_processed int := 0;
  v_canonicalised int := 0;
  v_last_id uuid := null;
begin
  for v_listing in
    select l.id, l.price, l.location_city, l.type, l.property_type,
           l.rooms, l.size_sqm, l.contact_phone_hash,
           ih.phash
    from listings l
    left join image_hashes ih on ih.listing_id = l.id
    where l.status = 'active'
      and l.canonical_id is null
      and (p_after_id is null or l.id > p_after_id)
    order by l.id asc
    limit p_chunk_size
  loop
    v_processed := v_processed + 1;
    v_last_id := v_listing.id;

    v_match := find_canonical_for_signals(
      p_phash := v_listing.phash,
      p_phone_hash := v_listing.contact_phone_hash,
      p_price := v_listing.price,
      p_city := v_listing.location_city,
      p_type := v_listing.type,
      p_property_type := v_listing.property_type,
      p_rooms := v_listing.rooms,
      p_size_sqm := v_listing.size_sqm,
      p_exclude_id := v_listing.id
    );

    if v_match is not null and v_match <> v_listing.id then
      update listings
        set canonical_id = v_match
        where id = v_listing.id
          and canonical_id is null;
      if found then
        v_canonicalised := v_canonicalised + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'canonicalised', v_canonicalised,
    'next_after_id', v_last_id,
    'done', v_processed < p_chunk_size
  );
end
$$;

revoke execute on function public.backfill_canonical_chunk(uuid, int)
  from public, anon, authenticated;
grant execute on function public.backfill_canonical_chunk(uuid, int)
  to service_role;

comment on function public.backfill_canonical_chunk(uuid, int) is
  'Cursor-paginierter Canonical-Backfill. Caller übergibt next_after_id aus Vorrunde, ruft bis done=true.';

-- 2. Cluster-View für Spot-Checks
create or replace view canonical_clusters as
select
  coalesce(canonical_id, id) as cluster_id,
  count(*) as size,
  array_agg(source order by created_at) as sources,
  array_agg(id order by created_at) as listing_ids,
  min(price) as min_price,
  max(price) as max_price,
  min(created_at) as first_seen,
  max(updated_at) as last_seen
from listings
where status = 'active'
group by coalesce(canonical_id, id)
having count(*) > 1;

alter view canonical_clusters set (security_invoker = on);

comment on view canonical_clusters is
  'Multi-Listing-Cluster (canonical_id-Gruppen). Spot-Check Cross-Source-Dedup: select * from canonical_clusters where ''bazaraki'' = any(sources) and ''index_cy'' = any(sources);';

-- 3. Deprecated RPCs markieren (nicht löschen — Audit-Trail)
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bulk_upsert_bazaraki_listings'
  ) then
    execute 'comment on function public.bulk_upsert_bazaraki_listings(jsonb) is ''DEPRECATED — use bulk_upsert_external_listings(p_source := ''''bazaraki'''', p_rows := …). Behalten für Audit-Trail.''';
  end if;
end $$;
