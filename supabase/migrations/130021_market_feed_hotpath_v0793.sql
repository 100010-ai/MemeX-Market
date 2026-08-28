-- Keep public market pagination narrow until the final page is known. Heavy
-- floor / last-sale / offer aggregation is scoped to the page that is actually
-- returned instead of materializing gift_market_overview for the entire market.

create or replace function public.gift_market_rows_v0793(p_ids uuid[])
returns setof public.gift_market_overview
language sql
stable
security definer
set search_path=public
as $function$
  with page_ids as materialized (
    select unnest(coalesce(p_ids,array[]::uuid[])) as id
  ),
  settings as (
    select external_quote_hours from public.market_settings where singleton=true
  ),
  page_traits as materialized (
    select ga.base_name,ga.model_name,ga.backdrop_name,ga.symbol_name
    from page_ids pi
    join public.virtual_gifts vg on vg.id=pi.id
    join public.gift_assets ga on ga.id=vg.asset_id
  ),
  page_collections as (
    select distinct base_name from page_traits
  ),
  listed_rows as materialized (
    select ga.base_name,ga.model_name,ga.backdrop_name,ga.symbol_name,vg.listing_price
    from page_collections pc
    join public.gift_assets ga on ga.base_name=pc.base_name
    join public.virtual_gifts vg on vg.asset_id=ga.id
    where ga.is_burned=false
      and vg.status='listed'
      and (vg.listing_expires_at is null or vg.listing_expires_at>now())
  ),
  collection_floor as (
    select base_name,min(listing_price) as v from listed_rows group by base_name
  ),
  model_floor as (
    select lr.base_name,lr.model_name,min(lr.listing_price) as v
    from listed_rows lr
    join (select distinct base_name,model_name from page_traits) pt
      on pt.base_name=lr.base_name and pt.model_name=lr.model_name
    group by lr.base_name,lr.model_name
  ),
  backdrop_floor as (
    select lr.base_name,lr.backdrop_name,min(lr.listing_price) as v
    from listed_rows lr
    join (select distinct base_name,backdrop_name from page_traits) pt
      on pt.base_name=lr.base_name and pt.backdrop_name=lr.backdrop_name
    group by lr.base_name,lr.backdrop_name
  ),
  symbol_floor as (
    select lr.base_name,lr.symbol_name,min(lr.listing_price) as v
    from listed_rows lr
    join (select distinct base_name,symbol_name from page_traits) pt
      on pt.base_name=lr.base_name and pt.symbol_name=lr.symbol_name
    group by lr.base_name,lr.symbol_name
  ),
  last_sale as (
    select distinct on (ga.base_name) ga.base_name,gt.price as v,gt.created_at
    from public.gift_trades gt
    join public.gift_assets ga on ga.id=gt.asset_id
    join page_collections pc on pc.base_name=ga.base_name
    order by ga.base_name,gt.created_at desc,gt.id desc
  ),
  offer_stats as (
    select go.virtual_gift_id,max(go.amount) as best_offer,count(*) as offer_count
    from public.gift_offers go
    join page_ids pi on pi.id=go.virtual_gift_id
    where go.status='pending' and (go.expires_at is null or go.expires_at>now())
    group by go.virtual_gift_id
  )
  select
    ga.id as asset_id,vg.id as virtual_gift_id,ga.telegram_name,ga.gift_id,ga.base_name,ga.gift_number,
    ga.model_name,ga.model_rarity_per_mille,ga.model_rarity,ga.model_file_id,ga.model_thumb_file_id,ga.model_is_animated,ga.model_is_video,
    ga.symbol_name,ga.symbol_rarity_per_mille,ga.symbol_file_id,ga.symbol_thumb_file_id,ga.symbol_is_animated,ga.symbol_is_video,
    ga.backdrop_name,ga.backdrop_rarity_per_mille,ga.backdrop_center_color,ga.backdrop_edge_color,ga.backdrop_symbol_color,ga.backdrop_text_color,
    ga.is_premium,ga.is_from_blockchain,ga.is_burned,ga.telegram_payload,ga.last_seen_at,vg.owner_profile_id,
    coalesce(nullif(op.username,''),op.first_name) as owner_name,vg.acquired_price,vg.listing_price,vg.last_sale_price,vg.status,vg.created_at,
    coalesce(case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then ga.telegram_resale_price_ton end,vg.last_sale_price,ls.v) as estimated_value,
    os.best_offer,coalesce(os.offer_count,0::bigint) as offer_count,ga.catalog_source,ga.source_reference,ga.telegram_resale_price_ton,ga.resale_seen_at,
    ga.model_media_url,ga.symbol_media_url,ga.model_preview_url,ga.chain_nft_address,ga.chain_collection_address,ga.chain_verified,
    vg.listed_at,vg.listing_updated_at,vg.listing_expires_at,
    case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then ga.telegram_resale_price_ton end as external_listing_price_ton,
    case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then 'tonapi'::text end as external_price_source,
    case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then ga.resale_seen_at end as external_price_seen_at,
    coalesce(vg.listing_price,case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then ga.telegram_resale_price_ton end,vg.last_sale_price,ls.v) as reference_price_ton,
    case when vg.listing_price is not null then 'mxm_listing'::text when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then 'tonapi_listing'::text when vg.last_sale_price is not null then 'item_last_sale'::text when ls.v is not null then 'collection_last_sale'::text else null::text end as price_basis,
    cf.v as collection_floor,mf.v as model_floor,bf.v as backdrop_floor,sf.v as symbol_floor
  from page_ids pi
  join public.virtual_gifts vg on vg.id=pi.id
  join public.gift_assets ga on ga.id=vg.asset_id
  join public.profiles op on op.id=vg.owner_profile_id
  cross join settings ms
  left join collection_floor cf on cf.base_name=ga.base_name
  left join model_floor mf on mf.base_name=ga.base_name and mf.model_name=ga.model_name
  left join backdrop_floor bf on bf.base_name=ga.base_name and bf.backdrop_name=ga.backdrop_name
  left join symbol_floor sf on sf.base_name=ga.base_name and sf.symbol_name=ga.symbol_name
  left join last_sale ls on ls.base_name=ga.base_name
  left join offer_stats os on os.virtual_gift_id=vg.id;
$function$;

revoke all on function public.gift_market_rows_v0793(uuid[]) from public,anon,authenticated;
grant execute on function public.gift_market_rows_v0793(uuid[]) to service_role;

create or replace function public.gift_market_fast_page_v0792(
  p_seed text default 'mxm',p_offset integer default 0,p_limit integer default 24,
  p_collection text default null,p_model text default null,p_backdrop text default null,p_symbol text default null,
  p_price_band text default 'all',p_view text default 'all',p_sort text default 'random'
)
returns jsonb
language sql
stable
security definer
set search_path=public
as $function$
  with params as (
    select greatest(0,least(coalesce(p_offset,0),100000)) as page_offset,
      greatest(1,least(coalesce(p_limit,24),72)) as page_limit,
      hashtextextended(coalesce(nullif(trim(p_seed),''),'mxm'),200) as start_key,
      nullif(trim(p_collection),'') as collection_filter,nullif(trim(p_model),'') as model_filter,
      nullif(trim(p_backdrop),'') as backdrop_filter,nullif(trim(p_symbol),'') as symbol_filter,
      case when p_price_band in ('all','under50','50to250','250to1000','over1000') then p_price_band else 'all' end as price_band,
      case when p_view in ('all','rare','new') then p_view else 'all' end as market_view,
      case when p_sort in ('random','price','newest','number','rarity') then p_sort else 'random' end as market_sort
  ),
  filtered as materialized (
    select vg.id,vg.market_shuffle_key,vg.listing_price,vg.created_at,ga.gift_number,
      ga.model_rarity_per_mille,ga.backdrop_rarity_per_mille,ga.symbol_rarity_per_mille,p.start_key,p.market_sort
    from public.virtual_gifts vg
    join public.gift_assets ga on ga.id=vg.asset_id
    join public.profiles owner_profile on owner_profile.id=vg.owner_profile_id
    cross join params p cross join public.gift_market_liquidity_policy policy
    where policy.singleton=true and vg.status='listed' and vg.listing_price is not null
      and (vg.listing_expires_at is null or vg.listing_expires_at>now())
      and ga.is_burned=false and ga.telegram_name is not null
      and (policy.mode<>'player_only' or coalesce(owner_profile.is_system,false)=false)
      and (p.collection_filter is null or ga.base_name=p.collection_filter)
      and (p.model_filter is null or ga.model_name=p.model_filter)
      and (p.backdrop_filter is null or ga.backdrop_name=p.backdrop_filter)
      and (p.symbol_filter is null or ga.symbol_name=p.symbol_filter)
      and (p.price_band='all' or (p.price_band='under50' and vg.listing_price<50)
        or (p.price_band='50to250' and vg.listing_price>=50 and vg.listing_price<=250)
        or (p.price_band='250to1000' and vg.listing_price>=250 and vg.listing_price<=1000)
        or (p.price_band='over1000' and vg.listing_price>1000))
      and (p.market_view='all'
        or (p.market_view='rare' and least(ga.model_rarity_per_mille,ga.backdrop_rarity_per_mille,ga.symbol_rarity_per_mille)<=30)
        or (p.market_view='new' and vg.created_at>=now()-interval '48 hours'))
  ),
  ranked as (
    select f.id,row_number() over(order by
      case when f.market_sort='price' then f.listing_price end asc nulls last,
      case when f.market_sort='newest' then f.created_at end desc nulls last,
      case when f.market_sort='number' then f.gift_number end asc nulls last,
      case when f.market_sort='rarity' then coalesce(f.model_rarity_per_mille,1000)+coalesce(f.backdrop_rarity_per_mille,1000)+coalesce(f.symbol_rarity_per_mille,1000) end asc nulls last,
      case when f.market_sort='random' and f.market_shuffle_key>=f.start_key then 0 when f.market_sort='random' then 1 else 0 end,
      case when f.market_sort='random' then f.market_shuffle_key end,f.id)::integer as page_ordinal
    from filtered f
  ),
  page_ids as materialized (
    select r.id,r.page_ordinal from ranked r cross join params p
    where r.page_ordinal>p.page_offset and r.page_ordinal<=p.page_offset+p.page_limit
  ),
  page_array as (select coalesce(array_agg(id),'{}'::uuid[]) as ids from page_ids),
  page_rows as materialized (
    select g.* from page_array pa join lateral public.gift_market_rows_v0793(pa.ids) g on true
  ),
  totals as (select count(*)::integer as total_count from filtered)
  select jsonb_build_object(
    'gifts',coalesce((select jsonb_agg(to_jsonb(g) order by pi.page_ordinal) from page_ids pi join page_rows g on g.virtual_gift_id=pi.id),'[]'::jsonb),
    'totalGifts',t.total_count,
    'nextOffset',case when p.page_offset+(select count(*) from page_ids)<t.total_count then p.page_offset+(select count(*) from page_ids) else null end
  ) from params p cross join totals t;
$function$;

revoke all on function public.gift_market_fast_page_v0792(text,integer,integer,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.gift_market_fast_page_v0792(text,integer,integer,text,text,text,text,text,text,text) to service_role;

create or replace function public.gift_market_filtered_page_v200(
  p_seed text default 'mxm',p_offset integer default 0,p_limit integer default 24,
  p_collection text default null,p_model text default null,p_backdrop text default null,p_symbol text default null,
  p_price_band text default 'all',p_view text default 'all',p_sort text default 'random'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_view text:=case when p_view in ('all','deals','rare','new','offers') then p_view else 'all' end;
  v_sort text:=case when p_sort in ('random','price','newest','number','rarity','offers') then p_sort else 'random' end;
begin
  if v_view not in ('deals','offers') and v_sort<>'offers' then
    return public.gift_market_fast_page_v0792(p_seed,p_offset,p_limit,p_collection,p_model,p_backdrop,p_symbol,p_price_band,v_view,v_sort);
  end if;
  return public.gift_market_filtered_page_complex_v0657(p_seed,p_offset,p_limit,p_collection,p_model,p_backdrop,p_symbol,p_price_band,v_view,v_sort);
end;
$function$;
