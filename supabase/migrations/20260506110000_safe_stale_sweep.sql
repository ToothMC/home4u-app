-- Safe Stale Sweep
-- =================
-- Inzident 2026-05-06: mark_stale_listings hat 18.946 bazaraki-Listings auf
-- 'stale' gesetzt. Ursache: der Bazaraki-Crawler war zwischen 28.04. und 06.05.
-- nur sehr partiell durchgelaufen (~100-600 Listings/Tag statt ~19k). Niemand
-- hat es gemerkt. Der Daily-Sweep um 03:00 UTC hat dann alles >7d unseen
-- pauschal gestale-t — formal korrekt, faktisch katastrophal.
--
-- Fix: zwei Guards in mark_stale_listings, die einen kaputten/unvollständigen
-- Crawler erkennen und den Sweep ABBRECHEN, bevor er Schaden anrichtet:
--
--   1) Recent-Activity-Guard (optional, p_min_recent_seen=NULL → skip): in den
--      letzten 24h muss die Source mindestens p_min_recent_seen Listings
--      ge-`last_seen` haben. Sonst → kein Sweep. Der Caller (run-mark-stale.ts)
--      setzt das pro Source explizit; alte Crawler-internal-Aufrufe ohne den
--      Param werden nur durch Cap geschützt.
--   2) Safety-Cap (immer aktiv): der Sweep darf nicht mehr als p_max_pct Prozent
--      der aktuell aktiven Listings auf einmal stale setzen. Sonst → kein Sweep.
--      Default 10. Der Inzident hätte 53% gekillt → der Cap allein hätte den
--      Schaden verhindert.
--
-- Bei Verletzung: RAISE EXCEPTION → RPC-Aufruf failed → Caller exit 1 →
-- GitHub-Action wird rot → wir kriegen Mail.

create or replace function public.mark_stale_listings(
  p_stale_days int default 7,
  p_source text default 'bazaraki',
  p_min_recent_seen int default null,
  p_max_pct numeric default 10.0
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_seen  int;
  v_active_total int;
  v_to_stale     int;
  v_pct          numeric;
  v_count        int;
begin
  -- Guard 1: Recent-Activity (optional). Ohne frischen Crawl ist jeder Sweep blind.
  if p_min_recent_seen is not null then
    select count(*)
      into v_recent_seen
      from listings
     where source::text = p_source
       and last_seen > now() - interval '24 hours';

    if v_recent_seen < p_min_recent_seen then
      raise exception 'mark_stale_listings ABORT (%): nur % listings in letzten 24h gesehen (min %). Crawler-Health prüfen.',
        p_source, v_recent_seen, p_min_recent_seen;
    end if;
  end if;

  -- Kandidaten + aktuellen active-Bestand zählen, vor dem Update.
  select count(*) into v_to_stale
    from listings
   where source::text = p_source
     and status = 'active'
     and last_seen < now() - (p_stale_days || ' days')::interval;

  select count(*) into v_active_total
    from listings
   where source::text = p_source
     and status = 'active';

  -- Guard 2: Safety-Cap. Massensterben verhindern.
  if v_active_total > 0 then
    v_pct := (v_to_stale::numeric * 100.0) / v_active_total::numeric;
    if v_pct > p_max_pct then
      raise exception 'mark_stale_listings ABORT (%): würde % von % active stale setzen (% %%, max % %%). Vermutlich Crawler-Lücke — manuell prüfen und ggf. mit höherem p_max_pct erneut aufrufen.',
        p_source, v_to_stale, v_active_total, round(v_pct, 1), p_max_pct;
    end if;
  end if;

  -- Beide Guards passiert → Sweep ausführen.
  update listings
     set status = 'stale', updated_at = now(), status_changed_at = now()
   where source::text = p_source
     and status = 'active'
     and last_seen < now() - (p_stale_days || ' days')::interval;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.mark_stale_listings(int, text, int, numeric) from public;
grant execute on function public.mark_stale_listings(int, text, int, numeric) to service_role;

-- Alte 2-arg-Signatur entfernen, damit Caller auf neue Defaults zwingen.
-- (Caller in scripts/run-mark-stale.ts und bazaraki-crawler/src/supabase_writer.py
--  rufen mit named args p_stale_days/p_source — die matchen weiterhin.)
drop function if exists public.mark_stale_listings(int, text);

comment on function public.mark_stale_listings(int, text, int, numeric) is
  'Setzt active→stale für Listings die seit p_stale_days nicht mehr last_seen wurden. '
  'Guards: aborts wenn <p_min_recent_seen Listings in 24h gesehen wurden ODER der Sweep '
  'mehr als p_max_pct%% des active-Bestands killen würde. Default: 1000/24h, 10%%.';


-- Helfer: Crawler-Health-Snapshot pro Source. Wird vom täglichen
-- crawler-health-check Workflow gelesen.
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
  where source::text in ('bazaraki', 'index_cy', 'cyprus_real_estate', 'cy_developer')
  group by source
  order by source;
$$;

revoke all on function public.crawler_health_snapshot() from public;
grant execute on function public.crawler_health_snapshot() to service_role;

comment on function public.crawler_health_snapshot() is
  'Health-Snapshot pro Crawler-Source: Active/Stale-Counts, last_seen-Latenz. '
  'Vom täglichen crawler-health-check Workflow gelesen.';
