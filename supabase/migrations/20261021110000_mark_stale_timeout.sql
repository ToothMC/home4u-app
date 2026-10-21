-- mark_stale_listings lief fuer bazaraki (55k active) jeden Tag ins
-- 8s-statement_timeout, das service_role von authenticator erbt:
--   "bazaraki: RPC-Fehler nach 8686ms — canceling statement due to
--    statement timeout"  (mark-stale-daily, 13.-20.10., taeglich exit 1)
-- Gleiche Falle wie bei bulk_upsert/find_canonical/touch_last_seen und
-- zuletzt crawler_health_snapshot. Diese RPC war die letzte ohne.
--
-- ACHTUNG: behebt NUR den Timeout. Die Bereinigung greift fuer bazaraki
-- trotzdem nicht, weil der FAST_MODE-Pre-Touch last_seen fuer alle
-- bekannten IDs aus unserer eigenen DB auffrischt (siehe
-- bazaraki-crawler/src/main.py ~Z.218) — der 14-Tage-Cutoff wird nie
-- erreicht. index_cy/bsc brechen weiterhin an ihren Safety-Gates ab.
alter function public.mark_stale_listings(integer, text, integer, numeric, integer)
  set statement_timeout = '120s';
