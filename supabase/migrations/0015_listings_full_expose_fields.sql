-- Listings Schema-Expansion für vollständiges Exposé.
-- Alle neu nullable, damit alte Listings ohne Migration weiterleben.
-- Sophie befüllt diese Felder per Vision automatisch — der Edit-Form ist
-- die Nachbearbeitungs-Oberfläche.

alter table listings add column if not exists title text;
alter table listings add column if not exists description text;
alter table listings add column if not exists bathrooms smallint;
alter table listings add column if not exists property_type text;
-- apartment | house | villa | maisonette | studio | townhouse | penthouse |
-- bungalow | land | commercial
alter table listings add column if not exists floor text;
-- ground | 1st | 2nd | ... | top | basement
alter table listings add column if not exists year_built smallint;
alter table listings add column if not exists energy_class text;
-- A | A+ | B | C | ... | G
alter table listings add column if not exists furnishing text;
-- furnished | semi_furnished | unfurnished
alter table listings add column if not exists features text[] default '{}';
-- parking | covered_parking | pool | garden | balcony | terrace | elevator |
-- air_conditioning | solar | sea_view | mountain_view | storage |
-- pets_allowed | accessible | smart_home | fireplace | jacuzzi | gym
alter table listings add column if not exists pets_allowed boolean;
alter table listings add column if not exists available_from date;
alter table listings add column if not exists plot_sqm integer;

create index if not exists listings_property_type_idx on listings(property_type)
  where property_type is not null;
create index if not exists listings_features_gin on listings using gin (features);

-- bulk_upsert_listings erweitert (s. DB-Migration für vollständigen Body).
-- Behält Kompatibilität: wenn alte Aufrufer die Felder nicht mit-schicken,
-- bleibt der vorherige Wert.

drop policy if exists "listings_owner_delete" on listings;
create policy "listings_owner_delete" on listings
  for delete using (auth.uid() is not null and auth.uid() = owner_user_id);
