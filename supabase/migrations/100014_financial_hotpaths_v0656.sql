-- MemeX Market v0.65.6
-- Financial hot paths: scan Gift inventory once for both value and count,
-- and keep single-profile snapshots targeted to the requested profile.

create or replace view public.profile_financial_overview
with (security_invoker=true)
as
with holding_value as (
  select
    h.profile_id,
    coalesce(sum(h.quantity*c.current_price),0) as coin_value
  from public.holdings h
  join public.coins c on c.id=h.coin_id
  where h.quantity>0
  group by h.profile_id
), gift_stats as (
  select
    vg.owner_profile_id as profile_id,
    coalesce(sum(coalesce(
      case
        when ga.telegram_resale_price_ton is not null
          and ga.telegram_resale_price_ton>0
          and (ga.resale_seen_at is null or ga.resale_seen_at>=now()-interval '24 hours')
        then ga.telegram_resale_price_ton
      end,
      vg.last_sale_price,
      vg.acquired_price,
      0
    )),0) as gift_value,
    count(*) as gift_count
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id=vg.asset_id
  where coalesce(ga.is_burned,false)=false
  group by vg.owner_profile_id
), coin_stats as (
  select
    t.profile_id,
    coalesce(sum(t.realized_pnl),0) as coin_realized_pnl,
    count(*) as coin_trade_count
  from public.trades t
  where not coalesce(t.is_launch_seed,false)
  group by t.profile_id
), gift_sell_stats as (
  select
    gt.seller_profile_id as profile_id,
    coalesce(sum(gt.realized_pnl),0) as gift_realized_pnl
  from public.gift_trades gt
  where gt.seller_profile_id is not null
  group by gt.seller_profile_id
), gift_trade_people as (
  select gt.buyer_profile_id as profile_id
  from public.gift_trades gt
  union all
  select gt.seller_profile_id as profile_id
  from public.gift_trades gt
  where gt.seller_profile_id is not null
), gift_trade_stats as (
  select profile_id,count(*) as gift_trade_count
  from gift_trade_people
  group by profile_id
), creator_caps as (
  select
    c.creator_profile_id as profile_id,
    coalesce(sum(c.market_cap),0) as created_coin_market_cap
  from public.coins c
  where c.creator_profile_id is not null
    and c.status='active'
  group by c.creator_profile_id
)
select
  p.id,
  p.telegram_id,
  p.username,
  p.first_name,
  p.photo_url,
  p.balance,
  coalesce(h.coin_value,0) as coin_value,
  coalesce(g.gift_value,0) as gift_value,
  p.balance+coalesce(h.coin_value,0)+coalesce(g.gift_value,0) as net_worth,
  coalesce(cs.coin_realized_pnl,0) as coin_realized_pnl,
  coalesce(gs.gift_realized_pnl,0) as gift_realized_pnl,
  coalesce(cs.coin_realized_pnl,0)+coalesce(gs.gift_realized_pnl,0) as realized_pnl,
  coalesce(cs.coin_trade_count,0::bigint) as coin_trade_count,
  coalesce(gt.gift_trade_count,0::bigint) as gift_trade_count,
  coalesce(g.gift_count,0::bigint) as gift_count,
  coalesce(cc.created_coin_market_cap,0) as created_coin_market_cap
from public.profiles p
left join holding_value h on h.profile_id=p.id
left join gift_stats g on g.profile_id=p.id
left join coin_stats cs on cs.profile_id=p.id
left join gift_sell_stats gs on gs.profile_id=p.id
left join gift_trade_stats gt on gt.profile_id=p.id
left join creator_caps cc on cc.profile_id=p.id;

create or replace function public.profile_snapshot_v040(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'balance',p.balance,
    'reservedBalance',coalesce(public.reserved_market_balance_v056(p.id,null,null,null),0),
    'coinValue',coalesce(h.coin_value,0),
    'giftValue',coalesce(g.gift_value,0),
    'netWorth',p.balance+coalesce(h.coin_value,0)+coalesce(g.gift_value,0),
    'realizedPnl',coalesce(cs.coin_realized_pnl,0)+coalesce(gs.gift_realized_pnl,0)
  )
  from public.profiles p
  left join lateral (
    select coalesce(sum(h.quantity*c.current_price),0) as coin_value
    from public.holdings h
    join public.coins c on c.id=h.coin_id
    where h.profile_id=p.id and h.quantity>0
  ) h on true
  left join lateral (
    select coalesce(sum(coalesce(
      case
        when ga.telegram_resale_price_ton is not null
          and ga.telegram_resale_price_ton>0
          and (ga.resale_seen_at is null or ga.resale_seen_at>=now()-interval '24 hours')
        then ga.telegram_resale_price_ton
      end,
      vg.last_sale_price,
      vg.acquired_price,
      0
    )),0) as gift_value
    from public.virtual_gifts vg
    join public.gift_assets ga on ga.id=vg.asset_id
    where vg.owner_profile_id=p.id
      and coalesce(ga.is_burned,false)=false
  ) g on true
  left join lateral (
    select coalesce(sum(t.realized_pnl),0) as coin_realized_pnl
    from public.trades t
    where t.profile_id=p.id
      and not coalesce(t.is_launch_seed,false)
  ) cs on true
  left join lateral (
    select coalesce(sum(gt.realized_pnl),0) as gift_realized_pnl
    from public.gift_trades gt
    where gt.seller_profile_id=p.id
  ) gs on true
  where p.id=p_profile_id;
$$;