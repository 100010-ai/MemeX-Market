-- Control Center v2.12: make OTP request throttling atomic under concurrent requests.

create or replace function public.create_control_login_challenge_v212(
  p_telegram_id bigint,
  p_code_hash text,
  p_expires_at timestamptz,
  p_max_requests integer default 5,
  p_window_seconds integer default 600
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_count integer;
  v_max integer := greatest(1, least(coalesce(p_max_requests, 5), 20));
  v_window integer := greatest(60, least(coalesce(p_window_seconds, 600), 3600));
begin
  if p_telegram_id is null or p_code_hash is null or length(p_code_hash) < 32 then
    raise exception 'Invalid control login challenge';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 minutes' then
    raise exception 'Invalid control login expiry';
  end if;

  -- Serialize challenge creation for one Telegram account. The previous
  -- select-count-then-insert flow allowed several simultaneous requests to
  -- all pass the same limit before any of them inserted a row.
  perform pg_advisory_xact_lock(p_telegram_id);

  select count(*)::integer into v_count
  from public.control_login_challenges_v210
  where telegram_id = p_telegram_id
    and created_at >= now() - make_interval(secs => v_window);

  if v_count >= v_max then
    raise exception 'CONTROL_LOGIN_RATE_LIMIT';
  end if;

  insert into public.control_login_challenges_v210(telegram_id, code_hash, expires_at)
  values(p_telegram_id, p_code_hash, p_expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_control_login_challenge_v212(bigint,text,timestamptz,integer,integer) from public, anon, authenticated;
grant execute on function public.create_control_login_challenge_v212(bigint,text,timestamptz,integer,integer) to service_role;
