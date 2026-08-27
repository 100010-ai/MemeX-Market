-- MemeX Market v0.67.0
-- Source-backed product analytics, lightweight presence and professional admin RBAC.

create table if not exists public.admin_members_v067 (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'operator', 'moderator', 'analyst')),
  permissions text[] not null default '{}'::text[],
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_members_v067_active_role_idx
  on public.admin_members_v067 (active, role);

alter table public.admin_members_v067 enable row level security;
revoke all on table public.admin_members_v067 from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_members_v067 to service_role;

create table if not exists public.profile_presence_v067 (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_id text not null check (session_id ~ '^[A-Za-z0-9._:-]{8,80}$'),
  bucket_start timestamptz not null,
  route text not null default '/market' check (char_length(route) between 1 and 96 and route like '/%'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (profile_id, session_id, bucket_start)
);

create index if not exists profile_presence_v067_bucket_idx
  on public.profile_presence_v067 (bucket_start desc);
create index if not exists profile_presence_v067_profile_bucket_idx
  on public.profile_presence_v067 (profile_id, bucket_start desc);
create index if not exists profile_presence_v067_route_bucket_idx
  on public.profile_presence_v067 (route, bucket_start desc);

alter table public.profile_presence_v067 enable row level security;
revoke all on table public.profile_presence_v067 from public, anon, authenticated;
grant select, insert, update, delete on table public.profile_presence_v067 to service_role;

create or replace function public.touch_profile_presence_v067(
  p_profile_id uuid,
  p_session_id text,
  p_route text default '/market'
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bucket timestamptz := date_bin(interval '5 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  v_route text := left(split_part(coalesce(nullif(trim(p_route), ''), '/market'), '?', 1), 96);
begin
  if p_session_id is null or p_session_id !~ '^[A-Za-z0-9._:-]{8,80}$' then
    raise exception 'invalid presence session';
  end if;
  if v_route not like '/%' then v_route := '/market'; end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and not coalesce(p.is_system, false)
      and not (
        coalesce(p.is_banned, false)
        and (p.banned_until is null or p.banned_until > now())
      )
  ) then
    return;
  end if;

  insert into public.profile_presence_v067 (
    profile_id, session_id, bucket_start, route, first_seen_at, last_seen_at
  ) values (
    p_profile_id, p_session_id, v_bucket, v_route, now(), now()
  )
  on conflict (profile_id, session_id, bucket_start) do update
  set route = excluded.route,
      last_seen_at = greatest(public.profile_presence_v067.last_seen_at, excluded.last_seen_at);
end;
$$;

revoke execute on function public.touch_profile_presence_v067(uuid, text, text) from public, anon, authenticated;
grant execute on function public.touch_profile_presence_v067(uuid, text, text) to service_role;

create or replace function public.admin_analytics_v067(p_days integer default 30)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public, pg_temp
as $$
declare
  v_days integer := greatest(7, least(90, coalesce(p_days, 30)));
  v_start date := current_date - (greatest(7, least(90, coalesce(p_days, 30))) - 1);
  v_previous_start date := current_date - ((greatest(7, least(90, coalesce(p_days, 30))) * 2) - 1);
  v_tracking_started_at timestamptz;
  v_summary jsonb;
  v_daily jsonb;
  v_funnel jsonb;
  v_retention jsonb;
  v_routes jsonb;
begin
  select min(bucket_start) into v_tracking_started_at from public.profile_presence_v067;

  with activity_raw as (
    select profile_id, bucket_start::date as activity_date
    from public.profile_presence_v067
    where bucket_start >= v_previous_start
    union all
    select profile_id, created_at::date
    from public.economy_events
    where profile_id is not null and created_at >= v_previous_start
    union all
    select profile_id, created_at::date
    from public.trades
    where profile_id is not null and created_at >= v_previous_start
    union all
    select buyer_profile_id, created_at::date
    from public.gift_trades
    where buyer_profile_id is not null and created_at >= v_previous_start
    union all
    select seller_profile_id, created_at::date
    from public.gift_trades
    where seller_profile_id is not null and created_at >= v_previous_start
    union all
    select profile_id, coalesce(paid_at, created_at)::date
    from public.star_purchases
    where profile_id is not null and status = 'paid' and coalesce(paid_at, created_at) >= v_previous_start
    union all
    select actor_profile_id, created_at::date
    from public.market_events
    where actor_profile_id is not null and created_at >= v_previous_start
  ), activity as (
    select distinct a.profile_id, a.activity_date
    from activity_raw a
    join public.profiles p on p.id = a.profile_id
    where not coalesce(p.is_system, false)
  ), period_traders as (
    select profile_id from public.trades
    where created_at::date between v_start and current_date and not coalesce(is_launch_seed, false)
    union
    select buyer_profile_id from public.gift_trades where created_at::date between v_start and current_date
    union
    select seller_profile_id from public.gift_trades where created_at::date between v_start and current_date
  ), period_payers as (
    select distinct profile_id from public.star_purchases
    where status = 'paid' and coalesce(paid_at, created_at)::date between v_start and current_date
  ), trade_totals as (
    select
      coalesce((select count(*) from public.trades where created_at::date between v_start and current_date and not coalesce(is_launch_seed, false)), 0)
        + coalesce((select count(*) from public.gift_trades where created_at::date between v_start and current_date), 0) as trades,
      coalesce((select sum(abs(quote_amount)) from public.trades where created_at::date between v_start and current_date and not coalesce(is_launch_seed, false)), 0)
        + coalesce((select sum(price) from public.gift_trades where created_at::date between v_start and current_date), 0) as turnover
  ), presence_totals as (
    select
      count(distinct session_id) as sessions,
      coalesce(round(count(*) * 5.0 / nullif(count(distinct session_id), 0), 1), 0) as avg_session_minutes
    from public.profile_presence_v067
    where bucket_start::date between v_start and current_date
  )
  select jsonb_build_object(
    'onlineNow', (select count(distinct profile_id) from public.profile_presence_v067 where last_seen_at >= now() - interval '5 minutes'),
    'activeToday', (select count(distinct profile_id) from activity where activity_date = current_date),
    'activePeriod', (select count(distinct profile_id) from activity where activity_date between v_start and current_date),
    'activePrevious', (select count(distinct profile_id) from activity where activity_date between v_previous_start and v_start - 1),
    'newPeriod', (select count(*) from public.profiles where not coalesce(is_system, false) and created_at::date between v_start and current_date),
    'newPrevious', (select count(*) from public.profiles where not coalesce(is_system, false) and created_at::date between v_previous_start and v_start - 1),
    'returningPeriod', (select count(distinct a.profile_id) from activity a join public.profiles p on p.id = a.profile_id where a.activity_date between v_start and current_date and p.created_at::date < v_start),
    'sessions', (select sessions from presence_totals),
    'avgSessionMinutes', (select avg_session_minutes from presence_totals),
    'traders', (select count(*) from period_traders),
    'payers', (select count(*) from period_payers),
    'referredNew', (select count(*) from public.profiles where not coalesce(is_system, false) and referrer_profile_id is not null and created_at::date between v_start and current_date),
    'trades', (select trades from trade_totals),
    'turnover', (select turnover from trade_totals),
    'stars', (select coalesce(sum(stars), 0) from public.star_purchases where status = 'paid' and coalesce(paid_at, created_at)::date between v_start and current_date)
  ) into v_summary;

  with dates as (
    select generate_series(v_start, current_date, interval '1 day')::date as day
  ), activity_raw as (
    select profile_id, bucket_start::date as day from public.profile_presence_v067 where bucket_start::date between v_start and current_date
    union all select profile_id, created_at::date from public.economy_events where profile_id is not null and created_at::date between v_start and current_date
    union all select profile_id, created_at::date from public.trades where profile_id is not null and created_at::date between v_start and current_date
    union all select buyer_profile_id, created_at::date from public.gift_trades where created_at::date between v_start and current_date
    union all select seller_profile_id, created_at::date from public.gift_trades where created_at::date between v_start and current_date
    union all select profile_id, coalesce(paid_at, created_at)::date from public.star_purchases where profile_id is not null and status = 'paid' and coalesce(paid_at, created_at)::date between v_start and current_date
    union all select actor_profile_id, created_at::date from public.market_events where actor_profile_id is not null and created_at::date between v_start and current_date
  ), activity as (
    select distinct a.profile_id, a.day from activity_raw a join public.profiles p on p.id = a.profile_id where not coalesce(p.is_system, false)
  ), daily_presence as (
    select bucket_start::date as day, count(distinct session_id) as sessions, count(*) * 5 as session_minutes
    from public.profile_presence_v067 where bucket_start::date between v_start and current_date group by 1
  ), daily_trades as (
    select day, sum(trades)::bigint as trades, sum(turnover)::numeric as turnover
    from (
      select created_at::date as day, count(*) as trades, coalesce(sum(abs(quote_amount)), 0) as turnover
      from public.trades where created_at::date between v_start and current_date and not coalesce(is_launch_seed, false) group by 1
      union all
      select created_at::date, count(*), coalesce(sum(price), 0)
      from public.gift_trades where created_at::date between v_start and current_date group by 1
    ) t group by day
  ), daily_stars as (
    select coalesce(paid_at, created_at)::date as day, sum(stars)::bigint as stars
    from public.star_purchases where status = 'paid' and coalesce(paid_at, created_at)::date between v_start and current_date group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', to_char(d.day, 'YYYY-MM-DD'),
    'newPlayers', (select count(*) from public.profiles p where not coalesce(p.is_system, false) and p.created_at::date = d.day),
    'activePlayers', (select count(distinct profile_id) from activity a where a.day = d.day),
    'returningPlayers', (select count(distinct a.profile_id) from activity a join public.profiles p on p.id = a.profile_id where a.day = d.day and p.created_at::date < d.day),
    'sessions', coalesce(dp.sessions, 0),
    'sessionMinutes', coalesce(dp.session_minutes, 0),
    'trades', coalesce(dt.trades, 0),
    'turnover', coalesce(dt.turnover, 0),
    'stars', coalesce(ds.stars, 0)
  ) order by d.day), '[]'::jsonb)
  into v_daily
  from dates d
  left join daily_presence dp on dp.day = d.day
  left join daily_trades dt on dt.day = d.day
  left join daily_stars ds on ds.day = d.day;

  with new_users as (
    select id from public.profiles
    where not coalesce(is_system, false) and created_at::date between v_start and current_date
  ), active_new as (
    select distinct n.id from new_users n
    where exists (
      select 1 from public.profile_presence_v067 pp where pp.profile_id = n.id and pp.bucket_start::date between v_start and current_date
      union all select 1 from public.economy_events ee where ee.profile_id = n.id and ee.created_at::date between v_start and current_date
      union all select 1 from public.trades t where t.profile_id = n.id and t.created_at::date between v_start and current_date
    )
  ), trader_new as (
    select distinct n.id from new_users n where exists (
      select 1 from public.trades t where t.profile_id = n.id and not coalesce(t.is_launch_seed, false) and t.created_at::date between v_start and current_date
      union all select 1 from public.gift_trades gt where (gt.buyer_profile_id = n.id or gt.seller_profile_id = n.id) and gt.created_at::date between v_start and current_date
    )
  ), payer_new as (
    select distinct n.id from new_users n join public.star_purchases sp on sp.profile_id = n.id
    where sp.status = 'paid' and coalesce(sp.paid_at, sp.created_at)::date between v_start and current_date
  )
  select jsonb_build_array(
    jsonb_build_object('key', 'registered', 'label', 'Регистрация', 'value', (select count(*) from new_users)),
    jsonb_build_object('key', 'active', 'label', 'Активировались', 'value', (select count(*) from active_new)),
    jsonb_build_object('key', 'trader', 'label', 'Совершили сделку', 'value', (select count(*) from trader_new)),
    jsonb_build_object('key', 'payer', 'label', 'Оплатили Stars', 'value', (select count(*) from payer_new))
  ) into v_funnel;

  with offsets as (
    select * from (values (1, 'D1'), (7, 'D7'), (30, 'D30')) v(day_offset, label)
  ), eligible as (
    select o.day_offset, o.label, p.id, p.created_at::date as joined
    from offsets o
    join public.profiles p on not coalesce(p.is_system, false)
      and p.created_at::date between current_date - 90 and current_date - o.day_offset
  ), retained as (
    select e.day_offset, e.id
    from eligible e
    where exists (
      select 1 from public.profile_presence_v067 pp where pp.profile_id = e.id and pp.bucket_start::date = e.joined + e.day_offset
      union all select 1 from public.economy_events ee where ee.profile_id = e.id and ee.created_at::date = e.joined + e.day_offset
      union all select 1 from public.trades t where t.profile_id = e.id and t.created_at::date = e.joined + e.day_offset
      union all select 1 from public.gift_trades gt where (gt.buyer_profile_id = e.id or gt.seller_profile_id = e.id) and gt.created_at::date = e.joined + e.day_offset
      union all select 1 from public.star_purchases sp where sp.profile_id = e.id and sp.status = 'paid' and coalesce(sp.paid_at, sp.created_at)::date = e.joined + e.day_offset
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'label', point.label,
    'days', point.day_offset,
    'eligible', point.eligible,
    'retained', point.retained,
    'rate', point.rate
  ) order by point.day_offset), '[]'::jsonb)
  into v_retention
  from (
    select
      o.day_offset,
      o.label,
      count(distinct e.id) as eligible,
      count(distinct r.id) as retained,
      case when count(distinct e.id) = 0 then 0 else round(count(distinct r.id) * 100.0 / count(distinct e.id), 1) end as rate
    from offsets o
    left join eligible e on e.day_offset = o.day_offset
    left join retained r on r.day_offset = o.day_offset and r.id = e.id
    group by o.day_offset, o.label
  ) point;

  select coalesce(jsonb_agg(jsonb_build_object('route', route, 'visitors', visitors, 'sessions', sessions) order by visitors desc, sessions desc), '[]'::jsonb)
  into v_routes
  from (
    select route, count(distinct profile_id) as visitors, count(distinct session_id) as sessions
    from public.profile_presence_v067
    where bucket_start::date between v_start and current_date
    group by route
    order by visitors desc, sessions desc
    limit 8
  ) top_routes;

  return jsonb_build_object(
    'periodDays', v_days,
    'periodStart', to_char(v_start, 'YYYY-MM-DD'),
    'periodEnd', to_char(current_date, 'YYYY-MM-DD'),
    'trackingStartedAt', v_tracking_started_at,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'daily', coalesce(v_daily, '[]'::jsonb),
    'funnel', coalesce(v_funnel, '[]'::jsonb),
    'retention', coalesce(v_retention, '[]'::jsonb),
    'topRoutes', coalesce(v_routes, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_analytics_v067(integer) from public, anon, authenticated;
grant execute on function public.admin_analytics_v067(integer) to service_role;
