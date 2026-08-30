begin;

create index if not exists virtual_gifts_owner_cost_basis_v0650_idx
  on public.virtual_gifts(owner_profile_id)
  include (acquired_price, asset_id);

create or replace function public.gift_inventory_cost_basis_v0650(p_profile_id uuid)
returns numeric
language sql
stable
security invoker
set search_path to 'public'
as $$
  select coalesce(sum(g.acquired_price), 0)::numeric
  from public.virtual_gifts g
  join public.gift_assets a on a.id = g.asset_id
  where g.owner_profile_id = p_profile_id
    and coalesce(a.is_burned, false) = false;
$$;

create or replace function public.sync_telegram_profile(
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_photo_url text
)
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles;
begin
  if p_telegram_id is null or p_telegram_id <= 0 then
    raise exception 'invalid telegram id' using errcode = '22023';
  end if;

  insert into public.profiles(telegram_id, username, first_name, last_name, photo_url)
  values(
    p_telegram_id,
    nullif(trim(coalesce(p_username, '')), ''),
    coalesce(nullif(trim(coalesce(p_first_name, '')), ''), 'Telegram User'),
    nullif(trim(coalesce(p_last_name, '')), ''),
    nullif(trim(coalesce(p_photo_url, '')), '')
  )
  on conflict (telegram_id) do update set
    username = excluded.username,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    photo_url = excluded.photo_url,
    updated_at = now()
  returning * into v_profile;

  begin
    perform public.ensure_user_missions(v_profile.id);
    perform public.bump_mission(v_profile.id, 'open_app', 1);
  exception when others then
    raise warning 'telegram profile mission side effect skipped for profile %: %', v_profile.id, sqlerrm;
  end;

  return v_profile;
end;
$$;

commit;
