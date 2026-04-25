-- Cache für Nominatim-Anfragen — vermeidet wiederholte Aufrufe an OSM.
-- Nominatim hat 1 req/sec Rate-Limit, viele Listings teilen sich aber den
-- selben Bezirk → Cache liefert sub-millisecond, OSM-load fast null.

create table if not exists geocode_cache (
  query_key text primary key,
  lat double precision,
  lng double precision,
  display_name text,
  hit_count int not null default 1,
  not_found boolean not null default false,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now()
);

create index if not exists geocode_cache_used_idx on geocode_cache(last_used desc);

alter table geocode_cache enable row level security;
revoke all on table geocode_cache from public, anon, authenticated;
