begin;

-- Production hotfix: preserve the complete financial-view contract used by
-- /api/me and leaderboard. CREATE OR REPLACE VIEW cannot safely shrink a view
-- that has dependent views, so all historical columns remain present.
create or replace view public.profile_financial_overview with (security_invoker=true) as
with holding_value as (
  select h.profile_id,coalesce(sum(h.quantity*c.current_price),0) as coin_value
  from public.holdings h join public.coins c on c.id=h.coin_id
  where h.quantity>0 group by h.profile_id
), gift_value as (
  select owner_profile_id as profile_id,coalesce(sum(coalesce(estimated_value,0)),0) as gift_value
  from public.gift_market_overview
  where coalesce(is_burned,false)=false
  group by owner_profile_id
), coin_stats as (
  select profile_id,coalesce(sum(realized_pnl),0) as coin_realized_pnl,count(*)::bigint as coin_trade_count
  from public.trades group by profile_id
), gift_sell_stats as (
  select seller_profile_id as profile_id,coalesce(sum(realized_pnl),0) as gift_realized_pnl
  from public.gift_trades where seller_profile_id is not null group by seller_profile_id
), gift_trade_people as (
  select buyer_profile_id as profile_id from public.gift_trades
  union all
  select seller_profile_id from public.gift_trades where seller_profile_id is not null
), gift_trade_stats as (
  select profile_id,count(*)::bigint as gift_trade_count from gift_trade_people group by profile_id
), gift_counts as (
  select vg.owner_profile_id as profile_id,count(*)::bigint as gift_count
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where coalesce(ga.is_burned,false)=false group by vg.owner_profile_id
), creator_caps as (
  select creator_profile_id as profile_id,coalesce(sum(market_cap),0) as created_coin_market_cap
  from public.coins where creator_profile_id is not null and status='active' group by creator_profile_id
)
select
  p.id,p.telegram_id,p.username,p.first_name,p.photo_url,p.balance,
  coalesce(h.coin_value,0) as coin_value,
  coalesce(g.gift_value,0) as gift_value,
  p.balance+coalesce(h.coin_value,0)+coalesce(g.gift_value,0) as net_worth,
  coalesce(cs.coin_realized_pnl,0) as coin_realized_pnl,
  coalesce(gs.gift_realized_pnl,0) as gift_realized_pnl,
  coalesce(cs.coin_realized_pnl,0)+coalesce(gs.gift_realized_pnl,0) as realized_pnl,
  coalesce(cs.coin_trade_count,0) as coin_trade_count,
  coalesce(gt.gift_trade_count,0) as gift_trade_count,
  coalesce(gc.gift_count,0) as gift_count,
  coalesce(cc.created_coin_market_cap,0) as created_coin_market_cap
from public.profiles p
left join holding_value h on h.profile_id=p.id
left join gift_value g on g.profile_id=p.id
left join coin_stats cs on cs.profile_id=p.id
left join gift_sell_stats gs on gs.profile_id=p.id
left join gift_trade_stats gt on gt.profile_id=p.id
left join gift_counts gc on gc.profile_id=p.id
left join creator_caps cc on cc.profile_id=p.id;

grant select on public.profile_financial_overview to service_role;

commit;
