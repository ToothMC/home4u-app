-- canonical_id: Cross-Source-Dedup-Cluster (Indexer-Spec v2.0 §2.3).
-- Zwei Listings aus verschiedenen sources, die dasselbe Objekt sind
-- (z.B. derselbe Makler postet auf FB *und* Bazaraki) bekommen das jüngere
-- listing canonical_id = id(älteres). Such-RPC (§7.2) filtert
-- "canonical_id is null OR canonical_id = id", damit Cluster nur einmal
-- in den Treffern auftauchen.
--
-- Erkennung läuft asynchron in einem Cluster-Reconciler (Phase A2 Hook):
--   - identischer pHash auf >=1 Bild (image_hashes-Match)
--   - identische phone_hash + identischer Preis-Bucket (50 €)
--   - manueller Operator-Override (selten)
--
-- Self-reference erlaubt — canonical_id = NULL bedeutet "ist selbst kanonisch".

alter table listings add column if not exists canonical_id uuid
  references listings(id) on delete set null;

-- Self-reference darf nicht auf den Eintrag selbst zeigen — das wäre
-- semantisch == NULL, aber lädt zu falschen Filtern ein.
alter table listings drop constraint if exists listings_canonical_not_self;
alter table listings add constraint listings_canonical_not_self
  check (canonical_id is null or canonical_id <> id);

create index if not exists listings_canonical_idx on listings(canonical_id)
  where canonical_id is not null;

-- Convenience-View: nur kanonische Listings (für Sophie-Suche und AI-Native).
-- AI-Native (Spec D) zieht später noch scam_score < 0.5 als Filter dazu.
create or replace view canonical_listings as
select * from listings
where status = 'active'
  and canonical_id is null;

-- View erbt RLS von listings (security_invoker).
alter view canonical_listings set (security_invoker = on);
