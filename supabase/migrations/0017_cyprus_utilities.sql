-- Cyprus-spezifische Nebenkosten-Modellierung statt deutscher Warmmiete.
-- Strom + Wasser + Internet werden separat geregelt; community fee
-- (service_charge) ist üblich bei Apartments mit gemeinschaftlichem Pool/
-- Lift/Garten.

alter table listings add column if not exists utilities jsonb default '{}'::jsonb;
-- Schema:
-- {
--   "water":       "included" | "tenant_pays" | "landlord_pays" | "estimated",
--   "electricity": "included" | "tenant_pays" | "landlord_pays" | "estimated",
--   "internet":    "included" | "tenant_pays" | "landlord_pays" | "not_provided",
--   "bills_in_tenant_name": true|false|null,
--   "estimated_monthly_total": number|null,
--   "notes": text|null
-- }

alter table listings add column if not exists service_charge_monthly numeric(10,2);
-- Common-Area-Fee in Apartments (Pool/Aufzug/Garten-Wartung), typ. 30-100 €
