-- scam_checks: User-eingereichte Inserate für Scam-Shield (Indexer-Spec v2.0 §6.3
-- "Bei User-Submit"). Persistierung ist ephemerer Cache — die UX (Spec B) und
-- ein TTL-Cron räumen alte Einträge weg. Wir speichern weder Klartext-Phone
-- noch Klartext-Beschreibung im Klaren; payload landet symmetrisch verschlüsselt
-- via app.raw_text_pepper.
--
-- Das ist explizit KEIN Eintrag in listings — User-Submit erzeugt keinen
-- Index-Eintrag (siehe Spec §6.3, Schritt 4).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'scam_check_input_kind') then
    create type scam_check_input_kind as enum ('url', 'image', 'text');
  end if;
end$$;

create table if not exists scam_checks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),

  input_kind scam_check_input_kind not null,
  input_payload_enc bytea,                  -- pgp_sym_encrypt(payload, app.raw_text_pepper)
  input_url text,                            -- nur Domain/Origin, nie Klartext-Userdaten

  -- Output der Score-Engine (lib/scam/score.ts)
  score float not null default 0.0
    check (score >= 0.0 and score <= 1.0),
  flags text[] not null default '{}',
  similar_listing_ids uuid[] not null default '{}',
  explanation_md text,                       -- Markdown, nutzerlesbare Begründung

  -- TTL-Steuerung: scam_checks sind ephemerer Cache, kein Audit-Log.
  -- Default 30 Tage; ein Cron in 0023.scam_checks_ttl_cron räumt auf.
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists scam_checks_user_idx on scam_checks(user_id, submitted_at desc);
create index if not exists scam_checks_expires_idx on scam_checks(expires_at);
create index if not exists scam_checks_flags_gin on scam_checks using gin (flags);

alter table scam_checks enable row level security;

-- Owner darf seine eigenen Checks lesen. Service-Role schreibt.
create policy "scam_checks_owner_read" on scam_checks
  for select using (auth.uid() is not null and auth.uid() = user_id);

-- TTL-Aufräumer: löscht abgelaufene Einträge. Vom pg_cron oder
-- externen Scheduler einmal pro Stunde aufzurufen.
create or replace function public.purge_expired_scam_checks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from scam_checks where expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_expired_scam_checks() from public;
grant execute on function public.purge_expired_scam_checks() to service_role;
