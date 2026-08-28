-- v0.76.0 — serialize active-season switches so a failed second update can
-- never leave the project between seasons.

create or replace function public.admin_set_active_season_v0760(
  p_season_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.seasons;
begin
  perform pg_advisory_xact_lock(hashtext('mxm-active-season-v0760'));

  if p_active then
    update public.seasons
       set active = false
     where active = true
       and id <> p_season_id;
  end if;

  update public.seasons
     set active = p_active
   where id = p_season_id
   returning * into v_row;

  if not found then
    raise exception 'Season not found';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'active', v_row.active,
    'weekNumber', v_row.week_number,
    'startsAt', v_row.starts_at,
    'endsAt', v_row.ends_at
  );
end;
$$;

revoke all on function public.admin_set_active_season_v0760(uuid,boolean) from public, anon, authenticated;
grant execute on function public.admin_set_active_season_v0760(uuid,boolean) to service_role;
