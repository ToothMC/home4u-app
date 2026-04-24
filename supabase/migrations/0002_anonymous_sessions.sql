-- Anonymous-Session-Support
-- Chat darf ohne Login starten; später wird eine anonyme Session
-- per Magic-Link-Login zum auth.users-User migriert.

-- conversations: user_id nullable, anonymous_id ergänzen
alter table conversations alter column user_id drop not null;
alter table conversations add column if not exists anonymous_id text;
alter table conversations add column if not exists region_slug text;
alter table conversations add column if not exists region_label text;

create index if not exists conversations_anonymous_idx
  on conversations(anonymous_id)
  where anonymous_id is not null;

-- Entweder user_id oder anonymous_id muss gesetzt sein
alter table conversations
  add constraint conversations_owner_required
  check (user_id is not null or anonymous_id is not null);

-- RLS-Policy für anonyme Reads (per Cookie im API-Handler authentifiziert)
drop policy if exists "conversations_owner_rw" on conversations;
create policy "conversations_user_owner_rw" on conversations
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Anonyme Zugriffe laufen ausschließlich über Service-Role in API-Routes.

-- search_profiles: user_id nullable, anonymous_id ergänzen
alter table search_profiles alter column user_id drop not null;
alter table search_profiles add column if not exists anonymous_id text;

create index if not exists search_profiles_anonymous_idx
  on search_profiles(anonymous_id)
  where anonymous_id is not null;

alter table search_profiles
  add constraint search_profiles_owner_required
  check (user_id is not null or anonymous_id is not null);

-- RLS: registrierte Nutzer sehen ihre eigenen; anonyme gehen via Service-Role
drop policy if exists "search_profiles_owner_rw" on search_profiles;
create policy "search_profiles_user_owner_rw" on search_profiles
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- messages-Policy: auch anonyme via conversation-Ownership nicht notwendig,
-- weil anonymer Zugriff ausschließlich Service-Role nutzt. Policy bleibt strikt.

-- Migration-Pfad: später wird beim Login ein Helfer
-- update conversations set user_id = auth.uid(), anonymous_id = null where anonymous_id = $1
-- gegen die Service-Role-Connection ausgeführt.
