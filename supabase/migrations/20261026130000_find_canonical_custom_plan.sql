-- find_canonical_for_signals: immer mit den echten Parameterwerten planen.
--
-- PL/pgSQL cached Pläne pro Verbindung und wechselt nach 5 Aufrufen auf
-- einen generischen Plan. Für "location_city = $p_city" schätzt der
-- ~63 Zeilen (Durchschnitt über viele Dörfer) und läuft über
-- listings_location_idx — bei Larnaca/Limassol sind das zehntausende
-- Zeilen, kalt von Platte. Folge (2026-10-26, Testlauf nach dem
-- Marktpositions-Fix): ein 25er-Upsert-Block > 120 s statement_timeout,
-- während der erste Block auf derselben Verbindung (custom plan) 14 s
-- brauchte. Mit Custom Plan nimmt der Planer den pHash-Index (~0,5 s).
alter function public.find_canonical_for_signals(
  bigint, text, numeric, text, listing_type, text, smallint, smallint, uuid
) set plan_cache_mode = force_custom_plan;
