-- Kandidaten für die Seitenprüfung (scripts/run-bazaraki-page-check.ts):
-- aktive Inserate einer Quelle, deren Titelbild beim Anbieter gelöscht ist
-- (media_ok=false, gesetzt vom täglichen Bildcheck). Am längsten nicht
-- gesehene zuerst — lebende werden beim Prüfen angetippt und rutschen nach
-- hinten, gelöschte gehen auf stale und fallen raus.
--
-- Eigene RPC statt PostgREST-Abfrage: ~13 s bei kaltem Cache (34k Treffer,
-- Sort über last_seen), PostgREST bricht nach 8 s ab.
create or replace function public.listings_dead_cover_candidates(
  p_source text,
  p_limit  integer default 10000
)
returns table (id uuid, external_id text, source_url text, has_media boolean, last_seen timestamptz)
language sql
stable
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
  select l.id,
         l.external_id,
         nullif(trim(l.extracted_data->>'source_url'), ''),
         -- echtes Bild = absolute URL; Bazarakis relativer Platzhalter
         -- (/static/images/fb/bazaraki.*.png) heißt "kein Foto".
         coalesce(l.media[1] ~* '^https?://', false),
         l.last_seen
    from listings l
   where l.source = p_source::listing_source
     and l.status = 'active'
     and l.media_ok is false
     and l.external_id is not null
   order by l.last_seen asc, l.id
   limit greatest(0, least(p_limit, 50000));
$$;

revoke all on function public.listings_dead_cover_candidates(text, integer) from public, anon, authenticated;
grant execute on function public.listings_dead_cover_candidates(text, integer) to service_role;
