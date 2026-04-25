-- Suchender zieht eine Match-Anfrage zurück.
-- Funktioniert für eingeloggte (auth.uid()) und anonyme (p_anonymous_id) Seekers.
-- Hard-Delete: sauberer Zustand, Re-Like möglich falls Meinung sich ändert.

create or replace function public.seeker_withdraw_match(
  p_match_id uuid,
  p_anonymous_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_owner_uid uuid;
  v_match_anon_id text;
begin
  if p_match_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_match_id');
  end if;

  select sp.user_id, sp.anonymous_id
    into v_match_owner_uid, v_match_anon_id
    from matches m
    join search_profiles sp on sp.id = m.search_profile_id
   where m.id = p_match_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'match_not_found');
  end if;

  if v_user_id is not null and v_match_owner_uid = v_user_id then
    -- ok: eingeloggter Eigentümer
    null;
  elsif p_anonymous_id is not null and v_match_anon_id = p_anonymous_id then
    -- ok: passender Cookie
    null;
  else
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from matches where id = p_match_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.seeker_withdraw_match(uuid, text) from public;
grant execute on function public.seeker_withdraw_match(uuid, text) to anon, authenticated;
