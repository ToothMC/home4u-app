-- 0045_match_messages.sql
--
-- Direkt-Chat zwischen Suchendem und Anbieter NACH erfolgreichem
-- gegenseitigem Match. Verhindert dass die beiden Parteien aus der
-- Plattform fliehen müssen, sobald sie miteinander reden wollen.
--
-- RLS:
-- - Lesen: nur die beiden Match-Teilnehmer (Seeker + Anbieter), und nur
--   wenn matches.connected_at gesetzt ist
-- - Schreiben: nur als Self, und nur wenn man Teilnehmer + connected ist
-- - Update (read_at): selbe Bedingung — Read-Receipts vorbereitet,
--   UI-Teil kommt später

create table if not exists match_messages (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid not null references matches(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (length(content) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists match_messages_match_idx
  on match_messages(match_id, created_at);

create index if not exists match_messages_sender_idx
  on match_messages(sender_user_id, created_at desc);

alter table match_messages enable row level security;

create policy "match_messages_select_participant"
  on match_messages
  for select
  using (
    exists (
      select 1
      from matches m
      join search_profiles sp on sp.id = m.search_profile_id
      join listings l on l.id = m.listing_id
      where m.id = match_messages.match_id
        and m.connected_at is not null
        and (sp.user_id = auth.uid() or l.owner_user_id = auth.uid())
    )
  );

create policy "match_messages_insert_participant"
  on match_messages
  for insert
  with check (
    sender_user_id = auth.uid()
    and exists (
      select 1
      from matches m
      join search_profiles sp on sp.id = m.search_profile_id
      join listings l on l.id = m.listing_id
      where m.id = match_messages.match_id
        and m.connected_at is not null
        and (sp.user_id = auth.uid() or l.owner_user_id = auth.uid())
    )
  );

create policy "match_messages_update_read"
  on match_messages
  for update
  using (
    exists (
      select 1
      from matches m
      join search_profiles sp on sp.id = m.search_profile_id
      join listings l on l.id = m.listing_id
      where m.id = match_messages.match_id
        and m.connected_at is not null
        and (sp.user_id = auth.uid() or l.owner_user_id = auth.uid())
    )
  );
