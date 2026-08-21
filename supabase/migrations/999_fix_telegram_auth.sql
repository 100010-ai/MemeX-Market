begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null,
  last_name text,
  photo_url text,
  balance numeric(24,8) not null default 100,
  last_gift_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  insert into public.profiles(telegram_id, username, first_name, last_name, photo_url)
  values (
    p_telegram_id,
    nullif(p_username,''),
    coalesce(nullif(trim(p_first_name),''),'Telegram User'),
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

  return v_profile;
end;
$$;

grant execute on function public.sync_telegram_profile(bigint,text,text,text,text) to service_role;

commit;
