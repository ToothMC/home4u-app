-- 20260429160000_outreach_log.sql
--
-- Slice 3a: Outreach-Audit-Trail + Idempotency.
--
-- Wenn ein Seeker eine Anfrage über Home4U sendet (matches.seeker_interest=true),
-- versucht der Outreach-Mailer den Inserenten zu kontaktieren:
--   - direct-Listings: Email an owner_user_id's notification_email
--   - bridge-Listings (Bazaraki/INDEX): Email an decrypted contact_email_enc
--     ODER WhatsApp an decrypted contact_phone_enc (Slice 3b)
--
-- Diese Tabelle:
--   1. Audit JEDES Outreach-Versuchs (auch failed/bounced) — Compliance
--   2. Idempotency: keine doppelten Mails wenn Seeker mehrfach inquired
--   3. Status-Tracking: Provider-Bounce, Reply-erkannt, Action-Link-geklickt
--
-- Trigger-Mechanik (in dieser Migration NICHT — kommt im API-Code):
--   POST /api/bookmarks/[id]/inquire → seeker_request_match RPC →
--   wenn ok, sofort outreach_send() Server-Action → outreach_log row.

create type outreach_channel as enum ('email', 'whatsapp', 'sms', 'platform_internal');
create type outreach_status as enum (
  'queued',     -- Zeile angelegt, Provider-Send noch nicht versucht
  'sent',       -- Provider hat Annahme bestätigt (z.B. Resend message_id)
  'delivered',  -- Provider-Webhook: zugestellt
  'opened',     -- Empfänger hat geöffnet (optional, nur bei Tracking-Pixel)
  'clicked',    -- Empfänger hat einen Action-Link geklickt
  'replied',    -- Inbox-Reply erkannt (manuell + zukünftig automatisch)
  'bounced',    -- Provider-Webhook: bounce
  'failed',     -- send-Versuch erfolglos (Provider-API-Error, Decrypt-Fehler etc.)
  'skipped'     -- bewusst nicht versendet (z.B. opted_out, no contact data)
);

create table if not exists outreach_log (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid not null references matches(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  channel outreach_channel not null,
  recipient_hash text not null,           -- sha256(normalisierte Email/Phone) — nicht der Klartext
  status outreach_status not null default 'queued',
  provider_message_id text,                -- z.B. Resend message_id, 360dialog message_uuid
  error_reason text,                       -- bei status='failed' oder 'bounced'
  template_key text,                       -- 'inquiry_v1', etc. — für Versions-Tracking
  language text,                           -- 'en'|'de'|'ru'|'el'
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  -- Idempotency: pro (match_id, channel, recipient_hash) max ein Eintrag pro 24h
  unique (match_id, channel, recipient_hash)
);

create index if not exists outreach_log_listing_idx on outreach_log(listing_id, created_at desc);
create index if not exists outreach_log_status_idx on outreach_log(status) where status in ('queued', 'failed');
create index if not exists outreach_log_provider_msg_idx on outreach_log(provider_message_id)
  where provider_message_id is not null;

alter table outreach_log enable row level security;
-- Kein Public-/Authenticated-Access — service_role only via RPC.

comment on table outreach_log is
  'Audit + Idempotency aller Outreach-Versuche. Enthält keinen Klartext (nur recipient_hash).';

-- ============================================================================
-- record_outreach_attempt — vom API-Code aufgerufen vor dem Provider-Send
-- ============================================================================
-- Pattern: queue → send → update.
-- Liefert {ok, log_id, already_sent: bool} — wenn already_sent=true ist eine
-- frühere queued/sent-Zeile da, Caller skippt den Send.

create or replace function public.record_outreach_attempt(
  p_match_id uuid,
  p_listing_id uuid,
  p_channel outreach_channel,
  p_recipient_hash text,
  p_template_key text default null,
  p_language text default 'en'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing record;
  v_id uuid;
begin
  -- Schon ein Versuch in den letzten 24h für gleiche (match, channel, recipient)?
  select id, status, created_at into v_existing
    from outreach_log
    where match_id = p_match_id
      and channel = p_channel
      and recipient_hash = p_recipient_hash
      and created_at > now() - interval '24 hours'
    order by created_at desc
    limit 1;

  if v_existing.id is not null and v_existing.status not in ('failed', 'bounced') then
    return jsonb_build_object(
      'ok', true,
      'already_sent', true,
      'log_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  insert into outreach_log (
    match_id, listing_id, channel, recipient_hash, status,
    template_key, language
  ) values (
    p_match_id, p_listing_id, p_channel, p_recipient_hash, 'queued',
    p_template_key, p_language
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'already_sent', false, 'log_id', v_id);
end
$$;

revoke all on function public.record_outreach_attempt(uuid, uuid, outreach_channel, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_outreach_attempt(uuid, uuid, outreach_channel, text, text, text)
  to service_role;

-- ============================================================================
-- update_outreach_status — Provider-Webhook oder Send-Result
-- ============================================================================

create or replace function public.update_outreach_status(
  p_log_id uuid,
  p_status outreach_status,
  p_provider_message_id text default null,
  p_error_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
begin
  update outreach_log
    set status = p_status,
        provider_message_id = coalesce(p_provider_message_id, provider_message_id),
        error_reason = coalesce(p_error_reason, error_reason),
        sent_at = case when p_status = 'sent' and sent_at is null then v_now else sent_at end,
        delivered_at = case when p_status = 'delivered' and delivered_at is null then v_now else delivered_at end,
        clicked_at = case when p_status = 'clicked' and clicked_at is null then v_now else clicked_at end,
        replied_at = case when p_status = 'replied' and replied_at is null then v_now else replied_at end
    where id = p_log_id;
  return found;
end
$$;

revoke all on function public.update_outreach_status(uuid, outreach_status, text, text)
  from public, anon, authenticated;
grant execute on function public.update_outreach_status(uuid, outreach_status, text, text)
  to service_role;
