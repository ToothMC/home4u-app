-- Verfuegbarkeits-Check fuer Cover-Bilder (Befund 2026-10-21).
--
-- Bazaraki loescht die Bilddatei aus dem GCS-Bucket, sobald das Inserat
-- offline geht; GCS antwortet 403 AccessDenied (nicht 404, weil anonyme
-- Caller nicht listen duerfen). Der Cloudflare-Cache kaschiert das tagelang.
-- Stichprobe: 11/20 bazaraki-Cover tot, 4/10 index.cy (nginx-500 am Origin,
-- CDN-Spiegel 404). bsc war 10/10 sauber.
--
-- Warum ein eigenes Signal und nicht mark_stale_listings: der FAST_MODE-
-- Pre-Touch in bazaraki-crawler/src/main.py setzt last_seen fuer alle
-- bekannten external_ids aus UNSERER DB, bevor gecrawlt wird. last_seen
-- heisst dort "kennen wir", nicht "existiert noch" — alle 55.715 aktiven
-- bazaraki-Listings haben last_seen < 24h, der 14-Tage-Cutoff greift nie.
alter table public.listings
  add column if not exists media_ok boolean,
  add column if not exists media_checked_at timestamptz;

comment on column public.listings.media_ok is
  'Cover-Bild (media[1]) erreichbar? NULL=ungeprueft. Gesetzt von scripts/run-media-check.ts.';

-- Arbeitsindex fuer den Checker: aelteste/ungepruefte zuerst.
-- CONCURRENTLY, damit die Crawler-Upserts nicht blockieren.
create index concurrently if not exists listings_media_check_queue_idx
  on public.listings (media_checked_at nulls first)
  where status = 'active' and media is not null;

-- Ergebnisse batchweise zurueckschreiben. Eigenes statement_timeout, weil
-- service_role sonst die 8s von authenticator erbt und grosse Batches
-- mittendrin abbrechen — exakt die Falle, in der mark_stale_listings bis
-- heute steckt (siehe 20261021110000_mark_stale_timeout.sql).
create or replace function public.set_media_check_results(
  p_ok uuid[],
  p_dead uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  c integer;
begin
  if p_ok is not null and array_length(p_ok, 1) > 0 then
    update listings
       set media_ok = true, media_checked_at = now()
     where id = any(p_ok);
    get diagnostics c = row_count; n := n + c;
  end if;

  if p_dead is not null and array_length(p_dead, 1) > 0 then
    update listings
       set media_ok = false, media_checked_at = now()
     where id = any(p_dead);
    get diagnostics c = row_count; n := n + c;
  end if;

  return n;
end;
$$;

alter function public.set_media_check_results(uuid[], uuid[])
  set statement_timeout = '120s';

revoke all on function public.set_media_check_results(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.set_media_check_results(uuid[], uuid[]) to service_role;
