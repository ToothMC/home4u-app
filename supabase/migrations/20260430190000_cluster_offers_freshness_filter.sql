-- 20260430190000_cluster_offers_freshness_filter.sql
--
-- Cluster-Offers-Block soll keine "toten" Listings mehr anzeigen.
-- Bazaraki redirectet auf eine Search-Page wenn ein Listing gelöscht
-- wurde — der User klickt unseren Cluster-Anbieter-Link und landet
-- auf einer Suchseite statt auf dem Inserat.
--
-- Filter: nur Listings die der Crawler in den letzten 5 Tagen gesehen
-- hat (last_seen > now() - 5 days). Plus: Returns enthält jetzt
-- last_seen + days_since_seen, damit das Frontend optional einen
-- "zuletzt gesehen vor X Tagen"-Indikator zeigen kann.

drop function if exists public.get_cluster_offers(uuid);

create or replace function public.get_cluster_offers(p_canonical_id uuid)
returns table (
  listing_id uuid,
  source listing_source,
  external_id text,
  price numeric,
  currency character,
  contact_channel text,
  is_canonical boolean,
  last_seen timestamptz,
  days_since_seen int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id, l.source, l.external_id, l.price, l.currency, l.contact_channel,
    (l.id = p_canonical_id) as is_canonical,
    l.last_seen,
    extract(epoch from (now() - l.last_seen))::int / 86400 as days_since_seen
  from listings l
  where l.status = 'active'
    and (l.id = p_canonical_id or l.canonical_id = p_canonical_id)
    and l.last_seen > now() - interval '5 days'
  order by l.price asc nulls last;
$$;

revoke all on function public.get_cluster_offers(uuid) from public, anon;
grant execute on function public.get_cluster_offers(uuid) to authenticated, service_role;
