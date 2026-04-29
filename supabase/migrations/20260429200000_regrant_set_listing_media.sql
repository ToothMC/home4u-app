-- Re-grant execute auf set_listing_media an authenticated.
-- Migration 0047 hatte das Recht zurueckgenommen aus Vorsicht — die Funktion
-- macht aber selbst einen Owner-Check (auth.uid() != owner_user_id raises
-- not_owner). Ohne dieses Grant kann der Dashboard-Editor keine Medien mehr
-- speichern: "permission denied for function set_listing_media".
grant execute on function public.set_listing_media(uuid, text[]) to authenticated;
