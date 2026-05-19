-- Follow-up zu 20260519120000: ohne Index scannte compute_listing_market_position
-- die ganze listings-Tabelle (~80k) pro Row, ~120ms/Aufruf. Backfill von 80k
-- Rows haette > 2h gebraucht und hat die service_role-statement_timeout (8s
-- vererbt vom authenticator) gerissen.
--
-- Loesung: funktionaler Index auf den Compset-Schluessel + expliziter
-- statement_timeout im Chunk-Helper.

create index if not exists listings_market_compset_idx
on public.listings (
  type,
  lower(location_city),
  _property_type_group(property_type)
)
where status='active' and size_sqm is not null and size_sqm >= 5
  and price is not null and price > 0;

create or replace function public.recompute_market_positions_chunk(p_limit int default 1000)
returns int
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '5min'
as $$
declare
  v_id uuid;
  v_count int := 0;
  v_cutoff timestamptz := now();
begin
  for v_id in
    select id from listings
    where status = 'active'
      and (market_updated_at is null or market_updated_at < v_cutoff)
    order by market_updated_at nulls first
    limit p_limit
    for update skip locked
  loop
    perform public.compute_listing_market_position(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
