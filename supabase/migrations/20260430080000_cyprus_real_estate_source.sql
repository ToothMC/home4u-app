-- 20260430080000_cyprus_real_estate_source.sql
--
-- listing_source-Enum erweitern um 'cyprus_real_estate' (siehe 0050 für
-- 'index_cy' — selbes Pattern). Nötig damit cre-crawler via
-- bulk_upsert_external_listings inserten kann.

alter type listing_source add value if not exists 'cyprus_real_estate';
