begin;

create table if not exists public.telegram_ai_chat_state_v231 (
  chat_id bigint not null,
  thread_id bigint not null default 0,
  lease_token uuid null,
  busy_until timestamptz null,
  last_reply_at timestamptz null,
  window_started_at timestamptz not null default now(),
  window_count integer not null default 0 check (window_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (chat_id, thread_id)
);

create table if not exists public.telegram_ai_sender_state_v231 (
  sender_telegram_id bigint primary key,
  window_started_at timestamptz not null default now(),
  window_count integer not null default 0 check (window_count >= 0),
  last_request_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.telegram_ai_chat_state_v231 enable row level security;
alter table public.telegram_ai_sender_state_v231 enable row level security;

revoke all on table public.telegram_ai_chat_state_v231 from public, anon, authenticated;
revoke all on table public.telegram_ai_sender_state_v231 from public, anon, authenticated;
grant select, insert, update, delete on table public.telegram_ai_chat_state_v231 to service_role;
grant select, insert, update, delete on table public.telegram_ai_sender_state_v231 to service_role;

create or replace function public.claim_telegram_ai_turn_v231(
  p_chat_id bigint,
  p_thread_id bigint default 0,
  p_sender_telegram_id bigint default 0,
  p_is_private boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_thread_id bigint := coalesce(p_thread_id, 0);
  v_now timestamptz := clock_timestamp();
  v_chat public.telegram_ai_chat_state_v231%rowtype;
  v_sender public.telegram_ai_sender_state_v231%rowtype;
  v_token uuid;
  v_chat_limit integer := case when coalesce(p_is_private, false) then 24 else 12 end;
  v_sender_limit integer := case when coalesce(p_is_private, false) then 20 else 10 end;
  v_min_gap interval := case when coalesce(p_is_private, false) then interval '700 milliseconds' else interval '1200 milliseconds' end;
  v_retry_ms integer;
begin
  if p_chat_id is null or p_chat_id = 0 or p_sender_telegram_id is null or p_sender_telegram_id <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_identity', 'retryAfterMs', 0);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mxm-ai-chat:' || p_chat_id::text || ':' || v_thread_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('mxm-ai-sender:' || p_sender_telegram_id::text, 0));

  insert into public.telegram_ai_chat_state_v231(chat_id, thread_id)
  values (p_chat_id, v_thread_id)
  on conflict (chat_id, thread_id) do nothing;

  insert into public.telegram_ai_sender_state_v231(sender_telegram_id)
  values (p_sender_telegram_id)
  on conflict (sender_telegram_id) do nothing;

  select * into v_chat
  from public.telegram_ai_chat_state_v231
  where chat_id = p_chat_id and thread_id = v_thread_id
  for update;

  select * into v_sender
  from public.telegram_ai_sender_state_v231
  where sender_telegram_id = p_sender_telegram_id
  for update;

  if v_chat.busy_until is not null and v_chat.busy_until > v_now then
    v_retry_ms := greatest(100, ceil(extract(epoch from (v_chat.busy_until - v_now)) * 1000)::integer);
    return jsonb_build_object('ok', false, 'reason', 'busy', 'retryAfterMs', v_retry_ms);
  end if;

  if v_chat.last_reply_at is not null and v_chat.last_reply_at + v_min_gap > v_now then
    v_retry_ms := greatest(100, ceil(extract(epoch from ((v_chat.last_reply_at + v_min_gap) - v_now)) * 1000)::integer);
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'retryAfterMs', v_retry_ms);
  end if;

  if v_chat.window_started_at <= v_now - interval '1 minute' then
    update public.telegram_ai_chat_state_v231
    set window_started_at = v_now, window_count = 0, updated_at = v_now
    where chat_id = p_chat_id and thread_id = v_thread_id;
    v_chat.window_started_at := v_now;
    v_chat.window_count := 0;
  end if;

  if v_sender.window_started_at <= v_now - interval '1 minute' then
    update public.telegram_ai_sender_state_v231
    set window_started_at = v_now, window_count = 0, updated_at = v_now
    where sender_telegram_id = p_sender_telegram_id;
    v_sender.window_started_at := v_now;
    v_sender.window_count := 0;
  end if;

  if v_chat.window_count >= v_chat_limit then
    v_retry_ms := greatest(1000, ceil(extract(epoch from ((v_chat.window_started_at + interval '1 minute') - v_now)) * 1000)::integer);
    return jsonb_build_object('ok', false, 'reason', 'chat_rate_limit', 'retryAfterMs', v_retry_ms);
  end if;

  if v_sender.window_count >= v_sender_limit then
    v_retry_ms := greatest(1000, ceil(extract(epoch from ((v_sender.window_started_at + interval '1 minute') - v_now)) * 1000)::integer);
    return jsonb_build_object('ok', false, 'reason', 'sender_rate_limit', 'retryAfterMs', v_retry_ms);
  end if;

  v_token := gen_random_uuid();

  update public.telegram_ai_chat_state_v231
  set lease_token = v_token,
      busy_until = v_now + interval '28 seconds',
      window_count = window_count + 1,
      updated_at = v_now
  where chat_id = p_chat_id and thread_id = v_thread_id;

  update public.telegram_ai_sender_state_v231
  set window_count = window_count + 1,
      last_request_at = v_now,
      updated_at = v_now
  where sender_telegram_id = p_sender_telegram_id;

  return jsonb_build_object('ok', true, 'token', v_token::text, 'reason', null, 'retryAfterMs', 0);
end;
$$;

create or replace function public.release_telegram_ai_turn_v231(
  p_chat_id bigint,
  p_thread_id bigint default 0,
  p_lease_token uuid default null,
  p_replied boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_updated integer;
begin
  if p_lease_token is null then return false; end if;

  update public.telegram_ai_chat_state_v231
  set lease_token = null,
      busy_until = null,
      last_reply_at = case when coalesce(p_replied, false) then clock_timestamp() else last_reply_at end,
      updated_at = clock_timestamp()
  where chat_id = p_chat_id
    and thread_id = coalesce(p_thread_id, 0)
    and lease_token = p_lease_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_telegram_ai_turn_v231(bigint,bigint,bigint,boolean) from public, anon, authenticated;
revoke all on function public.release_telegram_ai_turn_v231(bigint,bigint,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_telegram_ai_turn_v231(bigint,bigint,bigint,boolean) to service_role;
grant execute on function public.release_telegram_ai_turn_v231(bigint,bigint,uuid,boolean) to service_role;

commit;
