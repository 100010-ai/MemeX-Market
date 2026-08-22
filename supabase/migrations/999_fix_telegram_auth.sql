-- Final compatibility repair for Telegram auth.
-- This file intentionally mirrors the current production contract so that,
-- even though it sorts after the other 999x repair migrations, it cannot
-- regress sync_telegram_profile by dropping mission hooks or null handling.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null default 'Telegram User',
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
  if p_telegram_id is null or p_telegram_id <= 0 then
    raise exception 'invalid telegram id' using errcode = '22023';
  end if;

  insert into public.profiles(telegram_id, username, first_name, last_name, photo_url)
  values (
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

  -- These functions are part of the current application contract and are
  -- created by the mission migrations that precede this final repair.
  perform public.ensure_user_missions(v_profile.id);
  perform public.bump_mission(v_profile.id, 'open_app', 1);

  return v_profile;
end;
$$;

revoke execute on function public.sync_telegram_profile(bigint,text,text,text,text) from public, anon, authenticated;
grant execute on function public.sync_telegram_profile(bigint,text,text,text,text) to service_role;

commit;
