-- v0.76.0 — weekly seasons are a schedule, not a singleton flag.
-- v0.71 intentionally keeps all 52 weekly rows enabled and resolves the
-- current week by starts_at/ends_at. Admin toggles must therefore touch only
-- the selected row.

update public.seasons
   set active = true
 where week_number is not null;

update public.seasons
   set active = false
 where season_key = 'market-2-launch';

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
  perform pg_advisory_xact_lock(hashtext('mxm-season-enable-v0760'));

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
