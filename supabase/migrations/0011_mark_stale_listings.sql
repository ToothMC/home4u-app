-- mark_stale_listings: vom Bazaraki-Crawler nach jedem Lauf aufgerufen.
-- Setzt Listings, die seit N Tagen nicht mehr im Crawl waren, auf 'stale'.
-- Direkt-Inserate (source='direct') werden nie automatisch stale gesetzt —
-- die archiviert der Owner selbst.

create or replace function public.mark_stale_listings(
  p_stale_days int default 7,
  p_source text default 'bazaraki'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update listings
    set status = 'stale', updated_at = now()
    where source::text = p_source
      and status = 'active'
      and last_seen < now() - (p_stale_days || ' days')::interval;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_stale_listings(int, text) from public;
grant execute on function public.mark_stale_listings(int, text) to service_role;
