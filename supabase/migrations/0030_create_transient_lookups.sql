-- Transient-Lookup-Cache (Indexer-Spec v2.0 §5).
--
-- Wenn match_listings_for_profile zu wenig Treffer liefert (< N_MIN), holt
-- der Transient-Lookup live von externen Quellen (Bazaraki-Search-URL) ohne
-- in `listings` zu persistieren — Sophie zeigt sie als "live, noch nicht im
-- Index". Persistierung passiert erst, wenn der Nutzer "interessiert"
-- markiert (separater Flow, nicht Teil dieses Caches).
--
-- Cache-Schlüssel ist ein deterministischer Hash der Profil-Shape (city,
-- type, rooms, price-range), damit identische Suchen sich den HTTP-Roundtrip
-- innerhalb des TTL sparen.

create table if not exists transient_lookups (
  profile_hash text not null,                   -- sha256(profile-shape) hex
  source text not null,                          -- 'bazaraki' (weitere später)
  candidates jsonb not null,                     -- [{external_id, type, city, ...}]
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  fetch_status text not null default 'ok',       -- 'ok' | 'rate_limited' | 'error'
  primary key (profile_hash, source)
);

create index if not exists transient_lookups_expires_idx
  on transient_lookups(expires_at);

alter table transient_lookups enable row level security;
-- Nur service_role schreibt/liest — Sophie-API-Pfad läuft mit service-Client.

-- Aufräumer: löscht abgelaufene Cache-Einträge. Cron stündlich oder
-- vor jedem Lookup-Lauf (sehr günstig, expires_at-Index).
create or replace function public.purge_expired_transient_lookups()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from transient_lookups where expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_expired_transient_lookups() from public;
grant execute on function public.purge_expired_transient_lookups() to service_role;
