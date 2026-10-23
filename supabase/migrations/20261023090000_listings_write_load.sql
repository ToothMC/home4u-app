-- Schreiblast auf listings senken (Micro-Instanz, 1 GB RAM, gedrosselte Disk).
--
-- Gemessen (pg_stat_statements seit 2026-04-30): 51 Mio. Updates auf 255k
-- Zeilen, nur 42 % HOT. Größter Verursacher touch_listings_last_seen
-- (Bazaraki/CRE/Dev-Crawler, 4×/Tag für alle bekannten Inserate):
-- 54k Aufrufe, 47 Mio. dirtied Blocks — mehr als alle anderen zusammen.

-- 1) Touch höchstens einmal pro ~20 h pro Zeile. Für den 14-Tage-Stale-
--    Cutoff und den 24-h-Health-Check reicht 1×/Tag. source per Enum-Cast
--    vergleichen, damit (source, external_id) als Index Cond greift.
create or replace function public.touch_listings_last_seen(p_source text, p_external_ids text[])
returns integer
language plpgsql security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_count int;
begin
  if p_external_ids is null or array_length(p_external_ids, 1) is null then
    return 0;
  end if;

  update listings
     set last_seen = now(),
         updated_at = now()
   where source = p_source::listing_source
     and external_id is not null
     and external_id = any(p_external_ids)
     and last_seen < now() - interval '20 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 2) Health-Snapshot (1×/Tag) bekommt Luft.
alter function public.crawler_health_snapshot() set statement_timeout = '180s';

-- 3) Platz für HOT-Updates in neu geschriebenen Seiten.
alter table public.listings set (fillfactor = 90);

-- 4) Indizes ohne einen einzigen Scan seit 2026-04-30 (Projektstart).
--    Jeder wurde trotzdem bei jedem non-HOT-Update mitgeschrieben.
--    listings_health_snapshot_idx bleibt: mark_stale_listings und
--    crawler_health_snapshot zählen darüber (27 MB statt 436 MB Heap).
drop index concurrently if exists public.listings_market_pos_idx;
drop index concurrently if exists public.listings_scam_flags_gin;
drop index concurrently if exists public.listings_scam_score_idx;
drop index concurrently if exists public.listings_embedding_idx;
drop index concurrently if exists public.listings_contact_phone_country_idx;
