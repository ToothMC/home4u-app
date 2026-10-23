-- Crawler: bekannte external_ids paketweise abfragen statt alle vorab zu laden.
--
-- Vorher luden BSC- und INDEX-Crawler alle bekannten IDs per
-- `?source=eq.X&select=external_id&order=external_id` (Offset-Paging). Ohne
-- `external_id IS NOT NULL` greift der partielle listings_external_id_idx
-- nicht → jede Seite war ein Seq Scan über die ganze Tabelle → Timeout →
-- "fallback full" → last_seen wurde nie aufgefrischt → mark-stale-Gate
-- (max 10 %) brach seit 2026-05-25 täglich ab.
--
-- `source = p_source::listing_source` (statt source::text = p_source), damit
-- der Index auf (source, external_id) beide Spalten als Index Cond nutzt.

-- Nur nachschlagen (BSC: Sitemap enthält auch archivierte Inserate, daher
-- ist "in der Sitemap" KEIN Lebenszeichen und es wird nicht getoucht).
create or replace function public.listings_known_external_ids(
  p_source text, p_external_ids text[]
) returns setof text
language sql stable security definer
set search_path = public
set statement_timeout = '60s'
as $$
  select external_id from listings
   where source = p_source::listing_source
     and external_id is not null
     and external_id = any(p_external_ids)
$$;

-- Nachschlagen + last_seen auffrischen (INDEX.cy: Sitemap = nur aktive).
-- Höchstens einmal pro ~20 h pro Zeile: jedes UPDATE ist non-HOT
-- (last_seen steckt in listings_health_snapshot_idx) und schreibt in alle
-- Indizes — 4 Läufe/Tag × alle Inserate wäre unnötige Disk-Last.
create or replace function public.touch_known_listings(
  p_source text, p_external_ids text[]
) returns setof text
language plpgsql security definer
set search_path = public
set statement_timeout = '60s'
as $$
begin
  update listings
     set last_seen = now(), updated_at = now()
   where source = p_source::listing_source
     and external_id is not null
     and external_id = any(p_external_ids)
     and last_seen < now() - interval '20 hours';

  return query
    select external_id from listings
     where source = p_source::listing_source
       and external_id is not null
       and external_id = any(p_external_ids);
end;
$$;

-- Vom Crawler auf der Detailseite VERIFIZIERT archivierte Inserate stilllegen
-- (BSC: kein €-Preis im Title oder HTTP 404/410). Reversibel: ein späterer
-- Upsert setzt status wieder auf 'active'.
create or replace function public.mark_listings_stale_by_ids(
  p_source text, p_external_ids text[]
) returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare v_count int;
begin
  update listings
     set status = 'stale', updated_at = now(), status_changed_at = now()
   where source = p_source::listing_source
     and external_id is not null
     and external_id = any(p_external_ids)
     and status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.listings_known_external_ids(text, text[]) from public, anon, authenticated;
revoke all on function public.touch_known_listings(text, text[]) from public, anon, authenticated;
revoke all on function public.mark_listings_stale_by_ids(text, text[]) from public, anon, authenticated;
grant execute on function public.listings_known_external_ids(text, text[]) to service_role;
grant execute on function public.touch_known_listings(text, text[]) to service_role;
grant execute on function public.mark_listings_stale_by_ids(text, text[]) to service_role;
