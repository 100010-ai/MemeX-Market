begin;

-- Keep collection-level market analytics consistent with the player-only handoff.
-- Historical trade metrics remain historical by design, while current inventory,
-- holder counts and listing/floor metrics only include player-owned inventory once
-- the irreversible handoff has completed.
create or replace view public.gift_collection_overview with (security_invoker=true) as
with settings as (
  select external_quote_hours from public.market_settings where singleton=true
), policy as (
  select mode from public.gift_market_liquidity_policy where singleton=true
), collection_base as (
  select
    ga.base_name,
    count(*)::bigint as item_count,
    count(distinct vg.owner_profile_id)::bigint as holder_count,
    count(*) filter(
      where vg.status='listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
    )::bigint as listed_count,
    min(vg.listing_price) filter(
      where vg.status='listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
    ) as floor_price,
    min(ga.telegram_resale_price_ton) filter(
      where ga.telegram_resale_price_ton is not null
        and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
    ) as external_floor
  from public.gift_assets ga
  cross join settings ms
  cross join policy pol
  join public.virtual_gifts vg on vg.asset_id=ga.id
  join public.profiles owner_profile on owner_profile.id=vg.owner_profile_id
  where ga.is_burned=false
    and (pol.mode<>'player_only' or coalesce(owner_profile.is_system,false)=false)
  group by ga.base_name,ms.external_quote_hours
), trade_stats as (
  select ga.base_name,
    coalesce(sum(gt.price) filter(where gt.created_at>=now()-interval '24 hours'),0) as volume_24h,
    count(*) filter(where gt.created_at>=now()-interval '24 hours')::bigint as trade_count_24h,
    coalesce(sum(gt.price) filter(where gt.created_at>=now()-interval '7 days'),0) as volume_7d,
    count(*) filter(where gt.created_at>=now()-interval '7 days')::bigint as trade_count_7d,
    coalesce(sum(gt.price),0) as all_time_volume,
    count(*)::bigint as total_sales,
    max(gt.price) as high_sale
  from public.gift_trades gt
  join public.gift_assets ga on ga.id=gt.asset_id
  group by ga.base_name
), last_sale as (
  select distinct on (ga.base_name) ga.base_name,gt.price as last_sale_price
  from public.gift_trades gt
  join public.gift_assets ga on ga.id=gt.asset_id
  order by ga.base_name,gt.created_at desc,gt.id desc
), first_candle as (
  select distinct on (base_name) base_name,open
  from public.gift_collection_candles
  where bucket_start>=now()-interval '24 hours'
  order by base_name,bucket_start asc
), last_candle as (
  select distinct on (base_name) base_name,close
  from public.gift_collection_candles
  where bucket_start>=now()-interval '24 hours'
  order by base_name,bucket_start desc
)
select
  b.base_name,b.item_count,b.holder_count,b.listed_count,b.floor_price,ls.last_sale_price,
  coalesce(t.volume_24h,0) as volume_24h,
  coalesce(t.trade_count_24h,0) as trade_count_24h,
  case when fc.open is null or fc.open=0 or lc.close is null then 0 else ((lc.close/fc.open)-1)*100 end as change_24h,
  coalesce(t.volume_7d,0) as volume_7d,
  coalesce(t.trade_count_7d,0) as trade_count_7d,
  case when b.item_count=0 then 0 else (b.listed_count::numeric/b.item_count::numeric)*100 end as listed_pct,
  coalesce(t.all_time_volume,0) as all_time_volume,
  coalesce(t.total_sales,0) as total_sales,
  t.high_sale,
  b.external_floor
from collection_base b
left join trade_stats t on t.base_name=b.base_name
left join last_sale ls on ls.base_name=b.base_name
left join first_candle fc on fc.base_name=b.base_name
left join last_candle lc on lc.base_name=b.base_name;

grant select on public.gift_collection_overview to service_role;

-- After the handoff, public genesis diagnostics must not imply that NPC supply
-- can return. The historical pool remains queryable internally, but npcAvailable
-- is always zero in player-only mode.
create or replace function public.gift_genesis_public_state()
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  select jsonb_build_object(
    'total',s.snapshot_count,
    'released',s.released_count,
    'remainingToRelease',case when policy.mode='player_only' then 0 else greatest(0,s.snapshot_count-s.released_count) end,
    'completed',case when policy.mode='player_only' then true else s.completed_at is not null end,
    'startedAt',s.started_at,
    'completedAt',coalesce(s.completed_at,policy.transitioned_at),
    'soldToPlayers',(
      select count(*)::integer
      from public.gift_genesis_pool gp
      join public.virtual_gifts vg on vg.id=gp.virtual_gift_id
      join public.profiles p on p.id=vg.owner_profile_id
      where p.is_system=false
    ),
    'npcAvailable',case when policy.mode='player_only' then 0 else (
      select count(*)::integer
      from public.gift_genesis_pool gp
      join public.virtual_gifts vg on vg.id=gp.virtual_gift_id
      join public.profiles p on p.id=vg.owner_profile_id
      where p.is_system=true
        and vg.status='listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
    ) end
  )
  from public.gift_genesis_state s
  cross join public.gift_market_liquidity_policy policy
  where s.singleton=true and policy.singleton=true;
$$;

revoke execute on function public.gift_genesis_public_state() from public,anon,authenticated;
grant execute on function public.gift_genesis_public_state() to service_role;

commit;
