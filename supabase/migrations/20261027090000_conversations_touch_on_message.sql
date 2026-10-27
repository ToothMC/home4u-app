-- conversations.updated_at = letzte Aktivität.
--
-- Bisher wurde updated_at nur bei einem UPDATE auf conversations gesetzt
-- (conversations_touch). Neue Nachrichten landen aber nur in messages →
-- updated_at blieb auf dem Anlege-Zeitpunkt stehen. "Letzte Konversation"
-- (Web-Chat-Verlauf, Telegram) hieß dadurch "zuletzt angelegt", nicht
-- "zuletzt aktiv", und ein Alters-Check auf updated_at war wertlos.

create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- conversations_touch (BEFORE UPDATE) setzt updated_at = now().
  update conversations set updated_at = now() where id = new.conversation_id;
  return null;
end;
$$;

revoke all on function public.touch_conversation_on_message() from public, anon, authenticated;

drop trigger if exists messages_touch_conversation on messages;
create trigger messages_touch_conversation
  after insert on messages
  for each row execute function public.touch_conversation_on_message();

-- Backfill: updated_at auf die jüngste Nachricht ziehen. conversations_touch
-- würde den Wert sonst auf now() überschreiben.
alter table conversations disable trigger conversations_touch;

update conversations c
   set updated_at = m.last_at
  from (
    select conversation_id, max(created_at) as last_at
      from messages
     group by conversation_id
  ) m
 where m.conversation_id = c.id
   and m.last_at > c.updated_at;

alter table conversations enable trigger conversations_touch;
