-- /stoebern sortiert nach created_at DESC über ~214k aktive Listings. Ohne
-- passenden Index zog Postgres den kompletten Slice per Parallel Index Scan
-- auf listings_is_share_idx und sortierte ihn per top-N-Heapsort:
--   Execution Time: 2243 ms, Buffers: read=49508  →  TTFB 3-4,6 s pro Klick.
-- Zwei partielle Indizes decken die beiden Ordering-Fälle ab:
--   * ohne type-Filter  → listings_browse_created_idx
--   * mit  type-Filter  → listings_browse_type_created_idx (type ist equality,
--     damit bleibt created_at als Sortierspalte nutzbar)
-- Danach: Execution Time 0,22 ms. Je ~1,6 MB.
-- CONCURRENTLY, damit die Crawler-Upserts nicht blockieren (beide Indizes
-- sind in Prod bereits so angelegt; IF NOT EXISTS macht das Replay idempotent).
create index concurrently if not exists listings_browse_created_idx
  on public.listings (created_at desc)
  where status = 'active' and is_share = false and media is not null;

create index concurrently if not exists listings_browse_type_created_idx
  on public.listings (type, created_at desc)
  where status = 'active' and is_share = false and media is not null;
