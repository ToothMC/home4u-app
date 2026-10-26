-- Recheck-Kandidaten für Crawler, deren Sitemap kein Lebenszeichen ist (BSC).
--
-- Liefert die am längsten nicht gesehenen aktiven Inserate einer Quelle,
-- älteste zuerst, mit gespeicherter Detail-URL und Preis. Der Crawler ruft
-- die Detailseite auf: live → last_seen frisch (Touch oder Upsert),
-- gelöscht → mark_listings_stale_by_ids.
--
-- Warum nicht über die Sitemap: Stichprobe 2026-10-26 — ~27 % der aktiven
-- BSC-Inserate stehen in keiner der 11 Sitemaps, 36 von 40 davon waren auf
-- BSC aber live. Die Sitemap ist unvollständig, also kein Löschsignal.
--
-- p_min_age: nur Inserate, die mindestens so lange nicht gesehen wurden.
-- Kosten: ~3 s (Top-N-Sort über ~115k BSC-Zeilen), ein Aufruf pro Lauf.
create or replace function public.listings_recheck_candidates(
  p_source  text,
  p_min_age interval default interval '0',
  p_limit   integer  default 3000
)
returns table (external_id text, source_url text, price numeric, last_seen timestamptz)
language sql
stable
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
  select l.external_id,
         l.extracted_data->>'source_url',
         l.price::numeric,
         l.last_seen
    from listings l
   where l.source = p_source::listing_source
     and l.status = 'active'
     and l.external_id is not null
     and l.last_seen < now() - p_min_age
   order by l.last_seen asc, l.external_id
   limit greatest(0, least(p_limit, 20000));
$$;

revoke all on function public.listings_recheck_candidates(text, interval, integer) from public, anon, authenticated;
grant execute on function public.listings_recheck_candidates(text, interval, integer) to service_role;
