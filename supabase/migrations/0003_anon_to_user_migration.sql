-- Anonymous → User Migration
-- Wird beim OTP-Verify aufgerufen: überträgt anonyme Conversations + Such-Profile
-- auf den gerade eingeloggten Nutzer und leert anonymous_id.

-- profiles-Row beim Signup automatisch anlegen (Supabase Auth-Trigger)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Migrations-RPC: konvertiert alle Zeilen mit gegebener anonymous_id auf auth.uid()
create or replace function public.migrate_anonymous_to_user(p_anonymous_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversations_count int;
  v_profiles_count int;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_anonymous_id is null or p_anonymous_id = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_anonymous_id');
  end if;

  update conversations
     set user_id = v_user_id,
         anonymous_id = null
   where anonymous_id = p_anonymous_id
     and user_id is null;
  get diagnostics v_conversations_count = row_count;

  update search_profiles
     set user_id = v_user_id,
         anonymous_id = null
   where anonymous_id = p_anonymous_id
     and user_id is null;
  get diagnostics v_profiles_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'conversations', v_conversations_count,
    'search_profiles', v_profiles_count
  );
end;
$$;

revoke all on function public.migrate_anonymous_to_user(text) from public;
grant execute on function public.migrate_anonymous_to_user(text) to authenticated;

-- email-Spalte auf profiles (nützlich für Anzeige)
alter table profiles add column if not exists email text;
