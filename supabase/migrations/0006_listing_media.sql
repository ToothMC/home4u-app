-- Storage-Bucket für Listing-Medien (Bilder + kurze Videos) + RLS.
-- Bucket ist public-read; Uploads nur von eingeloggten Usern in ihren eigenen
-- Folder ({user_id}/...). Größen-Limits: 50 MB pro Datei (Video deckt alle).

-- Bucket anlegen (idempotent)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-media',
  'listing-media',
  true,
  52428800, -- 50 MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS Policies auf storage.objects für diesen Bucket.
-- Folder-Konvention: {user_id}/{timestamp}-{filename}

drop policy if exists "listing_media_public_read" on storage.objects;
create policy "listing_media_public_read"
  on storage.objects for select
  using (bucket_id = 'listing-media');

drop policy if exists "listing_media_owner_insert" on storage.objects;
create policy "listing_media_owner_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'listing-media'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "listing_media_owner_update" on storage.objects;
create policy "listing_media_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'listing-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "listing_media_owner_delete" on storage.objects;
create policy "listing_media_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'listing-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- listings.media: Array von öffentlichen URLs zu den hochgeladenen Medien.
-- Reihenfolge = Anzeigereihenfolge. Erstes Element = Cover.
alter table listings add column if not exists media text[] default '{}';

-- Optional: Index für Suche nach Listings mit Medien (nice to have)
create index if not exists listings_has_media_idx on listings
  (array_length(media, 1))
  where array_length(media, 1) > 0;
