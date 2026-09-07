-- crawler_health_snapshot() lief seit 2026-09-06 im crawler-health-check
-- Workflow mit "canceling statement due to statement timeout" (erbt sonst
-- die 8s statement_timeout von authenticator ueber service_role, siehe
-- 20260519130000). Ausserdem deckte die Funktion nur die 4 urspruenglichen
-- Quellen ab (bazaraki, index_cy, cyprus_real_estate, cy_developer) und
-- haette die 3-monatige BSC-Stille nie gemeldet.
--
-- Fix: expliziter statement_timeout auf der Funktion + Sources-Filter um
-- bsc/fb erweitert + Covering-Index, damit der Snapshot ein Index-Only-Scan
-- bleibt statt Seq-Scan ueber die ganze (>220k Rows) listings-Tabelle.

create index if not exists listings_health_snapshot_idx
  on public.listings (source)
  include (status, last_seen);

create or replace function public.crawler_health_snapshot()
returns table (
  source text,
  active_count bigint,
  stale_count bigint,
  seen_24h bigint,
  seen_7d bigint,
  last_seen_max timestamptz,
  hours_since_last_seen numeric
)
language sql
security definer
set search_path = public
set statement_timeout = '30s'
as $$
  select
    source::text,
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'stale'),
    count(*) filter (where last_seen > now() - interval '24 hours'),
    count(*) filter (where last_seen > now() - interval '7 days'),
    max(last_seen),
    extract(epoch from (now() - max(last_seen))) / 3600.0
  from listings
  where source::text in (
    'bazaraki', 'index_cy', 'cyprus_real_estate', 'cy_developer', 'bsc', 'fb'
  )
  group by source
  order by source;
$$;

revoke all on function public.crawler_health_snapshot() from public;
grant execute on function public.crawler_health_snapshot() to service_role;

comment on function public.crawler_health_snapshot() is
  'Health-Snapshot pro Crawler-Source: Active/Stale-Counts, last_seen-Latenz. '
  'Vom taeglichen crawler-health-check Workflow gelesen. '
  'statement_timeout=30s (eigener Timeout statt geerbter 8s), deckt alle '
  '6 Sources ab (inkl. bsc/fb seit 2026-09-07).';
