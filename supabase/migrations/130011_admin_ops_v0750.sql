begin;

create or replace function public.admin_adjust_profile_resources_v075(
  p_profile_id uuid,
  p_balance_delta numeric default 0,
  p_mxm_delta bigint default 0,
  p_energy_delta integer default 0,
  p_xp_delta bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
begin
  select * into v_before from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  if abs(coalesce(p_balance_delta, 0)) > 1000000 then raise exception 'balance_delta_too_large'; end if;
  if abs(coalesce(p_mxm_delta, 0)) > 1000000000 then raise exception 'mxm_delta_too_large'; end if;
  if abs(coalesce(p_energy_delta, 0)) > 100000 then raise exception 'energy_delta_too_large'; end if;
  if abs(coalesce(p_xp_delta, 0)) > 100000000 then raise exception 'xp_delta_too_large'; end if;

  update public.profiles
  set balance = greatest(0, balance + coalesce(p_balance_delta, 0)),
      mxm_coins = greatest(0, mxm_coins + coalesce(p_mxm_delta, 0)),
      energy = greatest(0, least(max_energy, energy + coalesce(p_energy_delta, 0))),
      xp = greatest(0, xp + coalesce(p_xp_delta, 0)),
      updated_at = now()
  where id = p_profile_id
  returning * into v_after;

  return jsonb_build_object(
    'profileId', p_profile_id,
    'before', jsonb_build_object('balance', v_before.balance, 'mxm', v_before.mxm_coins, 'energy', v_before.energy, 'xp', v_before.xp),
    'after', jsonb_build_object('balance', v_after.balance, 'mxm', v_after.mxm_coins, 'energy', v_after.energy, 'xp', v_after.xp)
  );
end;
$$;

revoke all on function public.admin_adjust_profile_resources_v075(uuid,numeric,bigint,integer,bigint) from public, anon, authenticated;
grant execute on function public.admin_adjust_profile_resources_v075(uuid,numeric,bigint,integer,bigint) to service_role;

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
  select p.id, 'admin_broadcast', trim(p_title), trim(p_body), coalesce(nullif(trim(p_href),''), '/hub'),
         jsonb_build_object('audience', p_audience), v_base || ':' || p.id::text
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
