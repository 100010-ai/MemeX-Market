-- MemeX Market v0.65.4
-- Global hardening: gift collection hot paths, function ACLs/search_path, and transactional FK indexes.

-- Trigger/helper functions should not inherit a caller-controlled search_path.
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.mission_period_key(text) set search_path = public, pg_temp;
alter function public.account_level_v064(bigint) set search_path = public, pg_temp;
alter function public.daily_streak_reward_v064(integer) set search_path = public, pg_temp;
alter function public.season_prestige_reward_v064(integer) set search_path = public, pg_temp;

-- These functions are server/trigger helpers. They do not need a public PostgREST RPC surface.
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.touch_updated_at() to service_role;
revoke execute on function public.public_profile_stats_v056(uuid) from public, anon, authenticated;
grant execute on function public.public_profile_stats_v056(uuid) to service_role;

-- Keep one copy of each identical index pair reported by the database linter.
drop index if exists public.gift_offers_gift_pending_idx;
drop index if exists public.gift_offers_pending_expiry_v4_idx;
drop index if exists public.portfolio_snapshots_profile_v048_idx;
drop index if exists public.price_alerts_profile_v4_idx;
drop index if exists public.user_notifications_profile_v4_idx;
drop index if exists public.user_notifications_unread_v4_idx;
drop index if exists public.virtual_gifts_owner_idx;
drop index if exists public.virtual_gifts_listing_expiry_v4_idx;

-- Cover high-growth transactional foreign keys. These indexes also reduce FK maintenance work
-- when referenced rows are updated/deleted and keep relation joins predictable as traffic grows.
create index if not exists coins_creator_profile_v0654_idx on public.coins(creator_profile_id);
create index if not exists holdings_coin_v0654_idx on public.holdings(coin_id);
create index if not exists coin_fee_ledger_coin_v0654_idx on public.coin_fee_ledger(coin_id, created_at desc);
create index if not exists coin_fee_ledger_trader_v0654_idx on public.coin_fee_ledger(trader_profile_id, created_at desc);
create index if not exists coin_launch_requests_profile_v0654_idx on public.coin_launch_requests(profile_id, created_at desc);
create index if not exists coin_launch_requests_coin_v0654_idx on public.coin_launch_requests(coin_id);
create index if not exists coin_trade_requests_coin_v0654_idx on public.coin_trade_requests(coin_id, created_at desc);
create index if not exists coin_early_buyers_profile_v0654_idx on public.coin_early_buyers(profile_id, coin_id);
create index if not exists coin_early_buyers_trade_v0654_idx on public.coin_early_buyers(first_trade_id) where first_trade_id is not null;
create index if not exists creator_token_locks_profile_v0654_idx on public.creator_token_locks(profile_id, ends_at desc);
create index if not exists market_cart_items_gift_v0654_idx on public.market_cart_items(virtual_gift_id);
create index if not exists market_events_actor_v0654_idx on public.market_events(actor_profile_id, created_at desc);
create index if not exists market_events_coin_v0654_idx on public.market_events(coin_id, created_at desc) where coin_id is not null;
create index if not exists market_events_gift_v0654_idx on public.market_events(virtual_gift_id, created_at desc) where virtual_gift_id is not null;
create index if not exists gift_listing_events_actor_v0654_idx on public.gift_listing_events(actor_profile_id, created_at desc) where actor_profile_id is not null;
create index if not exists gift_purchase_requests_gift_v0654_idx on public.gift_purchase_requests(virtual_gift_id);
create index if not exists npc_market_log_asset_v0654_idx on public.npc_market_log(asset_id, created_at desc);
create index if not exists npc_market_log_profile_v0654_idx on public.npc_market_log(npc_profile_id, created_at desc);
create index if not exists npc_market_log_gift_v0654_idx on public.npc_market_log(virtual_gift_id, created_at desc);
create index if not exists price_alerts_coin_v0654_idx on public.price_alerts(coin_id, created_at desc) where coin_id is not null;
create index if not exists price_alerts_gift_v0654_idx on public.price_alerts(virtual_gift_id, created_at desc) where virtual_gift_id is not null;
create index if not exists user_watchlist_coin_v0654_idx on public.user_watchlist(coin_id) where coin_id is not null;
create index if not exists user_watchlist_gift_v0654_idx on public.user_watchlist(virtual_gift_id) where virtual_gift_id is not null;
create index if not exists virtual_gifts_source_owner_v0654_idx on public.virtual_gifts(source_owner_profile_id) where source_owner_profile_id is not null;

-- The old view let the planner scan all ~14k wide gift_assets rows before discovering that
-- only the much smaller virtual_gifts market set was relevant. Materializing that small set
-- first makes the hot collection endpoint predictable and avoids the pathological join plan.
create or replace view public.gift_collection_overview
with (security_invoker=true)
as
with settings as (
  select external_quote_hours
  from public.market_settings
  where singleton=true
), policy as (
  select mode
  from public.gift_market_liquidity_policy
  where singleton=true
), market_gifts as materialized (
  select
    vg.asset_id,
    vg.owner_profile_id,
    vg.status,
    vg.listing_price,
    vg.listing_expires_at
  from public.virtual_gifts vg
  join public.profiles owner_profile on owner_profile.id=vg.owner_profile_id
  cross join policy pol
  where pol.mode<>'player_only' or coalesce(owner_profile.is_system,false)=false
), collection_base as (
  select
    ga.base_name,
    count(*) as item_count,
    count(distinct mg.owner_profile_id) as holder_count,
    count(*) filter(
      where mg.status='listed'
        and mg.listing_price is not null
        and (mg.listing_expires_at is null or mg.listing_expires_at>now())
    ) as listed_count,
    min(mg.listing_price) filter(
      where mg.status='listed'
        and mg.listing_price is not null
        and (mg.listing_expires_at is null or mg.listing_expires_at>now())
    ) as floor_price,
    min(ga.telegram_resale_price_ton) filter(
      where ga.telegram_resale_price_ton is not null
        and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
    ) as external_floor
  from market_gifts mg
  join public.gift_assets ga on ga.id=mg.asset_id
  cross join settings ms
  where ga.is_burned=false
  group by ga.base_name,ms.external_quote_hours
), trade_stats as (
  select
    ga.base_name,
    coalesce(sum(gt.price) filter(where gt.created_at>=now()-interval '24 hours'),0::numeric) as volume_24h,
    count(*) filter(where gt.created_at>=now()-interval '24 hours') as trade_count_24h,
    coalesce(sum(gt.price) filter(where gt.created_at>=now()-interval '7 days'),0::numeric) as volume_7d,
    count(*) filter(where gt.created_at>=now()-interval '7 days') as trade_count_7d,
    coalesce(sum(gt.price),0::numeric) as all_time_volume,
    count(*) as total_sales,
    max(gt.price) as high_sale
  from public.gift_trades gt
  join public.gift_assets ga on ga.id=gt.asset_id
  group by ga.base_name
), last_sale as (
  select distinct on (ga.base_name)
    ga.base_name,
    gt.price as last_sale_price
  from public.gift_trades gt
  join public.gift_assets ga on ga.id=gt.asset_id
  order by ga.base_name,gt.created_at desc,gt.id desc
), first_candle as (
  select distinct on (base_name)
    base_name,
    open
  from public.gift_collection_candles
  where bucket_start>=now()-interval '24 hours'
  order by base_name,bucket_start
), last_candle as (
  select distinct on (base_name)
    base_name,
    close
  from public.gift_collection_candles
  where bucket_start>=now()-interval '24 hours'
  order by base_name,bucket_start desc
)
select
  b.base_name,
  b.item_count,
  b.holder_count,
  b.listed_count,
  b.floor_price,
  ls.last_sale_price,
  coalesce(t.volume_24h,0::numeric) as volume_24h,
  case when fc.open is null or fc.open=0 or lc.close is null then 0::numeric else (lc.close/fc.open-1)*100 end as change_24h,
  coalesce(t.trade_count_24h,0::bigint) as trade_count_24h,
  coalesce(t.volume_7d,0::numeric) as volume_7d,
  coalesce(t.trade_count_7d,0::bigint) as trade_count_7d,
  case when b.item_count=0 then 0::numeric else b.listed_count::numeric/b.item_count::numeric*100 end as listed_pct,
  coalesce(t.all_time_volume,0::numeric) as all_time_volume,
  coalesce(t.total_sales,0::bigint) as total_sales,
  t.high_sale,
  b.external_floor
from collection_base b
left join trade_stats t on t.base_name=b.base_name
left join last_sale ls on ls.base_name=b.base_name
left join first_candle fc on fc.base_name=b.base_name
left join last_candle lc on lc.base_name=b.base_name;

-- Preserve the exact Collection Book payload while removing its per-collection N+1 loop.
create or replace function public.collection_book_snapshot_v064(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then
    raise exception 'Profile not found';
  end if;

  with owned_gifts as materialized (
    select
      lower(trim(ga.base_name)) as collection_key,
      ga.base_name,
      ga.model_name,
      ga.backdrop_name,
      ga.symbol_name,
      ga.model_rarity_per_mille,
      ga.backdrop_rarity_per_mille,
      ga.symbol_rarity_per_mille
    from public.virtual_gifts vg
    join public.gift_assets ga on ga.id=vg.asset_id
    where vg.owner_profile_id=p_profile_id
      and coalesce(ga.is_burned,false)=false
      and nullif(trim(ga.base_name),'') is not null
  ), owned as (
    select
      collection_key,
      min(base_name) as base_name,
      count(*)::integer as owned,
      coalesce(sum(case
        when least(coalesce(model_rarity_per_mille,1000),coalesce(backdrop_rarity_per_mille,1000),coalesce(symbol_rarity_per_mille,1000))<=10 then 5
        when least(coalesce(model_rarity_per_mille,1000),coalesce(backdrop_rarity_per_mille,1000),coalesce(symbol_rarity_per_mille,1000))<=30 then 3
        when least(coalesce(model_rarity_per_mille,1000),coalesce(backdrop_rarity_per_mille,1000),coalesce(symbol_rarity_per_mille,1000))<=100 then 2
        else 1
      end),0)::integer as rarity_points,
      count(distinct nullif(trim(model_name),''))::integer as models_owned,
      count(distinct nullif(trim(backdrop_name),''))::integer as backdrops_owned,
      count(distinct nullif(trim(symbol_name),''))::integer as symbols_owned
    from owned_gifts
    group by collection_key
  ), catalog as (
    select
      lower(trim(ga.base_name)) as collection_key,
      count(distinct nullif(trim(ga.model_name),''))::integer as models_total,
      count(distinct nullif(trim(ga.backdrop_name),''))::integer as backdrops_total,
      count(distinct nullif(trim(ga.symbol_name),''))::integer as symbols_total
    from public.gift_assets ga
    join owned o on o.collection_key=lower(trim(ga.base_name))
    where coalesce(ga.is_burned,false)=false
    group by lower(trim(ga.base_name))
  ), claims as (
    select
      lower(trim(base_name)) as collection_key,
      coalesce(jsonb_agg(milestone order by milestone),'[]'::jsonb) as claimed
    from public.collection_milestone_claims
    where profile_id=p_profile_id
    group by lower(trim(base_name))
  ), market as materialized (
    select
      lower(trim(base_name)) as collection_key,
      coalesce(holder_count,0)::integer as holders,
      floor_price
    from public.gift_collection_overview
  ), raw_rows as (
    select
      o.*,
      c.models_total,
      c.backdrops_total,
      c.symbols_total,
      coalesce(cl.claimed,'[]'::jsonb) as claimed,
      coalesce(m.holders,0) as holders,
      m.floor_price,
      ((c.models_total>0)::integer+(c.backdrops_total>0)::integer+(c.symbols_total>0)::integer) as dim_count,
      (case when c.models_total>0 then least(1,o.models_owned::numeric/c.models_total) else 0 end)
      +(case when c.backdrops_total>0 then least(1,o.backdrops_owned::numeric/c.backdrops_total) else 0 end)
      +(case when c.symbols_total>0 then least(1,o.symbols_owned::numeric/c.symbols_total) else 0 end) as ratio_sum
    from owned o
    join catalog c using(collection_key)
    left join claims cl using(collection_key)
    left join market m using(collection_key)
  ), rows as (
    select *,
      case when dim_count=0 then 0 else least(100,greatest(0,floor(100*ratio_sum/dim_count)::integer)) end as coverage
    from raw_rows
  ), agg as (
    select
      coalesce(sum(rarity_points),0)::integer as total_points,
      (select count(*)::integer from owned_gifts) as gift_count,
      count(*) filter(where coverage>=100)::integer as completed,
      coalesce(jsonb_agg(jsonb_build_object(
        'baseName',base_name,
        'coverage',coverage,
        'models',jsonb_build_object('owned',models_owned,'total',models_total),
        'backdrops',jsonb_build_object('owned',backdrops_owned,'total',backdrops_total),
        'symbols',jsonb_build_object('owned',symbols_owned,'total',symbols_total),
        'claimedMilestones',claimed,
        'owned',owned,
        'rarityPoints',rarity_points,
        'holders',holders,
        'floorPrice',floor_price
      ) order by base_name),'[]'::jsonb) as collections
    from rows
  ), calc as (
    select *,greatest(1,floor(sqrt(greatest(total_points,0)::numeric/5.0))::integer+1) as level
    from agg
  )
  select jsonb_build_object(
    'level',level,
    'totalPoints',total_points,
    'nextLevel',5*level*level,
    'progress',least(1,greatest(0,(total_points-(5*(level-1)*(level-1)))::numeric/greatest(1,(5*level*level)-(5*(level-1)*(level-1))))),
    'giftCount',gift_count,
    'completed',completed,
    'collections',collections,
    'milestones',jsonb_build_array(25,50,75,100)
  ) into v_result
  from calc;

  return coalesce(v_result,jsonb_build_object(
    'level',1,'totalPoints',0,'nextLevel',5,'progress',0,
    'giftCount',0,'completed',0,'collections','[]'::jsonb,
    'milestones',jsonb_build_array(25,50,75,100)
  ));
end;
$$;
