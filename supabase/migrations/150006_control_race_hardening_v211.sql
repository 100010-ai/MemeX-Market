-- Control Center v2.11 race hardening.
-- 1) OTP consumption is atomic and single-use under concurrent verification.
-- 2) Broadcast batches use a short DB lease so retries/tabs cannot send the same page twice.

alter table public.control_broadcasts_v210
  add column if not exists batch_lock_token uuid,
  add column if not exists batch_lock_until timestamptz;

create index if not exists control_broadcasts_v210_batch_lock_idx
  on public.control_broadcasts_v210 (batch_lock_until)
  where status in ('queued','sending');

create or replace function public.consume_control_login_challenge_v211(
  p_telegram_id bigint,
  p_code_hash text,
  p_max_attempts integer default 6
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_hash text;
  v_attempts integer;
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts, 6), 20));
begin
  select id, code_hash, attempts
    into v_id, v_hash, v_attempts
  from public.control_login_challenges_v210
  where telegram_id = p_telegram_id
    and used_at is null
    and expires_at > now()
  order by created_at desc
  for update
  limit 1;

  if v_id is null or coalesce(v_attempts, 0) >= v_max_attempts then
    return false;
  end if;

  if coalesce(v_hash, '') = coalesce(p_code_hash, '') then
    update public.control_login_challenges_v210
    set used_at = now()
    where id = v_id
      and used_at is null;
    return found;
  end if;

  update public.control_login_challenges_v210
  set attempts = least(20, coalesce(v_attempts, 0) + 1)
  where id = v_id
    and used_at is null;

  return false;
end;
$$;

revoke all on function public.consume_control_login_challenge_v211(bigint,text,integer) from public, anon, authenticated;
grant execute on function public.consume_control_login_challenge_v211(bigint,text,integer) to service_role;

create or replace function public.claim_control_broadcast_batch_v211(
  p_id uuid,
  p_lock_token uuid,
  p_lock_seconds integer default 300
)
returns setof public.control_broadcasts_v210
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_seconds integer := greatest(30, least(coalesce(p_lock_seconds, 300), 600));
begin
  if p_id is null or p_lock_token is null then
    return;
  end if;

  return query
  update public.control_broadcasts_v210
  set status = 'sending',
      batch_lock_token = p_lock_token,
      batch_lock_until = now() + make_interval(secs => v_lock_seconds),
      updated_at = now()
  where id = p_id
    and status in ('queued','sending')
    and (batch_lock_until is null or batch_lock_until < now())
  returning *;
end;
$$;

revoke all on function public.claim_control_broadcast_batch_v211(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_control_broadcast_batch_v211(uuid,uuid,integer) to service_role;
