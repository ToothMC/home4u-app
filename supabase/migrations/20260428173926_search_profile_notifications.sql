-- Sync der bereits in der DB angewandten Migration (über MCP gepusht).
-- Lokal nachgezogen, damit `supabase db diff` und CI-Migrations konsistent
-- bleiben.
--
-- Inhalt: Notify-Flag + last_notified_at auf search_profiles, plus
-- notification_log-Tabelle (eine Zeile pro versendeter Benachrichtigung).
-- Channel ist offen für 'email' | 'web_push' | 'telegram'; aktuell schreibt
-- nur scripts/notify-new-matches.ts (Email).

alter table search_profiles
  add column if not exists notify_new_matches boolean not null default true;

alter table search_profiles
  add column if not exists last_notified_at timestamptz not null default now();

create index if not exists search_profiles_notify_idx
  on search_profiles(notify_new_matches, last_notified_at)
  where notify_new_matches = true and user_id is not null;

create table if not exists notification_log (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references search_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'web_push', 'telegram')),
  listing_ids uuid[] not null,
  sent_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  error_message text
);

create index if not exists notification_log_user_idx
  on notification_log(user_id, sent_at desc);

create index if not exists notification_log_profile_idx
  on notification_log(profile_id, sent_at desc);

alter table notification_log enable row level security;

create policy "notification_log_select_own"
  on notification_log
  for select
  using (auth.uid() = user_id);
