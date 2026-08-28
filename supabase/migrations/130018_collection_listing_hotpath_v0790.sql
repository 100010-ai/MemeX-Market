-- MemeX Market collection listings hot path.
-- The generic filtered market function expands gift_market_overview, whose floor
-- CTEs aggregate every listed gift in the market. Collection pages already know
-- the collection and always sort by price, so compute only that collection.

create or replace function public.gift_collection_listing_page_v0790(
  p_base_name text,
  p_offset integer default 0,
  p_limit integer default 36
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
with params as (
  select
    nullif(btrim(p_base_name), '') as base_name,
    greatest(0, least(coalesce(p_offset, 0), 100000)) as page_offset,
    greatest(1, least(coalesce(p_limit, 36), 72)) as page_limit
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
listed_rows as materialized (
  select
    ga.model_name,
    ga.backdrop_name,
    ga.symbol_name,
    vg.listing_price
  from params p
  join public.gift_assets ga
    on ga.base_name = p.base_name
   and ga.is_burned = false
  join public.virtual_gifts vg on vg.asset_id = ga.id
  where vg.status = 'listed'
    and (vg.listing_expires_at is null or vg.listing_expires_at > now())
),
collection_floor as (
  select min(listing_price) as v from listed_rows
),
model_floor as (
  select model_name, min(listing_price) as v
  from listed_rows
  group by model_name
),
backdrop_floor as (
  select backdrop_name, min(listing_price) as v
  from listed_rows
  group by backdrop_name
),
symbol_floor as (
  select symbol_name, min(listing_price) as v
  from listed_rows
  group by symbol_name
),
last_sale as (
  select gt.price as v
  from params p
  join public.gift_assets ga on ga.base_name = p.base_name
  join public.gift_trades gt on gt.asset_id = ga.id
  order by gt.created_at desc, gt.id desc
  limit 1
),
offer_stats as (
  select o.virtual_gift_id, max(o.amount) as best_offer, count(*)::bigint as offer_count
  from params p
  join public.gift_assets ga on ga.base_name = p.base_name
  join public.virtual_gifts vg on vg.asset_id = ga.id
  join public.gift_offers o on o.virtual_gift_id = vg.id
  where o.status = 'pending'
    and (o.expires_at is null or o.expires_at > now())
  group by o.virtual_gift_id
),
filtered as materialized (
  select
    ga.id as asset_id,
    vg.id as virtual_gift_id,
    ga.telegram_name,
    ga.gift_id,
    ga.base_name,
    ga.gift_number,
    ga.model_name,
    ga.model_rarity_per_mille,
    ga.model_rarity,
    ga.model_file_id,
    ga.model_thumb_file_id,
    ga.model_is_animated,
    ga.model_is_video,
    ga.symbol_name,
    ga.symbol_rarity_per_mille,
    ga.symbol_file_id,
    ga.symbol_thumb_file_id,
    ga.symbol_is_animated,
    ga.symbol_is_video,
    ga.backdrop_name,
    ga.backdrop_rarity_per_mille,
    ga.backdrop_center_color,
    ga.backdrop_edge_color,
    ga.backdrop_symbol_color,
    ga.backdrop_text_color,
    ga.is_premium,
    ga.is_from_blockchain,
    ga.is_burned,
    ga.telegram_payload,
    ga.last_seen_at,
    vg.owner_profile_id,
    coalesce(nullif(owner_profile.username, ''), owner_profile.first_name) as owner_name,
    vg.acquired_price,
    vg.listing_price,
    vg.last_sale_price,
    vg.status,
    vg.created_at,
    coalesce(
      case
        when ga.telegram_resale_price_ton is not null
         and ga.resale_seen_at >= now() - make_interval(hours => ms.external_quote_hours)
        then ga.telegram_resale_price_ton
      end,
      vg.last_sale_price,
      ls.v
    ) as estimated_value,
    os.best_offer,
    coalesce(os.offer_count, 0::bigint) as offer_count,
    ga.catalog_source,
    ga.source_reference,
    ga.telegram_resale_price_ton,
    ga.resale_seen_at,
    ga.model_media_url,
    ga.symbol_media_url,
    ga.model_preview_url,
    ga.chain_nft_address,
    ga.chain_collection_address,
    ga.chain_verified,
    vg.listed_at,
    vg.listing_updated_at,
    vg.listing_expires_at,
    case
      when ga.telegram_resale_price_ton is not null
       and ga.resale_seen_at >= now() - make_interval(hours => ms.external_quote_hours)
      then ga.telegram_resale_price_ton
    end as external_listing_price_ton,
    case
      when ga.telegram_resale_price_ton is not null
       and ga.resale_seen_at >= now() - make_interval(hours => ms.external_quote_hours)
      then 'tonapi'::text
    end as external_price_source,
    case
      when ga.telegram_resale_price_ton is not null
       and ga.resale_seen_at >= now() - make_interval(hours => ms.external_quote_hours)
      then ga.resale_seen_at
    end as external_price_seen_at,
    coalesce(
      vg.listing_price,
      case
        when ga.telegram_resale_price_ton is not null
         and ga.resale_seen_at >= now() - make_interval(hours => ms.external_quote_hours)
        then ga.telegram_resale_price_ton
      end,
      vg.last_sale_price,
      ls.v
    ) as reference_price_ton,
    case
      when vg.listing_price is not null then 'mxm_listing'::text
      when ga.telegram_resale_price_ton is not null
       and ga.resale_seen_at >= now() - make_interval(hours => ms.external_quote_hours)
      then 'tonapi_listing'::text
      when vg.last_sale_price is not null then 'item_last_sale'::text
      when ls.v is not null then 'collection_last_sale'::text
    end as price_basis,
    cf.v as collection_floor,
    mf.v as model_floor,
    bf.v as backdrop_floor,
    sf.v as symbol_floor
  from params p
  join public.gift_assets ga
    on ga.base_name = p.base_name
   and ga.is_burned = false
  join public.virtual_gifts vg on vg.asset_id = ga.id
  join public.profiles owner_profile on owner_profile.id = vg.owner_profile_id
  cross join settings ms
  cross join policy pol
  cross join collection_floor cf
  left join model_floor mf on mf.model_name = ga.model_name
  left join backdrop_floor bf on bf.backdrop_name = ga.backdrop_name
  left join symbol_floor sf on sf.symbol_name = ga.symbol_name
  left join last_sale ls on true
  left join offer_stats os on os.virtual_gift_id = vg.id
  where vg.status = 'listed'
    and ga.telegram_name is not null
    and (vg.listing_expires_at is null or vg.listing_expires_at > now())
    and (pol.mode <> 'player_only' or coalesce(owner_profile.is_system, false) = false)
),
page as (
  select f.*
  from filtered f
  cross join params p
  order by f.listing_price asc nulls last, f.virtual_gift_id
  offset (select page_offset from params)
  limit (select page_limit from params)
),
totals as (
  select count(*)::integer as total_count from filtered
),
page_count as (
  select count(*)::integer as n from page
)
select jsonb_build_object(
  'gifts', coalesce((select jsonb_agg(to_jsonb(pg) order by pg.listing_price asc nulls last, pg.virtual_gift_id) from page pg), '[]'::jsonb),
  'totalGifts', t.total_count,
  'nextOffset', case
    when p.page_offset + pc.n < t.total_count then p.page_offset + pc.n
    else null
  end
)
from params p
cross join totals t
cross join page_count pc;
$function$;

revoke execute on function public.gift_collection_listing_page_v0790(text, integer, integer) from public, anon, authenticated;
grant execute on function public.gift_collection_listing_page_v0790(text, integer, integer) to service_role;
