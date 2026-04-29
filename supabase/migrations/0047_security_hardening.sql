-- 0047_security_hardening.sql
--
-- SECURITY-Hardening (Supabase-Advisor WARN-Level Cleanup):
--
-- 1. REVOKE EXECUTE auf 11 Admin-/Crawler-/Cron-Funktionen für anon +
--    authenticated. Vorher: jeder hätte z.B. bulk_upsert_bazaraki_listings
--    direkt via /rest/v1/rpc/ aufrufen + gefälschte Listings einkippen
--    können. Nach Fix: nur Service-Role kommt rein.
--
-- 2. SET search_path = public, pg_temp auf 5 Funktionen mit role-mutable
--    search_path. Schützt vor Schema-Manipulation-Attacken.
--
-- 3. REVOKE SELECT auf district_price_stats Materialized View für anon +
--    authenticated. War vorher von außen lesbar.
--
-- 4. Storage-Policy „listing_media_public_read" war zu breit (erlaubte
--    Listing aller Files, nicht nur Object-URL-Zugriff). Ersetzt durch
--    Object-only-Variante.

-- 1. Admin-Funktionen
revoke execute on function public.bulk_upsert_bazaraki_listings(jsonb) from anon, authenticated;
revoke execute on function public.bulk_upsert_fb_listings(jsonb) from anon, authenticated;
revoke execute on function public.bulk_upsert_listings(uuid, jsonb) from anon, authenticated;
revoke execute on function public.compute_listing_market_position(uuid) from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.mark_stale_listings(integer, text) from anon, authenticated;
revoke execute on function public.purge_expired_scam_checks() from anon, authenticated;
revoke execute on function public.purge_expired_transient_lookups() from anon, authenticated;
revoke execute on function public.recompute_all_market_positions() from anon, authenticated;
revoke execute on function public.refresh_district_price_stats() from anon, authenticated;
revoke execute on function public.set_listing_media(uuid, text[]) from anon, authenticated;

-- handle_new_user ist Trigger-Function (auf auth.users INSERT), darf NIE
-- via REST-RPC aufrufbar sein. PUBLIC-Default-Grant zusätzlich entfernen
-- (anon + authenticated erben sonst davon).
revoke execute on function public.handle_new_user() from public;

-- 2. Search-Path-Pinning
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.recompute_all_market_positions() set search_path = public, pg_temp;
alter function public.phash_hamming(bigint, bigint) set search_path = public, pg_temp;
alter function public.refresh_district_price_stats() set search_path = public, pg_temp;
alter function public.trg_recompute_market_position() set search_path = public, pg_temp;

-- 3. Materialized View nicht mehr von außen lesbar
revoke select on public.district_price_stats from anon, authenticated;

-- 4. Storage-Policy verschärfen
drop policy if exists "listing_media_public_read" on storage.objects;
create policy "listing_media_public_object_read"
  on storage.objects
  for select
  using (
    bucket_id = 'listing-media'
    and name is not null
  );
