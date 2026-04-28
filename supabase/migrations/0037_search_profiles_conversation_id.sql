-- Scope upsert per chat conversation so each new chat creates its own profile
-- (instead of overwriting the most-recently-active one). Sophie keeps upserting
-- inside one conversation, so corrections during a session don't fan out.

alter table search_profiles
  add column if not exists conversation_id uuid
    references conversations(id) on delete set null;

create index if not exists search_profiles_user_conv_idx
  on search_profiles(user_id, conversation_id);

create index if not exists search_profiles_anon_conv_idx
  on search_profiles(anonymous_id, conversation_id);
