-- MemeX Market collection detail hot path.
-- The old gift_collection_overview view aggregates the whole gift market even
-- when a request needs one collection. Keep the public view for broad reports,
-- but give the server-only collection route a scoped O(collection size) RPC.

create or replace function public.gift_collection_snapshot_v0790(p_base_name text)
returns jsonb
language sql
stable
set search_path = public
as $function$
with input as (
  select nullif(btrim(p_base_name), '') as base_name
),
settings as (
  select external_quote_hours
  from public.market_settings
  where singleton = true
),
policy as (
  select mode
  from public.gift_market_liquidity_policy
  where singleton = true
),
base as (
  select
    count(*)::bigint as item_count,
    count(distinct vg.owner_profile_id)::bigint as holder_count,
    count(*) filter (
      where vg.status = 'listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at > now())
    )::bigint as listed_count,
    min(vg.listing_price) filter (
      where vg.status = 'listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at > now())
    ) as floor_price,
    min(ga.telegram_resale_price_ton) filter (
      where ga.telegram_resale_price_ton is not null
        and ga.resale_seen_at >= now() - make_interval(hours => ms.external_quote_hours)
    ) as external_floor
  from input i
  join public.gift_assets ga
    on ga.base_name = i.base_name
   and ga.is_burned = false
  join public.virtual_gifts vg on vg.asset_id = ga.id
  join public.profiles owner_profile on owner_profile.id = vg.owner_profile_id
  cross join settings ms
  cross join policy pol
  where pol.mode <> 'player_only' or coalesce(owner_profile.is_system, false) = false
),
trades as (
  select
    coalesce(sum(gt.price) filter (where gt.created_at >= now() - interval '24 hours'), 0::numeric) as volume_24h,
    count(*) filter (where gt.created_at >= now() - interval '24 hours')::bigint as trade_count_24h,
    coalesce(sum(gt.price) filter (where gt.created_at >= now() - interval '7 days'), 0::numeric) as volume_7d,
    count(*) filter (where gt.created_at >= now() - interval '7 days')::bigint as trade_count_7d,
    coalesce(sum(gt.price), 0::numeric) as all_time_volume,
    count(*)::bigint as total_sales,
    max(gt.price) as high_sale
  from input i
  join public.gift_assets ga on ga.base_name = i.base_name
  join public.gift_trades gt on gt.asset_id = ga.id
),
last_sale as (
  select gt.price
  from input i
  join public.gift_assets ga on ga.base_name = i.base_name
  join public.gift_trades gt on gt.asset_id = ga.id
  order by gt.created_at desc, gt.id desc
  limit 1
),
first_candle as (
  select gcc.open
  from input i
  join public.gift_collection_candles gcc on gcc.base_name = i.base_name
  where gcc.bucket_start >= now() - interval '24 hours'
  order by gcc.bucket_start asc
  limit 1
),
last_candle as (
  select gcc.close
  from input i
  join public.gift_collection_candles gcc on gcc.base_name = i.base_name
  where gcc.bucket_start >= now() - interval '24 hours'
  order by gcc.bucket_start desc
  limit 1
)
select case
  when i.base_name is null or b.item_count = 0 then null
  else jsonb_build_object(
    'base_name', i.base_name,
    'item_count', b.item_count,
    'holder_count', b.holder_count,
    'listed_count', b.listed_count,
    'floor_price', b.floor_price,
    'last_sale_price', ls.price,
    'volume_24h', t.volume_24h,
    'change_24h', case
      when fc.open is null or fc.open = 0::numeric or lc.close is null then 0::numeric
      else (lc.close / fc.open - 1::numeric) * 100::numeric
    end,
    'trade_count_24h', t.trade_count_24h,
    'volume_7d', t.volume_7d,
    'trade_count_7d', t.trade_count_7d,
    'listed_pct', case
      when b.item_count = 0 then 0::numeric
      else b.listed_count::numeric / b.item_count::numeric * 100::numeric
    end,
    'all_time_volume', t.all_time_volume,
    'total_sales', t.total_sales,
    'high_sale', t.high_sale,
    'external_floor', b.external_floor
  )
end
from input i
cross join base b
cross join trades t
left join last_sale ls on true
left join first_candle fc on true
left join last_candle lc on true;
$function$;

revoke execute on function public.gift_collection_snapshot_v0790(text) from public, anon, authenticated;
grant execute on function public.gift_collection_snapshot_v0790(text) to service_role;
