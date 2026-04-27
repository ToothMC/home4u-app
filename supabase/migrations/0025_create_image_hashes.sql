-- image_hashes: pHash pro Bild + Listing-Referenz für Cross-Source-Bild-Match
-- (Indexer-Spec v2.0 §6.2 "duplicate_images"). Pro listing × Bild ein Eintrag.
--
-- pHash ist 64-bit (8 Bytes). Wir speichern als bigint, damit Hamming-Distance
-- via "popcount(a # b)" effizient läuft. Bei Volumen >100k könnte ein
-- pg_trgm- oder bk-tree-Ansatz nötig werden — fürs erste reicht der seq scan
-- mit popcount-Index.
--
-- Konsumenten:
--   - Crawl-Upsert (Bazaraki Iteration 2 + FB) schreibt nach Insert/Update.
--   - Score-Engine sucht: gleicher phash, anderes contact_phone_hash ODER
--     anderer Preis-Bucket ODER anderer location_district → +0.40.
--   - Cross-Source-Cluster (§2.3): identischer pHash auf 2+ Listings aus
--     verschiedenen sources → Kandidat für canonical_id.

create table if not exists image_hashes (
  phash bigint not null,                       -- 64-bit perceptual hash
  listing_id uuid not null references listings(id) on delete cascade,
  media_url text not null,                     -- für Debug/Beweis
  created_at timestamptz not null default now(),
  primary key (phash, listing_id)
);

create index if not exists image_hashes_listing_idx on image_hashes(listing_id);

-- Hamming-Distance-Hilfsfunktion. Postgres hat kein eingebautes popcount für
-- bigint, aber wir können XOR + bit_count() (pg14+) nutzen.
create or replace function public.phash_hamming(a bigint, b bigint)
returns int
language sql
immutable
parallel safe
as $$
  -- bit_count benötigt bit-string oder bytea; cast über int8send
  select bit_count(int8send(a # b))::int;
$$;

alter table image_hashes enable row level security;
-- Kein public read — Score-Engine läuft service-side.
