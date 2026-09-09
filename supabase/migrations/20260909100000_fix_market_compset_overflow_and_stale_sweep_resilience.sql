-- Root-Cause-Fix: market_compset_size-Overflow + mark_stale_listings-Resilienz
-- ==============================================================================
-- Inzident 2026-09-09: manueller mark_stale_listings-Cleanup (nach dem
-- 6-Wochen-GitHub-Actions-Autodisable + Mac-mini-Runner-Ausfall) schlug fuer
-- index_cy und cyprus_real_estate komplett fehl:
--
--   ERROR: 22003: smallint out of range
--   ... PL/pgSQL function compute_listing_market_position(uuid) ...
--   ... PL/pgSQL function mark_stale_listings(integer,text,integer,numeric) ...
--
-- Root Cause: market_compset_size ist als smallint (max 32.767) angelegt.
-- compute_listing_market_position() zaehlt aber pro Listing ALLE aktiven
-- Vergleichsobjekte in (type, city, property_type_group) — quellenuebergreifend,
-- nicht auf eine Source beschraenkt. Der groesste Bucket (sale/limassol/
-- residential_apartment) liegt seit 2026-05-26 ueber 38.000 Listings.
--
-- Der district-Filter greift zwar meistens (max. Einzel-District Germasogeia
-- ~4.686), ABER: "l.location_district is null" laesst jeden Comp OHNE
-- district IMMER durch, unabhaengig vom district des Ziel-Listings. Aktuell
-- ~182 Listings in diesem Bucket ohne location_district erben so den vollen,
-- ungefilterten Bucket-Count (~38.6k) als Compset-Groesse — weit ueber dem
-- smallint-Limit. Seit 26.05.2026 koennen diese Listings nicht mehr
-- ge-inserted/upgedated werden (in bulk_upsert_external_listings still in
-- v_failed geloggt, aber nie alarmiert).
--
-- Fix 1 (Root Cause): market_compset_size auf integer erweitern. Kein
-- Datenverlust, keine Clamping-Luecke (least(...,32767) haette die Zahl in
-- der UI verfaelscht) — die Spalte bildet jetzt einfach ab, was die Query
-- tatsaechlich zaehlt.
--
-- canonical_listings (0027_add_canonical_listing_clusters.sql, "select *"
-- auf listings) haengt an der Spalte und muss dafuer kurz weichen. Grants
-- + security_invoker werden danach 1:1 wiederhergestellt.
-- lock_timeout: auf einer live Tabelle soll die ACCESS-EXCLUSIVE-Anfrage
-- (DROP VIEW / ALTER COLUMN TYPE brauchen die) fehlschlagen statt sich
-- einzureihen und dahinter alle anderen Reads/Writes zu stauen (Inzident
-- 2026-09-09: erster Versuch hing 1:35min in der Lock-Queue, abgebrochen).
set local lock_timeout = '5s';

drop view public.canonical_listings;

alter table public.listings
  alter column market_compset_size type integer;

create view public.canonical_listings as
select * from public.listings
where status = 'active'
  and canonical_id is null;

-- View erbt RLS von listings (security_invoker) — wie im Original.
alter view public.canonical_listings set (security_invoker = on);

grant select, insert, update, delete, truncate, references, trigger
  on public.canonical_listings to anon, authenticated, service_role, postgres;

-- Fix 2 (Resilienz): mark_stale_listings machte bisher EIN einziges Bulk-
-- UPDATE ueber alle Kandidaten. Feuert der listings_market_position_trg
-- (oder irgendein anderer Trigger) fuer AUCH NUR EINE Zeile im Batch einen
-- Fehler, rollt die komplette Transaktion zurueck — 0 Zeilen markiert, kein
-- Teilfortschritt, kein Hinweis welche Zeile schuld war. Analog zu
-- bulk_upsert_external_listings (die pro Zeile begin/exception kapselt)
-- laeuft der Sweep jetzt Zeile fuer Zeile: eine kaputte Zeile wird geloggt
-- und uebersprungen, der Rest des Sweeps laeuft trotzdem durch. Guards
-- (Recent-Activity + Safety-Cap) unveraendert, wirken weiterhin VOR dem Sweep
-- auf Basis der Kandidaten-Zaehlung.
create or replace function public.mark_stale_listings(
  p_stale_days int default 7,
  p_source text default 'bazaraki',
  p_min_recent_seen int default null,
  p_max_pct numeric default 10.0
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_seen  int;
  v_active_total int;
  v_to_stale     int;
  v_pct          numeric;
  v_count        int := 0;
  v_failed       int := 0;
  v_id           uuid;
begin
  -- Guard 1: Recent-Activity (optional). Ohne frischen Crawl ist jeder Sweep blind.
  if p_min_recent_seen is not null then
    select count(*)
      into v_recent_seen
      from listings
     where source::text = p_source
       and last_seen > now() - interval '24 hours';

    if v_recent_seen < p_min_recent_seen then
      raise exception 'mark_stale_listings ABORT (%): nur % listings in letzten 24h gesehen (min %). Crawler-Health pruefen.',
        p_source, v_recent_seen, p_min_recent_seen;
    end if;
  end if;

  -- Kandidaten + aktuellen active-Bestand zaehlen, vor dem Update.
  select count(*) into v_to_stale
    from listings
   where source::text = p_source
     and status = 'active'
     and last_seen < now() - (p_stale_days || ' days')::interval;

  select count(*) into v_active_total
    from listings
   where source::text = p_source
     and status = 'active';

  -- Guard 2: Safety-Cap. Massensterben verhindern.
  if v_active_total > 0 then
    v_pct := (v_to_stale::numeric * 100.0) / v_active_total::numeric;
    if v_pct > p_max_pct then
      raise exception 'mark_stale_listings ABORT (%): würde % von % active stale setzen (% %%, max % %%). Vermutlich Crawler-Lücke — manuell prüfen und ggf. mit höherem p_max_pct erneut aufrufen.',
        p_source, v_to_stale, v_active_total, round(v_pct, 1), p_max_pct;
    end if;
  end if;

  -- Beide Guards passiert → Sweep ausfuehren, Zeile fuer Zeile statt einem
  -- einzigen Bulk-Statement. Kandidaten-ID-Liste vorher einsammeln (nicht
  -- live nachlesen), damit der Sweep genau die guard-geprueften Kandidaten
  -- bearbeitet.
  for v_id in
    select id from listings
     where source::text = p_source
       and status = 'active'
       and last_seen < now() - (p_stale_days || ' days')::interval
  loop
    begin
      update listings
         set status = 'stale', updated_at = now(), status_changed_at = now()
       where id = v_id;
      v_count := v_count + 1;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'mark_stale_listings (%): Listing % fehlgeschlagen — %', p_source, v_id, sqlerrm;
    end;
  end loop;

  if v_failed > 0 then
    raise warning 'mark_stale_listings (%): % von % Kandidaten fehlgeschlagen (siehe WARNINGs oben) — % erfolgreich markiert.',
      p_source, v_failed, v_to_stale, v_count;
  end if;

  return v_count;
end;
$$;

comment on function public.mark_stale_listings(int, text, int, numeric) is
  'Setzt active→stale für Listings die seit p_stale_days nicht mehr last_seen wurden. '
  'Guards: aborts wenn <p_min_recent_seen Listings in 24h gesehen wurden ODER der Sweep '
  'mehr als p_max_pct%% des active-Bestands killen würde. Default: 1000/24h, 10%%. '
  'Läuft pro Zeile mit eigenem exception-Handler (wie bulk_upsert_external_listings) — '
  'eine einzelne fehlschlagende Zeile (z.B. Trigger-Fehler) blockiert nie den ganzen Sweep.';
