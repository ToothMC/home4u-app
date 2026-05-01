-- 20260501130000_add_cy_developer_source.sql
--
-- Sprint D: Großentwickler-Bundle-Crawler. Indexiert die Direktvertriebs-
-- Inventories der 6-7 großen CY-Bauträger (Aristo, Pafilia, Cybarco,
-- Leptos, Korantina, Imperio, Quality/Giovani).
--
-- Eine source für alle Bauträger — Differenzierung über external_id-Prefix
-- (`aristo:UNIT123`, `pafilia:UNIT456` etc.) und über extracted_data.developer.
-- Vorteil: kein Enum-Sprawl, einheitliche Statistiken, einheitliche RPCs.

alter type listing_source add value if not exists 'cy_developer';
