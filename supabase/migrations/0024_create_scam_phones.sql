-- scam_phones: bekannte Scam-Telefonnummern, gehasht (sha256 über E.164).
-- Wird von der Score-Engine (lib/scam/score.ts §6.2 "known_scam_phone") gegen
-- listings.contact_phone_hash und gegen User-Submits geprüft.
--
-- Wichtig: kein Klartext. Phone wird vom Caller in E.164 normalisiert,
-- dann sha256-gehasht. Der Hash ist der PK.
--
-- Quellen:
--   'manual'   – Operator pflegt ein
--   'reported' – User-Report aus Scam-Shield-UX (Spec B)
--   'crawl'    – Cross-Match-Heuristik (gleiche Phone in 3+ price-Anomalien)

create table if not exists scam_phones (
  phone_hash text primary key,                 -- sha256(E.164), hex
  source text not null check (source in ('manual', 'reported', 'crawl')),
  reason text,
  reported_at timestamptz not null default now(),
  reporter_user_id uuid references auth.users(id) on delete set null,
  evidence_listing_ids uuid[] not null default '{}'
);

create index if not exists scam_phones_source_idx on scam_phones(source, reported_at desc);

alter table scam_phones enable row level security;
-- Lese-Zugriff: keine public policy → nur service_role (Score-Engine läuft
-- service-side). Owner sehen ihre eigenen Reports nicht hier, sondern
-- in scam_checks (Spec B).
