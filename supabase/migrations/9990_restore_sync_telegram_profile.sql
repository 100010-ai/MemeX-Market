
-- Restores the Telegram profile sync RPC required by app/api/auth/telegram.
-- Apply this migration in Supabase SQL Editor if migrations are not run automatically.

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
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  insert into public.profiles(
    telegram_id,
    username,
    first_name,
    last_name,
    photo_url
  )
  values (
    p_telegram_id,
    nullif(p_username,''),
    coalesce(nullif(trim(coalesce(p_first_name,'')),''),'Telegram User'),
    nullif(p_last_name,''),
    nullif(p_photo_url,'')
  )
  on conflict (telegram_id) do update set
    username = excluded.username,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    photo_url = excluded.photo_url,
    updated_at = now()
  returning * into v_profile;

  perform public.ensure_user_missions(v_profile.id);
  perform public.bump_mission(v_profile.id, 'open_app', 1);

  return v_profile;
end;
$$;
