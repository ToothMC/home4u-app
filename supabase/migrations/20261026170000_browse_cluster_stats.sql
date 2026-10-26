-- "N ähnliche Inserate · günstigste ab €X" für die Karten auf /stoebern.
--
-- Gleiche Regel wie die Cluster-Statistik in match_listings_for_profile
-- (Sophie-Treffer): Geschwister = aktiv, in den letzten 7 Tagen gesehen
-- (oder direct), gleicher Cluster-Master UND gleiche Stadt, Bezirk, Typ,
-- Zimmerzahl. Die Cluster selbst sind zu grob, um Karten zu verstecken
-- (2026-10-26: 384 Cluster mit je >50 Inseraten, Preisspanne bis 4,5x) —
-- daher nur ein Hinweis, nichts wird ausgeblendet.
--
-- Ein Aufruf pro Seite (max. 100 IDs) statt einer Abfrage pro Karte.
-- cluster_offers_count zählt das Inserat selbst mit (1 = allein), wie in
-- ListingMatch.clusterOffersCount; min_cluster_price schließt den eigenen
-- Preis ein.
create or replace function public.browse_cluster_stats(p_ids uuid[])
returns table (listing_id uuid, cluster_offers_count integer, min_cluster_price numeric)
language sql
stable
security definer
set search_path to 'public'
set statement_timeout to '5s'
as $$
  select l.id,
         1 + coalesce(s.n, 0)::integer,
         least(l.price, s.min_price)
    from listings l
    cross join lateral (
      select count(*) as n, min(sib.price) as min_price
        from listings sib
       where (sib.id = coalesce(l.canonical_id, l.id)
              or sib.canonical_id = coalesce(l.canonical_id, l.id))
         and sib.id <> l.id
         and sib.status = 'active'
         and (sib.source = 'direct' or sib.last_seen > now() - interval '7 days')
         and sib.location_city = l.location_city
         and sib.location_district is not distinct from l.location_district
         and sib.type = l.type
         and coalesce(sib.rooms, -1) = coalesce(l.rooms, -1)
    ) s
   where l.id = any(p_ids[1:100]);
$$;

revoke all on function public.browse_cluster_stats(uuid[]) from public, anon, authenticated;
grant execute on function public.browse_cluster_stats(uuid[]) to service_role;
