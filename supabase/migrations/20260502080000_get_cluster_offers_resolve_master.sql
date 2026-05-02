-- 20260502080000_get_cluster_offers_resolve_master.sql
--
-- Bug nach Variante B: get_cluster_offers(p_canonical_id) erwartete strikt
-- die Cluster-Master-UUID. Frontend (ClusterOffersBlock) übergibt aber die
-- aktuell angezeigte listing.id — bei Variante A immer = Master (weil nur
-- Leader sichtbar waren), bei Variante B kann das ein Member sein.
--
-- Folge: User sieht Match-Card "auch bei 5 anderen Anbietern", klickt rein,
-- der Block findet aber nur sich selbst (offers.length=1) und rendert
-- nichts. Die 5 Anbieter sind unauffindbar.
--
-- Fix: RPC akzeptiert jede listing.id und resolved intern den Master via
-- coalesce(canonical_id, id). Parameter umbenannt zu p_listing_id für
-- Klarheit. is_canonical bedeutet jetzt "ist das aktuell angezeigte
-- Listing" (matcht Frontend-Semantik "shownHere").

drop function if exists public.get_cluster_offers(uuid);

create or replace function public.get_cluster_offers(p_listing_id uuid)
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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_master uuid;
begin
  -- Master-UUID auflösen: wenn p_listing_id Leader → master = p_listing_id,
  -- wenn p_listing_id Member → master = canonical_id, wenn Singleton →
  -- master = p_listing_id (canonical_id IS NULL → coalesce gibt id).
  select coalesce(l.canonical_id, l.id) into v_master
  from public.listings l where l.id = p_listing_id;

  if v_master is null then return; end if;

  return query
  select
    l.id, l.source, l.external_id, l.price, l.currency, l.contact_channel,
    (l.id = p_listing_id) as is_canonical,  -- "ist das aktuell angezeigte"
    l.last_seen,
    (extract(epoch from (now() - l.last_seen))::int / 86400) as days_since_seen
  from public.listings l
  where l.status = 'active'
    and (l.id = v_master or l.canonical_id = v_master)
    and l.last_seen > now() - interval '5 days'
  order by l.price asc nulls last;
end;
$$;

revoke all on function public.get_cluster_offers(uuid) from public, anon;
grant execute on function public.get_cluster_offers(uuid) to authenticated, service_role;

comment on function public.get_cluster_offers(uuid) is
'Liefert alle Cluster-Mitglieder (Master + Member) zum aktuell angezeigten Listing. Akzeptiert jede listing.id, resolved intern den Cluster-Master. is_canonical=true markiert das aktuell angezeigte Listing ("Hier"-Badge im Frontend).';
