-- Warteschlange für scripts/run-media-check.ts.
--
-- Vorher fragte das Skript per PostgREST
--   media_checked_at IS NULL OR media_checked_at < Stichtag
--   ORDER BY media_checked_at NULLS FIRST
-- Wegen des OR nutzt Postgres listings_media_check_queue_idx nur zum
-- Sortieren und läuft über alle ~240k Einträge: 44 s, PostgREST bricht
-- nach 8 s ab (2026-10-26, Smoke-Lauf mit RECHECK_DAYS=7).
-- Hier zwei getrennte, index-taugliche Teile, eigener Timeout.
--
-- p_recheck_days = 0: nur nie geprüfte. p_offset nur für Trockenläufe
-- (dort wird nichts geschrieben, die Schlange rückt also nicht vor).
create or replace function public.media_check_queue(
  p_source        text    default null,
  p_recheck_days  integer default 0,
  p_limit         integer default 250,
  p_offset        integer default 0
)
returns table (id uuid, media text[])
language sql
stable
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
  select q.id, q.media from (
    (select l.id, l.media, 0 as part, null::timestamptz as checked
       from listings l
      where l.status = 'active'
        and l.media is not null
        and l.media_checked_at is null
        and (p_source is null or l.source = p_source::listing_source)
      limit greatest(0, p_offset + p_limit))
    union all
    (select l.id, l.media, 1, l.media_checked_at
       from listings l
      where p_recheck_days > 0
        and l.status = 'active'
        and l.media is not null
        and l.media_checked_at < now() - make_interval(days => p_recheck_days)
        and (p_source is null or l.source = p_source::listing_source)
      order by l.media_checked_at
      limit greatest(0, p_offset + p_limit))
  ) q
  order by q.part, q.checked, q.id
  offset greatest(0, p_offset)
  limit greatest(0, least(p_limit, 5000));
$$;

revoke all on function public.media_check_queue(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.media_check_queue(text, integer, integer, integer) to service_role;
