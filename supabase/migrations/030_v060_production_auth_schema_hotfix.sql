begin;

-- Production hotfix: restore objects required by auth/profile flows.
-- Safe additive migration.

create or replace view public.profile_financial_overview with (security_invoker=true) as
with holding_value as (
  select h.profile_id, coalesce(sum(h.quantity*c.current_price),0) as coin_value
  from public.holdings h
  join public.coins c on c.id = h.coin_id
  where h.quantity > 0
  group by h.profile_id
), gift_value as (
  select vg.owner_profile_id as profile_id,
         coalesce(sum(coalesce(ga.estimated_value,0)),0) as gift_value
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id = vg.asset_id
  where coalesce(ga.is_burned,false)=false
  group by vg.owner_profile_id
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
 p.balance + coalesce(h.coin_value,0) + coalesce(g.gift_value,0) as net_worth,
 0::numeric as realized_pnl,
 0::bigint as coin_trade_count,
 0::bigint as gift_trade_count,
 0::bigint as gift_count,
 0::numeric as created_coin_market_cap
from public.profiles p
left join holding_value h on h.profile_id=p.id
left join gift_value g on g.profile_id=p.id;

grant select on public.profile_financial_overview to service_role;

commit;
