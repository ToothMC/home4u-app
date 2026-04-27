-- image_hashes für User-eingereichte Scam-Checks (Spec B §15 B3).
-- listing_id wird nullable; scam_check_id kommt dazu.
-- Constraint: genau eines von beidem muss gesetzt sein.
--
-- Score-Engine (lib/scam/score.ts findDuplicateImageListings) muss die
-- Query auf listing_id is not null einschränken, sonst würden
-- User-Submissions sich gegenseitig flaggen.

-- 1) Surrogate-PK einführen, alte Composite-PK ablösen
alter table image_hashes add column if not exists id uuid default uuid_generate_v4();
update image_hashes set id = uuid_generate_v4() where id is null;
alter table image_hashes alter column id set not null;
alter table image_hashes drop constraint if exists image_hashes_pkey;
alter table image_hashes add primary key (id);

-- 2) listing_id darf jetzt NULL sein
alter table image_hashes alter column listing_id drop not null;

-- 3) scam_check_id ergänzen
alter table image_hashes add column if not exists scam_check_id uuid
  references scam_checks(id) on delete cascade;

create index if not exists image_hashes_scam_check_idx
  on image_hashes(scam_check_id) where scam_check_id is not null;

-- 4) Genau eine der beiden Referenzen muss gesetzt sein
alter table image_hashes drop constraint if exists image_hashes_owner_present;
alter table image_hashes add constraint image_hashes_owner_present
  check (
    (listing_id is not null and scam_check_id is null)
    or (listing_id is null and scam_check_id is not null)
  );

-- 5) Idempotenz pro (owner, phash)
create unique index if not exists image_hashes_listing_phash_uidx
  on image_hashes(listing_id, phash) where listing_id is not null;
create unique index if not exists image_hashes_check_phash_uidx
  on image_hashes(scam_check_id, phash) where scam_check_id is not null;
