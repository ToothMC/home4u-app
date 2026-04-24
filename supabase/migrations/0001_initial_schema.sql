-- Home4U initial schema
-- Generated 2026-04-24, Phase 0 MVP scaffold
-- Notes: pgvector for semantic match; RLS enabled on user-owned tables;
-- listings table is service-role-write only (Indexer + Bulk-Import).

create extension if not exists "uuid-ossp";
create extension if not exists vector;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------

create type user_role as enum ('seeker', 'owner', 'agent', 'admin');
create type listing_source as enum ('fb', 'bazaraki', 'direct', 'other');
create type listing_type as enum ('rent', 'sale');
create type listing_status as enum ('active', 'stale', 'opted_out', 'archived');
create type message_role as enum ('user', 'assistant', 'system', 'tool');
create type moderation_status as enum ('pending', 'approved', 'edited', 'rejected', 'sent');
create type outreach_channel as enum ('whatsapp', 'telegram', 'email', 'sms');
create type outreach_status as enum ('queued', 'sent', 'replied', 'stopped', 'failed');

-- -----------------------------------------------------------------------------
-- PROFILES (mirrors auth.users)
-- -----------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'seeker',
  display_name text,
  preferred_language text check (preferred_language in ('de', 'en', 'ru', 'el')) default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_self_select" on profiles
  for select using (auth.uid() = id);
create policy "profiles_self_update" on profiles
  for update using (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- SEARCH PROFILES (Suchende-Profile, Tool-Output)
-- -----------------------------------------------------------------------------

create table search_profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location text not null,
  budget_min numeric(10,2),
  budget_max numeric(10,2) not null,
  currency char(3) not null default 'EUR',
  rooms smallint,
  type listing_type not null default 'rent',
  move_in_date date,
  household text check (household in ('single', 'couple', 'family', 'shared')),
  lifestyle_tags text[] default '{}',
  pets boolean,
  free_text text,
  embedding vector(1536),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index search_profiles_user_idx on search_profiles(user_id);
create index search_profiles_embedding_idx on search_profiles
  using hnsw (embedding vector_cosine_ops);

alter table search_profiles enable row level security;
create policy "search_profiles_owner_rw" on search_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- CONVERSATIONS + MESSAGES (Sophie-Chat)
-- -----------------------------------------------------------------------------

create table conversations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  flow text check (flow in ('seeker', 'owner', 'agent', 'default')) default 'default',
  channel text not null default 'web' check (channel in ('web', 'telegram', 'whatsapp')),
  prompt_version text not null,
  language text check (language in ('de', 'en', 'ru', 'el')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_idx on conversations(user_id);

alter table conversations enable row level security;
create policy "conversations_owner_rw" on conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role message_role not null,
  content text,
  tool_name text,
  tool_input jsonb,
  tool_result jsonb,
  token_usage jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on messages(conversation_id, created_at);

alter table messages enable row level security;
create policy "messages_owner_read" on messages
  for select using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- LISTINGS (Bridge-Index + Direkt-Einpflege)
-- -----------------------------------------------------------------------------

create table listings (
  id uuid primary key default uuid_generate_v4(),
  source listing_source not null,
  external_id text,
  type listing_type not null,
  status listing_status not null default 'active',
  location_city text not null,
  location_district text,
  location_raw text,
  price numeric(12,2),
  currency char(3) not null default 'EUR',
  price_period text check (price_period in ('month', 'total')) default 'month',
  rooms smallint,
  size_sqm smallint,
  contact_name text,
  contact_phone_enc bytea,
  contact_channel text,
  language text check (language in ('de', 'en', 'ru', 'el')),
  raw_text_enc bytea,
  dedup_hash text not null,
  embedding vector(1536),
  owner_user_id uuid references auth.users(id) on delete set null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, dedup_hash)
);

create index listings_location_idx on listings(location_city, location_district);
create index listings_price_idx on listings(type, price);
create index listings_embedding_idx on listings
  using hnsw (embedding vector_cosine_ops);
create index listings_status_idx on listings(status) where status = 'active';

alter table listings enable row level security;
-- Public read: aktive Listings sichtbar (ohne contact_phone_enc / raw_text_enc)
-- Write: nur Service-Role oder Besitzer des Direkt-Inserats.
create policy "listings_public_read" on listings
  for select using (status = 'active');
create policy "listings_owner_write" on listings
  for update using (auth.uid() = owner_user_id);

-- -----------------------------------------------------------------------------
-- MATCHES (Double-Opt-in-Kontakte)
-- -----------------------------------------------------------------------------

create table matches (
  id uuid primary key default uuid_generate_v4(),
  search_profile_id uuid not null references search_profiles(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  score real,
  seeker_interest boolean,
  seeker_decided_at timestamptz,
  owner_interest boolean,
  owner_decided_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (search_profile_id, listing_id)
);

create index matches_profile_idx on matches(search_profile_id);
create index matches_listing_idx on matches(listing_id);

alter table matches enable row level security;
create policy "matches_seeker_read" on matches
  for select using (
    exists (
      select 1 from search_profiles sp
      where sp.id = matches.search_profile_id and sp.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- MODERATION QUEUE (Co-Pilot-Modus)
-- -----------------------------------------------------------------------------

create table moderation_queue (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  sophie_draft text not null,
  human_final text,
  diff jsonb,
  tags text[] default '{}',
  status moderation_status not null default 'pending',
  moderator_id uuid references auth.users(id) on delete set null,
  prompt_version text not null,
  context_hash text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index moderation_queue_status_idx on moderation_queue(status)
  where status = 'pending';

-- -----------------------------------------------------------------------------
-- OUTREACH (Bridge WhatsApp / Telegram)
-- -----------------------------------------------------------------------------

create table outreach (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid references listings(id) on delete set null,
  match_id uuid references matches(id) on delete set null,
  channel outreach_channel not null,
  recipient_phone_enc bytea,
  template_key text not null,
  rendered_text text,
  status outreach_status not null default 'queued',
  sent_at timestamptz,
  replied_at timestamptz,
  reply_text text,
  opted_out boolean default false,
  created_at timestamptz not null default now()
);

create index outreach_status_idx on outreach(status);

-- -----------------------------------------------------------------------------
-- OPT-OUTS (phone blacklist)
-- -----------------------------------------------------------------------------

create table opt_outs (
  phone_hash text primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- LLM USAGE (Kosten-Tracking)
-- -----------------------------------------------------------------------------

create table llm_usage (
  id bigserial primary key,
  conversation_id uuid references conversations(id) on delete set null,
  provider text not null default 'anthropic',
  model text not null,
  input_tokens integer,
  cache_creation_tokens integer,
  cache_read_tokens integer,
  output_tokens integer,
  cost_eur numeric(10,6),
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index llm_usage_created_idx on llm_usage(created_at desc);

-- -----------------------------------------------------------------------------
-- UPDATED_AT TRIGGERS
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on profiles
  for each row execute function set_updated_at();
create trigger search_profiles_touch before update on search_profiles
  for each row execute function set_updated_at();
create trigger conversations_touch before update on conversations
  for each row execute function set_updated_at();
create trigger listings_touch before update on listings
  for each row execute function set_updated_at();
