-- Mindestlaufzeit / Vertragsdauer (CY: typisch 12 Monate, manchmal 6 oder 24).
alter table listings add column if not exists contract_min_months smallint;
alter table listings add column if not exists contract_notes text;
-- z. B. "Kündigung 1 Monat zum Monatsende", "kurzfristig OK",
-- "1+1 mit Verlängerungsoption"
