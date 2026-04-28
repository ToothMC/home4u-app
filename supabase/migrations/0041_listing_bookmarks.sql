-- Listing-Bookmarks (Favoriten ohne Kontaktaufnahme).
-- Spec: User hat 3 Aktionen pro Listing: Skip (swipe-left), Save (Herz),
-- Anfragen (Swipe-right → Bridge-Outreach). Speichern ist die leichteste —
-- nur ablegen, kein Outreach. Sichtbar im Dashboard unter „Gespeichert".

create table if not exists listing_bookmarks (
  id uuid primary key default extensions.uuid_generate_v4(),
  listing_id uuid not null references listings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  anonymous_id text,
  source_context text,
  created_at timestamptz not null default now(),
  constraint owner_present check (user_id is not null or anonymous_id is not null),
  constraint unique_user_listing unique nulls not distinct (user_id, listing_id),
  constraint unique_anon_listing unique nulls not distinct (anonymous_id, listing_id)
);

create index if not exists listing_bookmarks_user_idx
  on listing_bookmarks(user_id, created_at desc) where user_id is not null;
create index if not exists listing_bookmarks_anon_idx
  on listing_bookmarks(anonymous_id, created_at desc) where anonymous_id is not null;

alter table listing_bookmarks enable row level security;

create policy "user_bookmarks_select_own" on listing_bookmarks
  for select using (auth.uid() is not null and user_id = auth.uid());
create policy "user_bookmarks_insert_own" on listing_bookmarks
  for insert with check (auth.uid() is not null and user_id = auth.uid());
create policy "user_bookmarks_delete_own" on listing_bookmarks
  for delete using (auth.uid() is not null and user_id = auth.uid());

create or replace function public.toggle_listing_bookmark(
  p_listing_id uuid,
  p_anonymous_id text default null,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing uuid;
begin
  if v_user_id is null and (p_anonymous_id is null or p_anonymous_id = '') then
    return jsonb_build_object('ok', false, 'error', 'no_owner');
  end if;
  if not exists (select 1 from listings where id = p_listing_id and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  if v_user_id is not null then
    select id into v_existing from listing_bookmarks
    where user_id = v_user_id and listing_id = p_listing_id;
    if v_existing is not null then
      delete from listing_bookmarks where id = v_existing;
      return jsonb_build_object('ok', true, 'saved', false);
    end if;
    insert into listing_bookmarks (listing_id, user_id, source_context)
    values (p_listing_id, v_user_id, p_source);
    return jsonb_build_object('ok', true, 'saved', true);
  else
    select id into v_existing from listing_bookmarks
    where anonymous_id = p_anonymous_id and listing_id = p_listing_id;
    if v_existing is not null then
      delete from listing_bookmarks where id = v_existing;
      return jsonb_build_object('ok', true, 'saved', false);
    end if;
    insert into listing_bookmarks (listing_id, anonymous_id, source_context)
    values (p_listing_id, p_anonymous_id, p_source);
    return jsonb_build_object('ok', true, 'saved', true);
  end if;
end;
$$;

revoke all on function public.toggle_listing_bookmark(uuid, text, text) from public;
grant execute on function public.toggle_listing_bookmark(uuid, text, text)
  to authenticated, anon, service_role;

-- migrate_anonymous_to_user erweitern: bookmarks mitziehen.
create or replace function public.migrate_anonymous_to_user(p_anonymous_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_conversations_count int;
  v_profiles_count int;
  v_bookmarks_count int;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_anonymous_id is null or p_anonymous_id = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_anonymous_id');
  end if;

  update conversations
     set user_id = v_user_id, anonymous_id = null
   where anonymous_id = p_anonymous_id and user_id is null;
  get diagnostics v_conversations_count = row_count;

  update search_profiles
     set user_id = v_user_id, anonymous_id = null
   where anonymous_id = p_anonymous_id and user_id is null;
  get diagnostics v_profiles_count = row_count;

  -- Bookmarks: vor UPDATE bestehende user-Bookmarks für gleiche Listings finden
  -- und die anon-Doublette löschen, damit der unique-Constraint nicht greift.
  delete from listing_bookmarks
   where anonymous_id = p_anonymous_id
     and exists (
       select 1 from listing_bookmarks lb2
       where lb2.user_id = v_user_id
         and lb2.listing_id = listing_bookmarks.listing_id
     );

  update listing_bookmarks
     set user_id = v_user_id, anonymous_id = null
   where anonymous_id = p_anonymous_id and user_id is null;
  get diagnostics v_bookmarks_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'conversations', v_conversations_count,
    'search_profiles', v_profiles_count,
    'listing_bookmarks', v_bookmarks_count
  );
end;
$function$;
