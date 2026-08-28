begin;

alter table public.user_notifications add column if not exists dedupe_key text;
create unique index if not exists user_notifications_dedupe_v074_idx
  on public.user_notifications(profile_id,dedupe_key) where dedupe_key is not null;

create or replace function public.create_notification_v074(
  p_profile_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_href text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_key text:=nullif(left(trim(coalesce(p_dedupe_key,'')),180),'');
begin
  if coalesce(length(trim(p_kind)),0)<2 then raise exception 'Notification kind missing'; end if;
  if coalesce(length(trim(p_title)),0)<1 then raise exception 'Notification title missing'; end if;
  if v_key is null then
    insert into public.user_notifications(profile_id,kind,title,body,href,metadata)
    values(p_profile_id,left(trim(p_kind),80),left(trim(p_title),180),left(coalesce(p_body,''),1000),nullif(left(trim(coalesce(p_href,'')),500),''),coalesce(p_metadata,'{}'::jsonb))
    returning id into v_id;
  else
    insert into public.user_notifications(profile_id,kind,title,body,href,metadata,dedupe_key)
    values(p_profile_id,left(trim(p_kind),80),left(trim(p_title),180),left(coalesce(p_body,''),1000),nullif(left(trim(coalesce(p_href,'')),500),''),coalesce(p_metadata,'{}'::jsonb),v_key)
    on conflict(profile_id,dedupe_key) where dedupe_key is not null do update set
      title=excluded.title,body=excluded.body,href=excluded.href,metadata=public.user_notifications.metadata||excluded.metadata
    returning id into v_id;
  end if;
  return v_id;
end;$$;

create or replace function public.notify_activity_event_v074()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_title text; v_body text; v_href text;
begin
  if new.visibility<>'private' or new.audience_profile_id is null then return new; end if;
  if new.kind='stars_refund' then
    v_title:='Возврат Stars обработан';
    v_body:=case coalesce(new.metadata->>'status','') when 'reversed' then 'Виртуальная покупка автоматически отозвана.' when 'partial' then 'Возврат обработан частично. Некоторые уже использованные награды требуют сверки.' else 'Возврат принят и отправлен на проверку.' end;
    v_href:='/store';
  else return new; end if;
  perform public.create_notification_v074(new.audience_profile_id,new.kind,v_title,v_body,v_href,new.metadata,'activity:'||new.dedupe_key);
  return new;
end;$$;
drop trigger if exists notify_activity_event_v074 on public.activity_events_v074;
create trigger notify_activity_event_v074 after insert or update on public.activity_events_v074 for each row execute function public.notify_activity_event_v074();

revoke execute on function public.create_notification_v074(uuid,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_notification_v074(uuid,text,text,text,text,jsonb,text) to service_role;
commit;
