-- Scam-Index-Backbone (Indexer-Spec v2.0 §2.2 / §6).
-- Score + Flags + Confidence direkt auf listings, damit Match-RPC (§7.2)
-- ohne Join filtern kann. Neue Spalten sind nullable / haben Defaults,
-- damit alle bestehenden 0–N Listings unverändert weiterleben.
--
-- scam_score:         0.0 (sauber) ... 1.0 (sicher Scam). Default 0.0 = "nicht geprüft".
-- scam_flags:         Liste der ausgelösten Heuristiken (Indexer-Spec §6.2).
-- scam_checked_at:    wann die Score-Engine das letzte Mal gelaufen ist.
-- confidence:         0.0–1.0, wie sicher die LLM-/Heuristik-Extraktion war.
-- extracted_data:     LLM-Rohextraktion für Re-Processing ohne Re-Crawl.
-- contact_phone_hash: sha256(E.164) — Voraussetzung für Heuristik
--                     "duplicate_images" (§6.2: pHash + anderes Phone-Hash).
--                     0021 reicht den Hash schon im Bulk-Upsert-Input mit, hat
--                     ihn aber nicht persistiert — das ändert sich hier.

alter table listings add column if not exists scam_score float not null default 0.0;
alter table listings add column if not exists scam_flags text[] not null default '{}';
alter table listings add column if not exists scam_checked_at timestamptz;
alter table listings add column if not exists confidence float;
alter table listings add column if not exists extracted_data jsonb;
alter table listings add column if not exists contact_phone_hash text;

-- Plausibilität: Score-Werte im Bereich [0, 1].
alter table listings drop constraint if exists listings_scam_score_range;
alter table listings add constraint listings_scam_score_range
  check (scam_score >= 0.0 and scam_score <= 1.0);

alter table listings drop constraint if exists listings_confidence_range;
alter table listings add constraint listings_confidence_range
  check (confidence is null or (confidence >= 0.0 and confidence <= 1.0));

-- Suchindex für die Match-RPC (§7.2 Filter scam_score < 0.5).
-- Partial-Index spart Speicher, weil 0.0-Defaults dominieren werden.
create index if not exists listings_scam_score_idx on listings(scam_score)
  where scam_score > 0.0;

-- GIN für Flag-Recherche im Admin-Dashboard.
create index if not exists listings_scam_flags_gin on listings using gin (scam_flags);

-- Phone-Hash-Index für Cross-Listing-Lookups (Score-Engine §6.2).
create index if not exists listings_contact_phone_hash_idx on listings(contact_phone_hash)
  where contact_phone_hash is not null;
