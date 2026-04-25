-- Strikte Rollentrennung: profiles.role wird bewusste Wahl, kein Default mehr.
-- Sophie erkennt die Rolle aus dem Chat-Kontext und ruft das neue Tool
-- set_user_role auf, sobald klar ist. Bis dahin = null.

-- 1) role nullable + Default entfernen
alter table profiles alter column role drop default;
alter table profiles alter column role drop not null;

-- 2) Bestehende Default-Seeker-Zeilen behalten wir vorerst — sie sind technisch
--    eine Rolle. Der aufmerksame Tester kann seine eigene Zeile manuell
--    zurücksetzen, um den neuen Flow zu erleben:
--
--    update profiles set role = null where email = 'deine-mail@beispiel.de';
--
--    Oder direkt über die User-ID:
--    update profiles set role = null where id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

-- 3) handle_new_user-Trigger so aktualisieren, dass neue User keine Default-
--    Rolle bekommen. Bestehender Trigger aus 0003 wird überschrieben.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Trigger bleibt bestehen, nur das Fn-Body wurde ersetzt (keine role-Angabe
-- → NULL dank nullable Spalte).
