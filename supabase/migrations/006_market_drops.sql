begin;

-- ---------------------------------------------------------------------------
-- Catalog/drop bootstrap: lets an admin seed the market from real Telegram
-- Gift collections owned by configured Telegram accounts, without relying on
-- any individual player syncing + listing their own inventory first.
--
-- Additive only: no existing column/table/RPC is renamed, dropped, or has its
-- signature changed. The economy (buy/sell/offer/list/AMM/missions/realtime)
-- is untouched by this migration.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists is_system boolean not null default false;

-- Index used by the admin inventory query (system-owned, unlisted virtual gifts).
create index if not exists virtual_gifts_owner_status_idx on public.virtual_gifts (owner_profile_id, status);

-- System/treasury profiles are inventory holders, not players: exclude them
-- from the public leaderboard so catalog float never shows up as a "top
-- player" balance or PnL.
drop view if exists public.leaderboard;

create or replace view public.leaderboard with (security_invoker=true) as
select
  p.id,p.telegram_id,p.username,p.first_name,p.photo_url,p.balance,
  coalesce((select sum(h.quantity*c.current_price) from public.holdings h join public.coins c on c.id=h.coin_id where h.profile_id=p.id),0) as coin_value,
  coalesce((select sum(coalesce(gmo.estimated_value,0)) from public.gift_market_overview gmo where gmo.owner_profile_id=p.id and gmo.is_burned=false),0) as gift_value,
  p.balance
    + coalesce((select sum(h.quantity*c.current_price) from public.holdings h join public.coins c on c.id=h.coin_id where h.profile_id=p.id),0)
    + coalesce((select sum(coalesce(gmo.estimated_value,0)) from public.gift_market_overview gmo where gmo.owner_profile_id=p.id and gmo.is_burned=false),0) as net_worth,
  coalesce((select sum(t.realized_pnl) from public.trades t where t.profile_id=p.id),0) as coin_realized_pnl,
  coalesce((select sum(gt.realized_pnl) from public.gift_trades gt where gt.seller_profile_id=p.id),0) as gift_realized_pnl,
  coalesce((select sum(t.realized_pnl) from public.trades t where t.profile_id=p.id),0)
    + coalesce((select sum(gt.realized_pnl) from public.gift_trades gt where gt.seller_profile_id=p.id),0) as realized_pnl,
  coalesce((select count(*) from public.trades t where t.profile_id=p.id),0) as coin_trade_count,
  coalesce((select count(*) from public.gift_trades gt where gt.buyer_profile_id=p.id or gt.seller_profile_id=p.id),0) as gift_trade_count,
  coalesce((select count(*) from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id where vg.owner_profile_id=p.id and ga.is_burned=false),0) as gift_count,
  coalesce((select sum(c.market_cap) from public.coins c where c.creator_profile_id=p.id and c.status='active'),0) as created_coin_market_cap
from public.profiles p
where p.is_system = false;

grant select on public.leaderboard to service_role;

commit;
