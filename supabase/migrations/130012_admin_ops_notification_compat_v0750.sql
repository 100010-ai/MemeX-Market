begin;

create or replace function public.admin_broadcast_notification_v075(
  p_audience text,
  p_title text,
  p_body text,
  p_href text default '/hub',
  p_dedupe_base text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text := coalesce(nullif(trim(p_dedupe_base), ''), 'broadcast-' || floor(extract(epoch from now()))::bigint::text);
  v_inserted integer := 0;
begin
  if p_audience not in ('all','active7d','premium','referrers') then raise exception 'invalid_audience'; end if;
  if length(trim(coalesce(p_title,''))) < 1 or length(p_title) > 120 then raise exception 'invalid_title'; end if;
  if length(trim(coalesce(p_body,''))) < 1 or length(p_body) > 1000 then raise exception 'invalid_body'; end if;

  insert into public.user_notifications(profile_id, kind, title, body, href, metadata, dedupe_key)
  select p.id, 'system', trim(p_title), trim(p_body), coalesce(nullif(trim(p_href),''), '/hub'),
         jsonb_build_object('audience', p_audience, 'source', 'admin_broadcast'), v_base || ':' || p.id::text
  from public.profiles p
  left join public.profile_activity_totals_v074 a on a.profile_id = p.id
  where p.is_system = false
    and p.is_banned = false
    and (
      p_audience = 'all'
      or (p_audience = 'active7d' and a.last_activity_at >= now() - interval '7 days')
      or (p_audience = 'premium' and p.premium_until > now())
      or (p_audience = 'referrers' and exists(select 1 from public.profiles r where r.referrer_profile_id = p.id))
    )
  order by p.created_at desc
  limit 5000
  on conflict (profile_id, dedupe_key) where dedupe_key is not null do nothing;

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('ok', true, 'audience', p_audience, 'inserted', v_inserted, 'dedupeBase', v_base);
end;
$$;

revoke all on function public.admin_broadcast_notification_v075(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_broadcast_notification_v075(text,text,text,text,text) to service_role;

commit;
