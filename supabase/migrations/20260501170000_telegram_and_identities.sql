-- 20260501170000_telegram_and_identities.sql
--
-- Multi-Channel-Identity-Foundation für Telegram-first Strategie.
--
-- Bisher:
--   - User-Identität hängt an auth.users (Email-zentriert)
--   - conversations.channel kennt 'web'|'telegram'|'whatsapp', wird aber nur
--     auf 'web' gesetzt
--   - profiles.contact_channel sagt aus, wie der User kontaktiert werden will
--     ('email'|'whatsapp'|'telegram'|'phone'|'chat') — passt perfekt als
--     preferred_channel, kein Duplikat-Feld nötig
--
-- Was diese Migration macht:
--   1. channel_identities — Multi-Channel-Identity (web/telegram/email) mit
--      External-IDs (tg_user_id, web_session_id) und Opt-in/Opt-out
--   2. deeplink_tokens — Single-use-Tokens für Web↔Telegram-Übergänge
--      (Web öffnet Telegram-Bot mit Match-Kontext / Telegram-Bot öffnet Web
--      mit Login)
--   3. profiles.telegram_user_id + telegram_username für Telegram-Login-Widget
--   4. messages-Erweiterung: external_id (tg_message_id), media_urls,
--      location_lat/lng, original_language, translations jsonb

-- ============================================================================
-- 1) channel_identities
-- ============================================================================

create table if not exists channel_identities (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  -- anonymous_id ist text (siehe conversations/search_profiles), kein FK
  anonymous_id text,
  channel text not null check (channel in ('web', 'telegram', 'email')),
  -- E.164 für Phone, tg_user_id (bigint as text) für Telegram, session_id für web
  external_id text not null,
  verified_at timestamptz,
  opt_in_at timestamptz,
  opt_out_at timestamptz,
  last_seen_at timestamptz not null default now(),
  -- {tg_username, language_code, acquisition_source, ...}
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (channel, external_id),
  constraint channel_identities_owner_required
    check ((user_id is not null) or (anonymous_id is not null))
);

create index if not exists channel_identities_user_idx
  on channel_identities(user_id) where user_id is not null;
create index if not exists channel_identities_anon_idx
  on channel_identities(anonymous_id) where anonymous_id is not null;
create index if not exists channel_identities_telegram_idx
  on channel_identities(external_id) where channel = 'telegram';

alter table channel_identities enable row level security;

-- Service-role only — alle Lookups laufen serverseitig (Webhooks + API-Routes)
-- Authenticated User darf seine eigenen Identities lesen, für Settings-UI
create policy "channel_identities_select_own"
  on channel_identities
  for select
  using (auth.uid() = user_id);

comment on table channel_identities is
  'Multi-Channel-Identity pro User. Verbindet auth.users / anonymous_sessions '
  'mit externen IDs (Telegram tg_user_id, Web Session, später WhatsApp Phone).';

-- ============================================================================
-- 2) deeplink_tokens
-- ============================================================================

create table if not exists deeplink_tokens (
  -- 32 hex bytes = 64 hex chars
  token text primary key,
  direction text not null check (direction in ('to_telegram', 'to_web')),
  user_id uuid references auth.users(id) on delete cascade,
  channel_identity_id uuid references channel_identities(id) on delete cascade,
  -- Welche Aktion soll beim Consume passieren?
  intent text not null check (intent in (
    'open_match', 'review_listing', 'view_lead', 'login', 'open_listing'
  )),
  -- {match_id, listing_id, lead_id, ...}
  intent_payload jsonb,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists deeplink_tokens_active_idx
  on deeplink_tokens(expires_at) where used_at is null;

alter table deeplink_tokens enable row level security;
-- Service-role only. Keine direkten Reads — alles via /api/m/[token].

comment on table deeplink_tokens is
  'Single-use-Tokens für nahtlose Web↔Telegram-Übergänge mit Intent-Routing. '
  '15 min TTL üblich; Verbrauch setzt used_at.';

-- ============================================================================
-- 3) profiles: Telegram-spezifische Felder
-- ============================================================================
-- profiles.contact_channel existiert bereits (siehe 0044_profile_contact_fields)
-- und akzeptiert 'telegram' als Wert. Wir nutzen das als preferred_channel.

alter table profiles
  add column if not exists telegram_user_id bigint,
  add column if not exists telegram_username text;

create unique index if not exists profiles_telegram_user_id_uidx
  on profiles(telegram_user_id) where telegram_user_id is not null;

comment on column profiles.telegram_user_id is
  'Telegram User-ID (bigint), gesetzt nach Telegram-Login-Widget oder ersten Bot-Kontakt.';
comment on column profiles.telegram_username is
  'Telegram-Username (mit @), optional — User können ohne Username sein.';

-- ============================================================================
-- 4) messages-Erweiterung: external_id, media, location, translations
-- ============================================================================

alter table messages
  add column if not exists external_id text,
  add column if not exists media_urls text[] not null default '{}',
  add column if not exists location_lat numeric,
  add column if not exists location_lng numeric,
  add column if not exists original_language text
    check (original_language in ('de', 'en', 'ru', 'el')),
  add column if not exists translations jsonb not null default '{}'::jsonb;

-- Idempotenz: Telegram-Webhook-Retries dürfen keine Duplikate erzeugen
create unique index if not exists messages_external_id_unique
  on messages(external_id) where external_id is not null;

comment on column messages.external_id is
  'Externe Message-ID (Telegram tg_message_id, später WhatsApp wa_message_id). '
  'Unique zur Webhook-Idempotenz.';
comment on column messages.translations is
  'Auto-Übersetzungen per Claude Haiku, key=lang code, value=übersetzter Text. '
  'Original liegt in content; original_language sagt welche Sprache content hat.';
