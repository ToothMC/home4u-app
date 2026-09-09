-- mark_stale_listings: optionales Batching fuer grosse Rueckstaende
-- ==============================================================================
-- Inzident 2026-09-09 (Fortsetzung von 20260909100000): der Per-Row-Sweep
-- fuer index_cy (11.738 Kandidaten) verschwand nach mehreren Minuten
-- ergebnislos aus pg_stat_activity — kein duration-Log, keine Fehlermeldung.
-- cyprus_real_estate (836 Kandidaten, gleicher Code-Pfad) brauchte dagegen
-- 75,6s und lief sauber durch. Hochgerechnet (~90ms/Zeile durch den
-- compute_listing_market_position-Trigger, siehe 20260519130000) haette
-- index_cy ~17 Minuten gebraucht — vermutlich von einem Pooler-/Connection-
-- Timeout im Verbindungsweg gekillt, lange bevor Postgres selbst ein Problem
-- gesehen haette.
--
-- Eine 17-Minuten-Transaktion ist ohnehin keine gute Idee auf einer Live-
-- Tabelle (haelt Row-Locks + WAL ueber die ganze Zeit). Sauberer Fix statt
-- Retry-Loop: optionaler p_batch_limit, der den Sweep auf eine Teilmenge
-- begrenzt (aelteste last_seen zuerst) — wiederholte, kurze Aufrufe statt
-- einem einzigen langen. Guards (Recent-Activity + Safety-Cap) bewerten
-- weiterhin den VOLLEN Kandidaten-Bestand, nicht nur den Batch — das
-- Sicherheitsniveau aendert sich nicht, nur die Transaktionsgroesse.
create or replace function public.mark_stale_listings(
  p_stale_days int default 7,
  p_source text default 'bazaraki',
  p_min_recent_seen int default null,
  p_max_pct numeric default 10.0,
  p_batch_limit int default null
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

  -- Kandidaten-Zaehlung + Safety-Cap immer auf Basis des VOLLEN Rueckstands,
  -- unabhaengig von p_batch_limit — ein Angreifer/Bug soll nicht durch
  -- kleine Batches am Cap vorbeischleichen koennen.
  select count(*) into v_to_stale
    from listings
   where source::text = p_source
     and status = 'active'
     and last_seen < now() - (p_stale_days || ' days')::interval;

  select count(*) into v_active_total
    from listings
   where source::text = p_source
     and status = 'active';

  if v_active_total > 0 then
    v_pct := (v_to_stale::numeric * 100.0) / v_active_total::numeric;
    if v_pct > p_max_pct then
      raise exception 'mark_stale_listings ABORT (%): würde % von % active stale setzen (% %%, max % %%). Vermutlich Crawler-Lücke — manuell prüfen und ggf. mit höherem p_max_pct erneut aufrufen.',
        p_source, v_to_stale, v_active_total, round(v_pct, 1), p_max_pct;
    end if;
  end if;

  -- p_batch_limit begrenzt nur, WIE VIELE der bereits guard-geprueften
  -- Kandidaten in diesem Aufruf abgearbeitet werden — aelteste last_seen
  -- zuerst, damit wiederholte Aufrufe den Rueckstand von hinten aufraeumen
  -- statt sich zu ueberschneiden.
  for v_id in
    select id from listings
     where source::text = p_source
       and status = 'active'
       and last_seen < now() - (p_stale_days || ' days')::interval
     order by last_seen asc
     limit p_batch_limit
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

comment on function public.mark_stale_listings(int, text, int, numeric, int) is
  'Setzt active→stale für Listings die seit p_stale_days nicht mehr last_seen wurden. '
  'Guards: aborts wenn <p_min_recent_seen Listings in 24h gesehen wurden ODER der Sweep '
  'mehr als p_max_pct%% des active-Bestands killen würde (Guards werten immer den vollen '
  'Rückstand, nie nur einen Batch). Default: 1000/24h, 10%%, kein Batch-Limit. '
  'p_batch_limit begrenzt die Zeilen pro Aufruf (älteste last_seen zuerst) — für große '
  'Rückstände in kurzen, wiederholbaren Transaktionen statt einer einzigen langen. '
  'Läuft pro Zeile mit eigenem exception-Handler (wie bulk_upsert_external_listings) — '
  'eine einzelne fehlschlagende Zeile (z.B. Trigger-Fehler) blockiert nie den ganzen Sweep.';

-- Alte 4-arg-Signatur entfernen, damit Caller (Workflow + manuelle Aufrufe)
-- auf den neuen Default (kein Batch-Limit = Altverhalten) zwingen.
drop function if exists public.mark_stale_listings(int, text, int, numeric);
