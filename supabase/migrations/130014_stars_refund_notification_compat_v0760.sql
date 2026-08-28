-- v0.76.0 — activity kinds are richer than notification kinds.
-- A private `stars_refund` activity must create a supported `system`
-- notification instead of copying the activity kind into user_notifications.

create or replace function public.notify_activity_event_v074()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
  v_body text;
  v_href text;
begin
  if new.visibility <> 'private' or new.audience_profile_id is null then
    return new;
  end if;

  if new.kind = 'stars_refund' then
    v_title := 'Возврат Stars обработан';
    v_body := case coalesce(new.metadata->>'status', '')
      when 'reversed' then 'Виртуальная покупка автоматически отозвана.'
      when 'partial' then 'Возврат обработан частично. Некоторые уже использованные награды требуют сверки.'
      else 'Возврат принят и отправлен на проверку.'
    end;
    v_href := '/store';
  else
    return new;
  end if;

  perform public.create_notification_v074(
    new.audience_profile_id,
    'system',
    v_title,
    v_body,
    v_href,
    coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('activityKind', new.kind),
    'activity:' || new.dedupe_key
  );
  return new;
end;
$$;

revoke all on function public.notify_activity_event_v074() from public, anon, authenticated;
grant execute on function public.notify_activity_event_v074() to service_role;
