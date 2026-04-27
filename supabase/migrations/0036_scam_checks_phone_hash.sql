-- scam_checks.contact_phone_hash für den Reporter-Feedback-Loop (Spec B §9.3).
-- Bei Submit wird der Hash mit persistiert. Beim Report-Klick liest der
-- Endpoint ihn raus und ruft report_scam_phone (Migration 0035) — der Hash
-- landet dann in scam_phones, künftige Submissions mit derselben Phone
-- bekommen automatisch +0.40 known_scam_phone.

alter table scam_checks add column if not exists contact_phone_hash text;

create index if not exists scam_checks_phone_hash_idx
  on scam_checks(contact_phone_hash) where contact_phone_hash is not null;
