-- Schema-Erweiterung für die Public-Detail-Page (gemäß Mockup):
-- Adresse + Geo, Warm-/Kalt-Mieten-Trennung, Kaution, Honest-Assessment
-- (Sophie-Vision-Output), Nearby-POIs, externe Asset-URLs (Floorplan/3D/Video).

alter table listings add column if not exists location_address text;
alter table listings add column if not exists lat double precision;
alter table listings add column if not exists lng double precision;
alter table listings add column if not exists price_warm numeric(12,2);
alter table listings add column if not exists price_cold numeric(12,2);
alter table listings add column if not exists deposit numeric(12,2);
alter table listings add column if not exists honest_assessment jsonb;
-- {"pros":[{"title":"...","reason":"..."}], "cons":[{"title":"...","reason":"..."}]}
alter table listings add column if not exists nearby_pois jsonb default '[]'::jsonb;
-- [{"name":"U2 Eberswalder Str.","category":"transit","walking_minutes":6}]
alter table listings add column if not exists floorplan_url text;
alter table listings add column if not exists tour_3d_url text;
alter table listings add column if not exists video_url text;
alter table listings add column if not exists ai_analyzed_at timestamptz;

-- listing_photos: pro-Foto Metadaten (room_type, position, caption).
-- media[] bleibt als Backward-Compat-Quelle. Wenn listing_photos befüllt
-- ist, hat das Vorrang für die Public-Page.
create table if not exists listing_photos (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid not null references listings(id) on delete cascade,
  url text not null,
  room_type text,
  caption text,
  position integer not null default 0,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  unique (listing_id, url)
);

create index if not exists listing_photos_listing_idx
  on listing_photos(listing_id, position);
create index if not exists listing_photos_room_idx
  on listing_photos(listing_id, room_type)
  where room_type is not null;

alter table listing_photos enable row level security;
drop policy if exists "listing_photos_public_read" on listing_photos;
create policy "listing_photos_public_read" on listing_photos
  for select using (
    exists (
      select 1 from listings l
      where l.id = listing_photos.listing_id and l.status = 'active'
    )
  );

drop policy if exists "listing_photos_owner_write" on listing_photos;
create policy "listing_photos_owner_write" on listing_photos
  for all using (
    auth.uid() is not null and exists (
      select 1 from listings l
      where l.id = listing_photos.listing_id and l.owner_user_id = auth.uid()
    )
  ) with check (
    auth.uid() is not null and exists (
      select 1 from listings l
      where l.id = listing_photos.listing_id and l.owner_user_id = auth.uid()
    )
  );

create index if not exists listings_geo_idx on listings(lat, lng)
  where lat is not null and lng is not null;
