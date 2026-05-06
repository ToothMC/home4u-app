-- Touch-Last-Seen RPC
-- ====================
-- Inzident-Folgefix 2026-05-06: dev-crawler skippt bekannte Listings
-- ("nichts Neues") und macht damit gar keinen DB-Touch — last_seen bleibt
-- 56h+ alt, mark_stale-Sweep würde nach 7d ALLE 101 cy_developer-Records
-- killen wollen. Bazaraki-Bug exakt eine Stufe höher: technisch "läuft",
-- praktisch unsichtbar.
--
-- Fix: leichtgewichtige Touch-RPC, die nur last_seen + updated_at
-- aktualisiert. Kein Schema-Wissen über Felder nötig — Crawler ruft sie
-- für jede in der discover()-Phase wiedergesehene URL auf.
--
-- Use-Case ist ausschließlich "ich weiß dass dieses Listing existiert
-- und gerade live ist, ohne es vollständig zu fetchen". Reines Refresh.

create or replace function public.touch_listings_last_seen(
  p_source text,
  p_external_ids text[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_external_ids is null or array_length(p_external_ids, 1) is null then
    return 0;
  end if;

  update listings
     set last_seen = now(),
         updated_at = now()
   where source::text = p_source
     and external_id = any(p_external_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.touch_listings_last_seen(text, text[]) from public;
grant execute on function public.touch_listings_last_seen(text, text[]) to service_role;

comment on function public.touch_listings_last_seen(text, text[]) is
  'Setzt last_seen=now() für bestehende Listings einer Source. Vom dev-crawler '
  'aufgerufen, wenn discover() eine bereits indexierte URL liefert — ohne diese '
  'Touch würde mark_stale die Listings nach 7d als tot markieren.';
