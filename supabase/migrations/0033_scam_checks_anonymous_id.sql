-- scam_checks.anonymous_id für Free-Tier-Quota anonymer User
-- (Scam-Shield-Spec §7.2 / §8). Analog zu search_profiles.anonymous_id
-- (Migration 0002), damit der gleiche Sessions-Cookie home4u_sid sowohl
-- Profile als auch Scam-Checks identifiziert.
--
-- Quota-Count: SELECT count(*) FROM scam_checks
--              WHERE submitted_at >= now() - interval '30 days'
--                AND (user_id = $1 OR anonymous_id = $2);

alter table scam_checks add column if not exists anonymous_id text;

create index if not exists scam_checks_anon_idx
  on scam_checks(anonymous_id, submitted_at desc)
  where anonymous_id is not null;

-- Owner-Read-Policy für anon-Reads via cookie (User reads own anon checks).
-- Hier nicht serverseitig durchsetzbar (Cookie != JWT-claim), darum nutzen
-- alle Reads den service_role im API-Pfad. Keine zusätzliche RLS nötig.

-- Mindestens eine ID muss gesetzt sein — sonst können wir den Check nicht
-- zählen oder zuordnen. Bestehende Zeilen (gibt's noch keine) sind safe.
alter table scam_checks drop constraint if exists scam_checks_owner_present;
alter table scam_checks add constraint scam_checks_owner_present
  check (user_id is not null or anonymous_id is not null);
