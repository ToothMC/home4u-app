-- 20260502090000_get_cluster_offers_with_source_url.sql
--
-- Bug: ClusterOffersBlock-Links landen auf Bazaraki-Suche statt aufs
-- Inserat. buildSourceUrl braucht extracted_data.source_url ODER
-- external_id+title-Slug. Der RPC lieferte aber weder noch — Frontend
-- übergab extracted_data=null und title=undefined → Bazaraki-Fallback
-- /adv/{id}/ ohne Slug → Redirect auf Kategorie.
--
-- Fix: RPC liefert source_url (aus extracted_data) und title direkt mit.
-- Frontend nutzt source_url falls vorhanden, sonst buildSourceUrl-
-- Fallback mit title.

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
  days_since_seen int,
  source_url text,
  title text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_master uuid;
begin
  select coalesce(l.canonical_id, l.id) into v_master
  from public.listings l where l.id = p_listing_id;

  if v_master is null then return; end if;

  return query
  select
    l.id, l.source, l.external_id, l.price, l.currency, l.contact_channel,
    (l.id = p_listing_id) as is_canonical,
    l.last_seen,
    (extract(epoch from (now() - l.last_seen))::int / 86400) as days_since_seen,
    nullif(trim(l.extracted_data->>'source_url'), '') as source_url,
    l.title
  from public.listings l
  where l.status = 'active'
    and (l.id = v_master or l.canonical_id = v_master)
    and l.last_seen > now() - interval '5 days'
  order by l.price asc nulls last;
end;
$$;

revoke all on function public.get_cluster_offers(uuid) from public, anon;
grant execute on function public.get_cluster_offers(uuid) to authenticated, service_role;
