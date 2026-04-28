-- 0044_profile_contact_fields.sql
--
-- User-Profil bekommt Kontakt-Felder:
--   phone               freier Text, internationales Format empfohlen
--   contact_channel     bevorzugter Kanal für Anfragen
--   notification_email  Override gegenüber auth.users.email — wenn gesetzt,
--                       gehen Match-Benachrichtigungen hierhin
--
-- Plus RLS-Policies, damit User ihr eigenes Profil sehen + bearbeiten dürfen.

alter table profiles
  add column if not exists phone text,
  add column if not exists contact_channel text
    check (contact_channel in ('email', 'whatsapp', 'telegram', 'phone', 'chat')),
  add column if not exists notification_email text;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_update_own'
  ) then
    create policy "profiles_update_own"
      on profiles
      for update
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_select_own'
  ) then
    create policy "profiles_select_own"
      on profiles
      for select
      using (auth.uid() = id);
  end if;
end$$;
