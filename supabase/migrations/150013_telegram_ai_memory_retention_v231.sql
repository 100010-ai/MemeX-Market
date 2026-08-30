begin;

create index if not exists telegram_ai_messages_v230_created_at_idx
  on public.telegram_ai_messages_v230(created_at);

create or replace function public.prune_telegram_ai_memory_v231()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  if mod(new.id, 100) = 0 then
    delete from public.telegram_ai_messages_v230
    where created_at < now() - interval '30 days';
  end if;
  return new;
end;
$$;

drop trigger if exists telegram_ai_memory_retention_v231 on public.telegram_ai_messages_v230;
create trigger telegram_ai_memory_retention_v231
after insert on public.telegram_ai_messages_v230
for each row execute function public.prune_telegram_ai_memory_v231();

revoke all on function public.prune_telegram_ai_memory_v231() from public, anon, authenticated;

commit;
