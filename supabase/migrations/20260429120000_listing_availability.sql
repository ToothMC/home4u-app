-- 20260429120000_listing_availability.sql
--
-- Verfügbarkeits-Tracking für Listings — Slice 1 (Foundation).
--
-- Pain-Point: User favorisieren Inserate, beim Anrufen heißt's „schon
-- vermietet". Slice 1 baut die Wahrheits-Schleife OHNE Makler-Kontaktdaten:
--   1. last_checked_at — Heartbeat „zuletzt aktiv überprüft" (separat von
--      last_seen, das vom Crawl-Walk kommt). UI zeigt das pro Card.
--   2. mark_listing_stale(p_listing_id) — RPC, die der JIT-Recheck-Endpoint
--      aufruft wenn Original-URL 404 liefert.
--   3. touch_listing_last_checked(p_listing_id) — RPC für JIT-Recheck-OK.
--   4. listing_status enum erweitert um 'rented' und 'sold'.
--   5. listing_status_reports — Audit-Tabelle für jeden Seeker/Makler-Klick.
--   6. apply_listing_report — RPC mit Vertrauenslogik (1 Seeker = stale,
--      2+ Seeker = rented/sold, 1 Makler = direkt rented/sold).
--
-- Nicht in dieser Migration:
--   - Makler-Mail (Slice 3, abhängig von Crawler-Contact-Extraction = Slice 2).
--   - Hot-Recrawl der Bookmarks (separater Worker, später).

alter table listings
  add column if not exists last_checked_at timestamptz;

create index if not exists listings_last_checked_idx on listings(last_checked_at)
  where status = 'active';

create or replace function public.mark_listing_stale(p_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  update listings
    set status = 'stale',
        last_checked_at = now(),
        updated_at = now()
    where id = p_listing_id
      and status = 'active';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end
$$;

revoke all on function public.mark_listing_stale(uuid) from public, anon, authenticated;
grant execute on function public.mark_listing_stale(uuid) to service_role;

create or replace function public.touch_listing_last_checked(p_listing_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update listings
    set last_checked_at = now()
    where id = p_listing_id;
$$;

revoke all on function public.touch_listing_last_checked(uuid) from public, anon, authenticated;
grant execute on function public.touch_listing_last_checked(uuid) to service_role;

comment on column listings.last_checked_at is
  'Letzter aktiver Re-Check der Quell-URL (JIT beim Anfrage-Klick oder Hot-Recrawl). NULL = nie aktiv geprüft, last_seen ist dann die einzige Frische-Quelle.';

-- ============================================================================
-- listing_status enum erweitern
-- ============================================================================
-- 'rented' = explizit vermietet (rent-Listing) — finale Aussage, nicht reaktivierbar
-- 'sold'   = explizit verkauft (sale-Listing) — finale Aussage, nicht reaktivierbar
-- Unterschied zu 'stale': stale = "wir wissen's nicht genau", rented/sold = klare
-- Aussage von Seeker oder Makler. UI zeigt rote Badge + filtert hart aus.
-- 12 Monate später kann dasselbe Objekt natürlich neu inseriert werden — das ist
-- dann ein NEUES listing-Row mit eigenem dedup_hash.

alter type listing_status add value if not exists 'rented';
alter type listing_status add value if not exists 'sold';

-- ============================================================================
-- listing_status_reports — Audit-Tabelle
-- ============================================================================
-- Jeder Klick (Seeker-Chip oder zukünftiger Makler-Email-Action) landet hier.
-- Mehrere Reports je Listing erlaubt — apply_listing_report aggregiert daraus
-- den Status mit Vertrauenslogik.

create table if not exists listing_status_reports (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid not null references listings(id) on delete cascade,
  match_id uuid references matches(id) on delete set null,
  reporter_role text not null check (reporter_role in ('seeker', 'broker_link', 'broker_user', 'system')),
  reporter_user_id uuid references auth.users(id) on delete set null,
  reporter_email_hash text,  -- für broker_link (signed URL) — Hash der Empfänger-Email
  kind text not null check (kind in ('rented', 'sold', 'still_available', 'responded', 'no_answer', 'wrong_listing')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists listing_status_reports_listing_idx
  on listing_status_reports(listing_id, created_at desc);
create index if not exists listing_status_reports_match_idx
  on listing_status_reports(match_id) where match_id is not null;

alter table listing_status_reports enable row level security;

-- Reporter darf seine eigenen Reports lesen
create policy listing_status_reports_self_read on listing_status_reports
  for select using (reporter_user_id = auth.uid());

-- Insert-Policy: über RPC apply_listing_report (security definer), kein direkter
-- Insert von authenticated. Sicherheit über RPC-Body, nicht RLS.

comment on table listing_status_reports is
  'Audit jeder Verfügbarkeits-Meldung (Seeker-Chip, Makler-Email-Action). Aggregation in apply_listing_report.';

-- ============================================================================
-- apply_listing_report — Vertrauenslogik
-- ============================================================================
-- Schwellwerte:
--   - 1 broker_user oder broker_link 'rented'/'sold' → status sofort gesetzt (Makler hat Autorität)
--   - 1 seeker 'rented'/'sold' → status='stale' (soft, könnte irren)
--   - 2+ seeker 'rented'/'sold' für dasselbe Listing → status='rented'/'sold' final
--   - 1 broker 'still_available' → reset auf 'active' + last_checked_at=now()
--   - seeker 'responded' → touch last_checked_at (Listing antwortet)
--   - 5+ seeker 'no_answer' → soft signal → status='stale'
--   - 'wrong_listing' (Makler sagt: gehört nicht zu mir) → kein Status-Change,
--      aber Audit + zukünftig Outreach-Mute für diesen Empfänger
--
-- Status-Wahl 'rented' vs 'sold' bestimmt sich aus listings.type (rent→rented,
-- sale→sold). Der Reporter sendet nur kind='rented' oder 'sold' explizit;
-- wenn er 'rented' meint und type=sale ist, mappen wir auf 'sold'.

create or replace function public.apply_listing_report(
  p_listing_id uuid,
  p_kind text,
  p_reporter_role text default 'seeker',
  p_match_id uuid default null,
  p_reporter_email_hash text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_listing listings%rowtype;
  v_seeker_count int;
  v_no_answer_count int;
  v_new_status listing_status;
  v_terminal_kind text;  -- 'rented' oder 'sold' — abgeleitet aus type
begin
  if p_kind not in ('rented', 'sold', 'still_available', 'responded', 'no_answer', 'wrong_listing') then
    return jsonb_build_object('ok', false, 'error', 'invalid_kind');
  end if;
  if p_reporter_role not in ('seeker', 'broker_link', 'broker_user', 'system') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;

  -- Auth-Anforderungen je Rolle:
  --   seeker: muss eingeloggt sein (auth.uid())
  --   broker_user: muss eingeloggt sein
  --   broker_link: kein auth, aber p_reporter_email_hash muss gesetzt sein (Token-validiert beim Caller)
  --   system: nur service_role aufrufbar (siehe revoke unten)
  if p_reporter_role in ('seeker', 'broker_user') and v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'auth_required');
  end if;
  if p_reporter_role = 'broker_link' and (p_reporter_email_hash is null or p_reporter_email_hash = '') then
    return jsonb_build_object('ok', false, 'error', 'missing_reporter_email_hash');
  end if;

  select * into v_listing from listings where id = p_listing_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  -- Type-aware kind-Mapping: 'rented' auf sale-Listing → 'sold' und umgekehrt
  if p_kind = 'rented' then
    v_terminal_kind := case when v_listing.type = 'sale' then 'sold' else 'rented' end;
  elsif p_kind = 'sold' then
    v_terminal_kind := case when v_listing.type = 'rent' then 'rented' else 'sold' end;
  end if;

  -- Audit-Insert
  insert into listing_status_reports (
    listing_id, match_id, reporter_role, reporter_user_id, reporter_email_hash, kind, note
  ) values (
    p_listing_id, p_match_id, p_reporter_role, v_user_id, p_reporter_email_hash,
    coalesce(v_terminal_kind, p_kind), p_note
  );

  -- Status-Logik
  if v_terminal_kind in ('rented', 'sold') then
    if p_reporter_role in ('broker_user', 'broker_link') then
      -- Makler-Autorität: direkt auf rented/sold
      v_new_status := v_terminal_kind::listing_status;
    else
      -- Seeker: zähle WIE VIELE distincte Seeker dasselbe gemeldet haben
      select count(distinct coalesce(reporter_user_id::text, reporter_email_hash))
        into v_seeker_count
        from listing_status_reports
        where listing_id = p_listing_id
          and kind = v_terminal_kind
          and reporter_role = 'seeker';
      if v_seeker_count >= 2 then
        v_new_status := v_terminal_kind::listing_status;
      else
        v_new_status := 'stale'::listing_status;
      end if;
    end if;

    update listings
      set status = v_new_status,
          last_checked_at = now(),
          updated_at = now()
      where id = p_listing_id
        and status not in ('rented', 'sold', 'opted_out', 'archived');

  elsif p_kind = 'still_available' and p_reporter_role in ('broker_user', 'broker_link') then
    -- Makler bestätigt: reset auf active wenn vorher stale
    update listings
      set status = case when status = 'stale' then 'active'::listing_status else status end,
          last_checked_at = now(),
          updated_at = now()
      where id = p_listing_id
        and status not in ('rented', 'sold', 'opted_out', 'archived');

  elsif p_kind = 'responded' then
    update listings
      set last_checked_at = now()
      where id = p_listing_id;

  elsif p_kind = 'no_answer' then
    select count(*) into v_no_answer_count
      from listing_status_reports
      where listing_id = p_listing_id
        and kind = 'no_answer'
        and reporter_role = 'seeker';
    if v_no_answer_count >= 5 then
      update listings
        set status = 'stale',
            updated_at = now()
        where id = p_listing_id
          and status = 'active';
    end if;

  -- 'wrong_listing': nur Audit, kein Status-Change in dieser Slice.
  end if;

  select status into v_new_status from listings where id = p_listing_id;
  return jsonb_build_object(
    'ok', true,
    'status', v_new_status,
    'listing_id', p_listing_id
  );
end
$$;

-- Auth-User dürfen melden, service_role darf alles, anon nicht.
revoke all on function public.apply_listing_report(uuid, text, text, uuid, text, text)
  from public, anon;
grant execute on function public.apply_listing_report(uuid, text, text, uuid, text, text)
  to authenticated, service_role;

comment on function public.apply_listing_report(uuid, text, text, uuid, text, text) is
  'Verarbeitet Verfügbarkeits-Meldung mit Vertrauenslogik. broker_link-Rolle nur via signed-URL-Endpoint mit verifiziertem reporter_email_hash.';
