-- MemeX Market v0.66.1
-- Restore the VIP activity ledger required by create_coin_v200.
--
-- Some production databases were provisioned from the reduced Economy 2.0
-- bootstrap and have profiles.vip_points but not the ledger/function. The
-- launch RPC calls credit_vip_activity_v200 after all AMM writes, so the
-- missing dependency rolled the entire launch transaction back.

create table if not exists public.vip_point_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_kind text not null check(source_kind in ('coin_buy','coin_sell','coin_launch')),
  reference_id uuid not null,
  activity_value numeric(24,8) not null check(activity_value>0),
  points integer not null check(points between 0 and 100),
  created_at timestamptz not null default now(),
  unique(source_kind,reference_id)
);

create index if not exists vip_point_events_profile_day_v200_idx
  on public.vip_point_events(profile_id,created_at desc);

alter table public.vip_point_events enable row level security;
revoke all on public.vip_point_events from public,anon,authenticated;
grant all on public.vip_point_events to service_role;

create or replace function public.credit_vip_activity_v200(
  p_profile_id uuid,
  p_source_kind text,
  p_activity_value numeric,
  p_reference_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing public.vip_point_events;
  v_requested integer:=0;
  v_granted integer:=0;
  v_day_points integer:=0;
  v_daily_cap constant integer:=100;
  v_day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  v_valid boolean:=false;
begin
  if p_source_kind not in ('coin_buy','coin_sell','coin_launch')
     or p_reference_id is null
     or p_activity_value is null
     or p_activity_value<=0 then
    raise exception 'Invalid VIP activity';
  end if;

  if p_source_kind in ('coin_buy','coin_sell') then
    select exists(
      select 1
      from public.trades t
      where t.id=p_reference_id
        and t.profile_id=p_profile_id
        and t.side=case when p_source_kind='coin_buy' then 'buy' else 'sell' end
        and abs(t.quote_amount-p_activity_value)<=0.00000002
    ) into v_valid;
    if not v_valid then raise exception 'VIP trade reference mismatch'; end if;
    v_requested:=floor(least(p_activity_value,25))::integer;
  else
    select exists(
      select 1
      from public.coins c
      cross join public.economy_settings e
      where c.id=p_reference_id
        and c.creator_profile_id=p_profile_id
        and e.singleton=true
        and abs((c.initial_buy_quote+e.coin_launch_fee)-p_activity_value)<=0.00000002
    ) into v_valid;
    if not v_valid then raise exception 'VIP launch reference mismatch'; end if;
    v_requested:=50;
  end if;

  if v_requested<=0 then
    return jsonb_build_object('points',0,'requested',0,'dailyCap',v_daily_cap,'reason','minimum_activity');
  end if;

  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_existing
  from public.vip_point_events
  where source_kind=p_source_kind and reference_id=p_reference_id;
  if found then
    if v_existing.profile_id<>p_profile_id
       or abs(v_existing.activity_value-p_activity_value)>0.00000002 then
      raise exception 'VIP activity reference was already used';
    end if;
    return jsonb_build_object(
      'points',v_existing.points,
      'requested',v_requested,
      'dailyCap',v_daily_cap,
      'alreadyCredited',true
    );
  end if;

  select coalesce(sum(points),0)::integer into v_day_points
  from public.vip_point_events
  where profile_id=p_profile_id
    and created_at>=v_day_start
    and created_at<v_day_start+interval '1 day';

  v_granted:=least(v_requested,greatest(0,v_daily_cap-v_day_points));
  insert into public.vip_point_events(profile_id,source_kind,reference_id,activity_value,points)
  values(p_profile_id,p_source_kind,p_reference_id,p_activity_value,v_granted);

  if v_granted>0 then
    update public.profiles
    set vip_points=vip_points+v_granted,updated_at=now()
    where id=p_profile_id;
  end if;

  return jsonb_build_object(
    'points',v_granted,
    'requested',v_requested,
    'dailyCap',v_daily_cap,
    'dailyEarned',v_day_points+v_granted,
    'alreadyCredited',false,
    'reason',case when v_granted<v_requested then 'daily_cap' else null end
  );
end;
$$;

-- This is an internal helper called by privileged settlement functions. It is
-- deliberately not exposed as a PostgREST RPC, including to service_role.
revoke execute on function public.credit_vip_activity_v200(uuid,text,numeric,uuid)
  from public,anon,authenticated,service_role;
