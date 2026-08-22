begin;

-- Production repair: recreate the financial/leaderboard views from base tables
-- only. This intentionally does not depend on gift_market_overview so the repair
-- also works when a previous migration dropped or failed to create that view.

alter table public.profiles
  add column if not exists is_system boolean not null default false,
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists banned_until timestamptz,
  add column if not exists hidden_from_leaderboard boolean not null default false;

alter table public.gift_assets
  add column if not exists is_burned boolean not null default false,
  add column if not exists telegram_resale_price_ton numeric(24,9),
  add column if not exists resale_seen_at timestamptz;

-- A stale/missing dependent leaderboard must not prevent the financial view
-- from being repaired. It is recreated below with the full current contract.
drop view if exists public.leaderboard;
drop view if exists public.profile_financial_overview;

create view public.profile_financial_overview with (security_invoker=true) as
with holding_value as (
  select
    h.profile_id,
    coalesce(sum(h.quantity * c.current_price), 0)::numeric as coin_value
  from public.holdings h
  join public.coins c on c.id = h.coin_id
  where h.quantity > 0
  group by h.profile_id
),
gift_value as (
  select
    vg.owner_profile_id as profile_id,
    coalesce(sum(
      coalesce(
        case
          when ga.telegram_resale_price_ton is not null
            and ga.telegram_resale_price_ton > 0
            and (ga.resale_seen_at is null or ga.resale_seen_at >= now() - interval '24 hours')
          then ga.telegram_resale_price_ton
        end,
        vg.last_sale_price,
        vg.acquired_price,
        0
      )
    ), 0)::numeric as gift_value
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id = vg.asset_id
  where coalesce(ga.is_burned, false) = false
  group by vg.owner_profile_id
),
coin_stats as (
  select
    t.profile_id,
    coalesce(sum(t.realized_pnl), 0)::numeric as coin_realized_pnl,
    count(*)::bigint as coin_trade_count
  from public.trades t
  group by t.profile_id
),
gift_sell_stats as (
  select
    gt.seller_profile_id as profile_id,
    coalesce(sum(gt.realized_pnl), 0)::numeric as gift_realized_pnl
  from public.gift_trades gt
  where gt.seller_profile_id is not null
  group by gt.seller_profile_id
),
gift_trade_people as (
  select gt.buyer_profile_id as profile_id
  from public.gift_trades gt
  union all
  select gt.seller_profile_id as profile_id
  from public.gift_trades gt
  where gt.seller_profile_id is not null
),
gift_trade_stats as (
  select profile_id, count(*)::bigint as gift_trade_count
  from gift_trade_people
  group by profile_id
),
gift_counts as (
  select
    vg.owner_profile_id as profile_id,
    count(*)::bigint as gift_count
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id = vg.asset_id
  where coalesce(ga.is_burned, false) = false
  group by vg.owner_profile_id
),
creator_caps as (
  select
    c.creator_profile_id as profile_id,
    coalesce(sum(c.market_cap), 0)::numeric as created_coin_market_cap
  from public.coins c
  where c.creator_profile_id is not null
    and c.status = 'active'
  group by c.creator_profile_id
)
select
  p.id,
  p.telegram_id,
  p.username,
  p.first_name,
  p.photo_url,
  p.balance,
  coalesce(h.coin_value, 0)::numeric as coin_value,
  coalesce(g.gift_value, 0)::numeric as gift_value,
  (p.balance + coalesce(h.coin_value, 0) + coalesce(g.gift_value, 0))::numeric as net_worth,
  coalesce(cs.coin_realized_pnl, 0)::numeric as coin_realized_pnl,
  coalesce(gs.gift_realized_pnl, 0)::numeric as gift_realized_pnl,
  (coalesce(cs.coin_realized_pnl, 0) + coalesce(gs.gift_realized_pnl, 0))::numeric as realized_pnl,
  coalesce(cs.coin_trade_count, 0)::bigint as coin_trade_count,
  coalesce(gt.gift_trade_count, 0)::bigint as gift_trade_count,
  coalesce(gc.gift_count, 0)::bigint as gift_count,
  coalesce(cc.created_coin_market_cap, 0)::numeric as created_coin_market_cap
from public.profiles p
left join holding_value h on h.profile_id = p.id
left join gift_value g on g.profile_id = p.id
left join coin_stats cs on cs.profile_id = p.id
left join gift_sell_stats gs on gs.profile_id = p.id
left join gift_trade_stats gt on gt.profile_id = p.id
left join gift_counts gc on gc.profile_id = p.id
left join creator_caps cc on cc.profile_id = p.id;

create view public.leaderboard with (security_invoker=true) as
select
  f.id,
  f.telegram_id,
  f.username,
  f.first_name,
  f.photo_url,
  f.balance,
  f.coin_value,
  f.gift_value,
  f.net_worth,
  f.coin_realized_pnl,
  f.gift_realized_pnl,
  f.realized_pnl,
  f.coin_trade_count,
  f.gift_trade_count,
  f.gift_count,
  f.created_coin_market_cap
from public.profile_financial_overview f
join public.profiles p on p.id = f.id
where coalesce(p.is_system, false) = false
  and coalesce(p.hidden_from_leaderboard, false) = false
  and not (
    coalesce(p.is_banned, false) = true
    and (p.banned_until is null or p.banned_until > now())
  );

grant select on public.profile_financial_overview to service_role;
grant select on public.leaderboard to service_role;

-- Fail here, with a useful message, instead of letting the application discover
-- a half-created schema later.
do $$
begin
  if to_regclass('public.profile_financial_overview') is null then
    raise exception 'profile_financial_overview repair failed';
  end if;
  if to_regclass('public.leaderboard') is null then
    raise exception 'leaderboard repair failed';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Runtime objects required by /api/me and /api/portfolio.
-- ---------------------------------------------------------------------------
create table if not exists public.portfolio_snapshots (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  bucket_start timestamptz not null,
  balance numeric(24,8) not null default 0,
  coin_value numeric(24,8) not null default 0,
  gift_value numeric(24,8) not null default 0,
  net_worth numeric(24,8) not null default 0,
  realized_pnl numeric(24,8) not null default 0,
  primary key(profile_id,bucket_start)
);
create index if not exists portfolio_snapshots_profile_v300_idx on public.portfolio_snapshots(profile_id,bucket_start desc);
alter table public.portfolio_snapshots enable row level security;
revoke all on public.portfolio_snapshots from public,anon,authenticated;
grant all on public.portfolio_snapshots to service_role;

create or replace function public.profile_snapshot_v040(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'balance',p.balance,
    'reservedBalance',coalesce(public.reserved_market_balance_v056(p.id,null,null,null),0),
    'coinValue',coalesce(f.coin_value,0),
    'giftValue',coalesce(f.gift_value,0),
    'netWorth',coalesce(f.net_worth,p.balance),
    'realizedPnl',coalesce(f.realized_pnl,0)
  )
  from public.profiles p
  left join public.profile_financial_overview f on f.id=p.id
  where p.id=p_profile_id;
$$;
revoke execute on function public.profile_snapshot_v040(uuid) from public,anon,authenticated;
grant execute on function public.profile_snapshot_v040(uuid) to service_role;

create or replace function public.session_profile_snapshot_v040(p_telegram_id bigint)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'id',p.id,'telegram_id',p.telegram_id,'username',p.username,'first_name',p.first_name,'last_name',p.last_name,'photo_url',p.photo_url,
    'balance',p.balance,'xp',p.xp,'last_gift_sync_at',p.last_gift_sync_at,'is_banned',p.is_banned,'banned_until',p.banned_until,'created_at',p.created_at,
    'reserved_balance',coalesce(public.reserved_market_balance_v056(p.id,null,null,null),0),
    'coin_value',coalesce(f.coin_value,0),'gift_value',coalesce(f.gift_value,0),'net_worth',coalesce(f.net_worth,p.balance),'realized_pnl',coalesce(f.realized_pnl,0)
  )
  from public.profiles p
  left join public.profile_financial_overview f on f.id=p.id
  where p.telegram_id=p_telegram_id;
$$;
revoke execute on function public.session_profile_snapshot_v040(bigint) from public,anon,authenticated;
grant execute on function public.session_profile_snapshot_v040(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Price-alert transition is atomic: one worker can trigger/re-arm a row once.
-- ---------------------------------------------------------------------------
create or replace function public.process_price_alert_transition_v300(
  p_alert_id uuid,
  p_price numeric,
  p_hit boolean,
  p_title text,
  p_body text,
  p_href text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_alert public.price_alerts;
begin
  if p_alert_id is null or p_price is null or p_price < 0 then return 'invalid'; end if;
  select * into v_alert from public.price_alerts where id=p_alert_id for update;
  if not found then return 'missing'; end if;
  if not v_alert.enabled then return 'disabled'; end if;

  if p_hit and not v_alert.is_triggered then
    update public.price_alerts
    set is_triggered=true,last_triggered_at=now(),updated_at=now()
    where id=v_alert.id;
    perform public.push_notification_v048(
      v_alert.profile_id,'price_alert',left(coalesce(p_title,'Price alert'),180),left(coalesce(p_body,''),500),p_href,
      coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('alertId',v_alert.id,'price',p_price,'target',v_alert.target_price,'direction',v_alert.direction)
    );
    return 'triggered';
  elsif not p_hit and v_alert.is_triggered then
    update public.price_alerts set is_triggered=false,updated_at=now() where id=v_alert.id;
    return 'rearmed';
  end if;
  return 'noop';
end;
$$;
revoke execute on function public.process_price_alert_transition_v300(uuid,numeric,boolean,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.process_price_alert_transition_v300(uuid,numeric,boolean,text,text,text,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Telegram notification delivery claim. SKIP LOCKED prevents duplicate sends
-- when cron invocations overlap. Stale claims are automatically reclaimable.
-- ---------------------------------------------------------------------------
alter table public.user_notifications
  add column if not exists telegram_claim_token uuid,
  add column if not exists telegram_claimed_at timestamptz;
create index if not exists user_notifications_delivery_v300_idx
  on public.user_notifications(created_at)
  where telegram_sent_at is null;

create or replace function public.claim_pending_notifications_v300(p_claim_token uuid,p_limit integer default 50)
returns table(id uuid,profile_id uuid,title text,body text,href text)
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_claim_token is null then return; end if;
  return query
  with candidates as (
    select n.id
    from public.user_notifications n
    where n.telegram_sent_at is null
      and (n.telegram_claim_token is null or n.telegram_claimed_at < now()-interval '5 minutes')
    order by n.created_at asc
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  ), claimed as (
    update public.user_notifications n
    set telegram_claim_token=p_claim_token,telegram_claimed_at=now()
    from candidates c
    where n.id=c.id
    returning n.id,n.profile_id,n.title,n.body,n.href
  )
  select c.id,c.profile_id,c.title,c.body,c.href from claimed c;
end;
$$;
revoke execute on function public.claim_pending_notifications_v300(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_pending_notifications_v300(uuid,integer) to service_role;

-- ---------------------------------------------------------------------------
-- Telegram webhook update idempotency. A failed/stale update may be retried;
-- a processed or currently owned update is ignored.
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_webhook_updates_v300 (
  update_id bigint primary key,
  status text not null default 'processing' check(status in ('processing','processed','failed')),
  started_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.telegram_webhook_updates_v300 enable row level security;
revoke all on public.telegram_webhook_updates_v300 from public,anon,authenticated;
grant all on public.telegram_webhook_updates_v300 to service_role;

create or replace function public.claim_telegram_webhook_update_v300(p_update_id bigint)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_row public.telegram_webhook_updates_v300;
begin
  if p_update_id is null or p_update_id < 0 then return false; end if;
  select * into v_row from public.telegram_webhook_updates_v300 where update_id=p_update_id for update;
  if not found then
    insert into public.telegram_webhook_updates_v300(update_id,status,started_at) values(p_update_id,'processing',now());
    return true;
  end if;
  if v_row.status='processed' then return false; end if;
  if v_row.status='processing' and v_row.started_at >= now()-interval '5 minutes' then return false; end if;
  update public.telegram_webhook_updates_v300 set status='processing',started_at=now(),processed_at=null,error=null where update_id=p_update_id;
  return true;
end;
$$;
revoke execute on function public.claim_telegram_webhook_update_v300(bigint) from public,anon,authenticated;
grant execute on function public.claim_telegram_webhook_update_v300(bigint) to service_role;

-- Current Telegram profile sync must tolerate missing names and preserve the
-- mission hooks expected by the application.
create or replace function public.sync_telegram_profile(
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_photo_url text
)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare v_profile public.profiles;
begin
  insert into public.profiles(telegram_id,username,first_name,last_name,photo_url)
  values(
    p_telegram_id,
    nullif(trim(coalesce(p_username,'')),''),
    coalesce(nullif(trim(coalesce(p_first_name,'')),''),'Telegram User'),
    nullif(trim(coalesce(p_last_name,'')),''),
    nullif(trim(coalesce(p_photo_url,'')),'')
  )
  on conflict(telegram_id) do update set
    username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name,photo_url=excluded.photo_url,updated_at=now()
  returning * into v_profile;
  perform public.ensure_user_missions(v_profile.id);
  perform public.bump_mission(v_profile.id,'open_app',1);
  return v_profile;
end;
$$;
revoke execute on function public.sync_telegram_profile(bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.sync_telegram_profile(bigint,text,text,text,text) to service_role;

-- Contract assertions: abort the migration instead of leaving a half-upgraded DB.
do $$
begin
  if to_regclass('public.profile_financial_overview') is null then raise exception 'profile_financial_overview missing'; end if;
  if to_regclass('public.leaderboard') is null then raise exception 'leaderboard missing'; end if;
  if to_regclass('public.portfolio_snapshots') is null then raise exception 'portfolio_snapshots missing'; end if;
  if to_regclass('public.telegram_webhook_updates_v300') is null then raise exception 'telegram_webhook_updates_v300 missing'; end if;
end $$;


commit;
