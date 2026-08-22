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

commit;
