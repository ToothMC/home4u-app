-- 20260430140000_propagate_analyzed_to_canonical.sql
--
-- pHash-Dedup ordnet gecrawlte Duplikate einem canonical-Master zu
-- (canonical_id != id). Match-RPC zeigt nur den Master. Wenn die Vision-
-- Analyse zufällig am Duplikat lief (z.B. weil c-r-e bessere Fotos hat
-- als Bazaraki), bleiben die KI-Felder am unsichtbaren Listing hängen.
--
-- Diese Funktion kopiert/merged sie auf den Master:
--   - title/description: längere Variante gewinnt
--   - features: UNION (beide Foto-Sets können unterschiedliche Features
--     zeigen, z.B. Bazaraki sieht Garten, c-r-e sieht zusätzlich Pool)
--   - property_type/furnishing/bathrooms/honest_assessment: coalesce
--     (Master gewinnt wenn gesetzt)
--   - ai_analyzed_at: max(beide)

create or replace function private.propagate_analyzed_to_canonical()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select dup.id as dup_id, dup.canonical_id as canonical_id_target
    from listings dup
    where dup.canonical_id is not null
      and dup.canonical_id <> dup.id
      and dup.ai_analyzed_at is not null
  loop
    update listings c
       set
         title = case
           when c.title is null then dup.title
           when dup.title is null then c.title
           when length(coalesce(dup.title,'')) > length(coalesce(c.title,'')) then dup.title
           else c.title
         end,
         description = case
           when c.description is null then dup.description
           when dup.description is null then c.description
           when length(coalesce(dup.description,'')) > length(coalesce(c.description,'')) then dup.description
           else c.description
         end,
         property_type = coalesce(c.property_type, dup.property_type),
         features = (
           select array(select distinct unnest(coalesce(c.features,'{}'::text[]) || coalesce(dup.features,'{}'::text[])))
         ),
         furnishing = coalesce(c.furnishing, dup.furnishing),
         bathrooms = coalesce(c.bathrooms, dup.bathrooms),
         honest_assessment = coalesce(c.honest_assessment, dup.honest_assessment),
         ai_analyzed_at = greatest(coalesce(c.ai_analyzed_at, dup.ai_analyzed_at), coalesce(dup.ai_analyzed_at, c.ai_analyzed_at)),
         updated_at = now()
      from listings dup
     where c.id = dup.canonical_id
       and dup.id = r.dup_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.propagate_analyzed_to_canonical() from public, anon, authenticated;

select private.propagate_analyzed_to_canonical();
