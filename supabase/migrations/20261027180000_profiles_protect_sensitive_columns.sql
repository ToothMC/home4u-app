-- 20261027180000_profiles_protect_sensitive_columns.sql
--
-- Sicherheitsfix: Nutzer konnten über die Supabase-REST-API ihre eigene
-- profiles-Zeile komplett ändern (Policies profiles_self_update aus 0001 und
-- profiles_update_own aus 0044 beschränken nur die Zeile, nicht die Spalten).
-- Damit ließ sich
--   - role = 'admin' setzen (getAuthUser() vertraut profiles.role) und
--   - email auf eine fremde Adresse setzen, die der Telegram-Login dann für
--     generateLink() benutzte → Übernahme fremder Konten.
--
-- Fix in zwei Schichten:
--   1. Spaltenrechte: anon/authenticated dürfen nur noch die unkritischen
--      Kontaktfelder ändern. Alle App-Schreibpfade laufen ohnehin über
--      Server-Routen mit Service-Role (app/api/profile, Sophie-Tools, Telegram).
--   2. Trigger als Netz: falls später jemand die Rechte wieder öffnet
--      (z. B. `grant all`), bleiben role/email/telegram_* für Nutzer gesperrt.

-- 1) Spaltenrechte -----------------------------------------------------------

revoke insert, update, delete, truncate on table public.profiles from anon, authenticated;

grant update (display_name, preferred_language, phone, contact_channel, notification_email)
  on table public.profiles to authenticated;

-- 2) Trigger-Netz ------------------------------------------------------------

create or replace function public.profiles_guard_sensitive_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Nur Anfragen mit Nutzer-JWT prüfen. service_role, postgres und
  -- SECURITY-DEFINER-Funktionen (handle_new_user) laufen als anderer Rolle.
  if current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.email is distinct from old.email
       or new.telegram_user_id is distinct from old.telegram_user_id
       or new.telegram_username is distinct from old.telegram_username
       or new.created_at is distinct from old.created_at then
      raise exception 'profiles: column is not user-editable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_sensitive_columns on public.profiles;
create trigger profiles_guard_sensitive_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_sensitive_columns();
