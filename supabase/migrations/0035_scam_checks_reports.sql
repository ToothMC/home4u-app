-- Reporter-Flow für Scam-Shield (Spec B §9.3 + §15 B4).
-- User klickt "Inserat als Scam melden" → 2 Dinge passieren:
--   1) scam_checks: reported_at + reported_reasons gesetzt
--   2) scam_phones: phone_hash upsert mit source='reported' (falls Phone bekannt)
--
-- Damit: dieselbe Phone in 3+ verschiedenen Reports → wachsender Cross-Listing-
-- Effekt im Score-Engine (known_scam_phone-Heuristik, +0.40).

alter table scam_checks add column if not exists reported_at timestamptz;
alter table scam_checks add column if not exists reported_reasons text[];

create index if not exists scam_checks_reported_idx
  on scam_checks(reported_at desc) where reported_at is not null;

-- scam_phones existiert schon (Migration 0024) mit source-enum incl. 'reported'.
-- Wir brauchen aber: bei Konflikt (gleicher phone_hash schon mal gemeldet)
-- einfach evidence_listing_ids erweitern statt zu failen. Helper-RPC für
-- atomaren Upsert.

create or replace function public.report_scam_phone(
  p_phone_hash text,
  p_reason text default null,
  p_reporter_user_id uuid default null,
  p_evidence_listing_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into scam_phones (phone_hash, source, reason, reporter_user_id, evidence_listing_ids)
  values (
    p_phone_hash,
    'reported',
    p_reason,
    p_reporter_user_id,
    case when p_evidence_listing_id is not null then array[p_evidence_listing_id] else '{}'::uuid[] end
  )
  on conflict (phone_hash) do update set
    -- Reason zusammenführen, älteste Quelle behalten
    reason = coalesce(scam_phones.reason, excluded.reason),
    -- evidence-Listen vereinen, ohne Duplikate
    evidence_listing_ids = (
      select array(select distinct unnest(scam_phones.evidence_listing_ids || excluded.evidence_listing_ids))
    ),
    -- reported_at NICHT überschreiben (älteste Meldung gewinnt)
    reported_at = scam_phones.reported_at;
end;
$$;

revoke all on function public.report_scam_phone(text, text, uuid, uuid) from public;
grant execute on function public.report_scam_phone(text, text, uuid, uuid) to service_role;
