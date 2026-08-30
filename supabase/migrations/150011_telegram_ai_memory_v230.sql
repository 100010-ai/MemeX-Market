begin;

create table if not exists public.telegram_ai_messages_v230 (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  thread_id bigint not null default 0,
  telegram_message_id bigint null,
  sender_telegram_id bigint null,
  role text not null check (role in ('user','assistant')),
  sender_name text null check (sender_name is null or char_length(sender_name) <= 120),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists telegram_ai_messages_v230_context_idx
  on public.telegram_ai_messages_v230(chat_id, thread_id, created_at desc, id desc);

create unique index if not exists telegram_ai_messages_v230_message_idx
  on public.telegram_ai_messages_v230(chat_id, thread_id, role, telegram_message_id)
  where telegram_message_id is not null;

alter table public.telegram_ai_messages_v230 enable row level security;
revoke all on table public.telegram_ai_messages_v230 from anon, authenticated;
grant select, insert, update, delete on table public.telegram_ai_messages_v230 to service_role;
grant usage, select on sequence public.telegram_ai_messages_v230_id_seq to service_role;

create or replace function public.telegram_ai_history_v230(
  p_chat_id bigint,
  p_thread_id bigint default 0,
  p_limit integer default 18
)
returns table(role text, content text, sender_name text, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $$
  select h.role, h.content, h.sender_name, h.created_at
  from (
    select m.role, m.content, m.sender_name, m.created_at, m.id
    from public.telegram_ai_messages_v230 m
    where m.chat_id = p_chat_id
      and m.thread_id = coalesce(p_thread_id, 0)
      and m.created_at >= now() - interval '30 days'
    order by m.created_at desc, m.id desc
    limit greatest(2, least(coalesce(p_limit, 18), 30))
  ) h
  order by h.created_at asc, h.id asc;
$$;

revoke all on function public.telegram_ai_history_v230(bigint,bigint,integer) from public, anon, authenticated;
grant execute on function public.telegram_ai_history_v230(bigint,bigint,integer) to service_role;

commit;
