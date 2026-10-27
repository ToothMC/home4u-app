-- Ausstattungswünsche aus Suchprofilen: verneinte Wörter nicht mehr als
-- Pflicht-Ausstattung lesen.
--
-- Vorher reichte ein Teilstring: "unfurnished" enthält "furnished" und
-- wurde zur Pflicht-Ausstattung "möbliert" — also das Gegenteil des
-- Wunsches. Ebenso "unmöbliert" → möbliert, "no pool" → pool,
-- "whirlpool" → zusätzlich pool.
-- Befund 2026-10-27: Profil Paphos/Miete/4 Zi./"unfurnished" bekam 5 statt
-- 44 lebende Treffer, weil nur Inserate mit "furnished" im Text durchkamen.
--
-- Bewusst KEIN reiner Wortanfang-Abgleich: deutsche Komposita
-- ("Dachterrasse", "Tiefgarage", "Außenpool", "Panoramameerblick") tragen
-- das Stichwort am Ende und würden sonst nicht mehr erkannt.
-- Stattdessen: Treffer überall im Text, außer direkt nach "un", "whirl"
-- oder nach den Verneinungen "no ", "not ", "kein ", "keine ", "nicht ".
-- Eine Verneinung erzeugt keinen Pflicht-Wunsch (kein Ausschlussfilter).
--
-- Aufrufer: match_listings_for_profile, count_matches_for_profile
-- (je einmal pro Aufruf; kein Index, keine generierte Spalte hängt dran).

create or replace function private.extract_amenity_tokens(
  p_lifestyle_tags text[],
  p_free_text text
)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_input text;
  v_tokens text[] := '{}';
  v_alias_map jsonb := jsonb_build_object(
    'pool',             jsonb_build_array('pool', 'schwimmbad', 'swimming'),
    'garden',           jsonb_build_array('garten', 'garden'),
    'balcony',          jsonb_build_array('balkon', 'balcony'),
    'terrace',          jsonb_build_array('terrasse', 'terrace'),
    'parking',          jsonb_build_array('parkplatz', 'stellplatz', 'parking'),
    'covered_parking',  jsonb_build_array('garage', 'covered parking'),
    'elevator',         jsonb_build_array('aufzug', 'fahrstuhl', 'lift', 'elevator'),
    'air_conditioning', jsonb_build_array('klima', 'klimaanlage', 'air condition', 'aircon'),
    'solar',            jsonb_build_array('solar', 'photovoltaik'),
    'sea_view',         jsonb_build_array('meerblick', 'sea view', 'seaview'),
    'mountain_view',    jsonb_build_array('bergblick', 'mountain view'),
    'storage',          jsonb_build_array('abstellraum', 'storage'),
    'fireplace',        jsonb_build_array('kamin', 'fireplace'),
    'jacuzzi',          jsonb_build_array('jacuzzi', 'whirlpool'),
    'gym',              jsonb_build_array('fitnessraum', 'fitness studio', 'gym'),
    'smart_home',       jsonb_build_array('smart home', 'smarthome', 'smart-home'),
    'accessible',       jsonb_build_array('barrierefrei', 'accessible', 'rollstuhl'),
    'pets_allowed',     jsonb_build_array('haustiere erlaubt', 'pet friendly', 'pet-friendly'),
    'furnished',        jsonb_build_array('möbliert', 'moebliert', 'furnished')
  );
  v_canonical text;
  v_aliases jsonb;
  v_alias text;
begin
  v_input := lower(coalesce(p_free_text, '') || ' ' ||
                   array_to_string(coalesce(p_lifestyle_tags, '{}'::text[]), ' '));
  if v_input is null or trim(v_input) = '' then
    return '{}'::text[];
  end if;

  v_input := ' ' || v_input || ' ';

  for v_canonical, v_aliases in select * from jsonb_each(v_alias_map) loop
    for v_alias in select jsonb_array_elements_text(v_aliases) loop
      if v_input ~ (
           '(?<!un)(?<!whirl)(?<!\mno )(?<!\mnot )(?<!\mkein )(?<!\mkeine )(?<!\mnicht )'
           || regexp_replace(v_alias, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
         ) then
        v_tokens := array_append(v_tokens, v_canonical);
        exit;
      end if;
    end loop;
  end loop;

  return v_tokens;
end;
$$;

revoke all on function private.extract_amenity_tokens(text[], text) from public, anon, authenticated;
