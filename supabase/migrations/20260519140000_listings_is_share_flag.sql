-- Bazaraki listet Anteils-Inserate ("(Share) Residential Plot 750 m^2") als
-- regulaere Plots. Sie haben size_sqm=NULL (Title-m^2 bezieht sich aufs
-- GANZE Grundstueck, nicht auf den Anteil), faerben damit market_position
-- nicht an, erscheinen aber in /stoebern neben echten Plots — User sieht
-- "Plot 750 m^2 fuer 50k EUR" und glaubt, das ist der ganze Plot.
-- Praktisch ein Spekulations-Invest mit ungewisser Vollverwertung.
--
-- Generated column: einmalig definiert, kein Crawler-Code-Aenderung
-- noetig, future-proof fuer neue Bazaraki-Listings.
alter table public.listings
  add column if not exists is_share boolean
  generated always as (lower(coalesce(title,'')) like '(share)%') stored;

create index if not exists listings_is_share_idx
  on public.listings (is_share)
  where status='active';
