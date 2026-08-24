-- MemeX Market v0.65.7
-- Preserve the universal filtered implementation, but route the common unfiltered
-- seeded-random feed through the smaller specialized RPC.

create or replace function public.gift_market_filtered_page_complex_v0657(
  p_seed text default 'mxm',
  p_offset integer default 0,
  p_limit integer default 24,
  p_collection text default null,
  p_model text default null,
  p_backdrop text default null,
  p_symbol text default null,
  p_price_band text default 'all',
  p_view text default 'all',
  p_sort text default 'random'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      greatest(0,least(coalesce(p_offset,0),100000)) as page_offset,
      greatest(1,least(coalesce(p_limit,24),72)) as page_limit,
      hashtextextended(coalesce(nullif(trim(p_seed),''),'mxm'),200) as start_key,
      nullif(trim(p_collection),'') as collection_filter,
      nullif(trim(p_model),'') as model_filter,
      nullif(trim(p_backdrop),'') as backdrop_filter,
      nullif(trim(p_symbol),'') as symbol_filter,
      case when p_price_band in ('all','under50','50to250','250to1000','over1000') then p_price_band else 'all' end as price_band,
      case when p_view in ('all','deals','rare','new','offers') then p_view else 'all' end as market_view,
      case when p_sort in ('random','price','newest','number','rarity','offers') then p_sort else 'random' end as market_sort
  ), filtered as materialized (
    select g.*,vg.market_shuffle_key,p.start_key,p.market_sort,
      count(*) over()::integer as total_count
    from public.gift_market_overview g
    join public.virtual_gifts vg on vg.id=g.virtual_gift_id
    join public.profiles owner_profile on owner_profile.id=g.owner_profile_id
    cross join params p
    cross join public.gift_market_liquidity_policy policy
    where policy.singleton=true
      and g.status='listed'
      and g.is_burned=false
      and g.telegram_name is not null
      and (g.listing_expires_at is null or g.listing_expires_at>now())
      and (policy.mode<>'player_only' or coalesce(owner_profile.is_system,false)=false)
      and (p.collection_filter is null or g.base_name=p.collection_filter)
      and (p.model_filter is null or g.model_name=p.model_filter)
      and (p.backdrop_filter is null or g.backdrop_name=p.backdrop_filter)
      and (p.symbol_filter is null or g.symbol_name=p.symbol_filter)
      and (
        p.price_band='all'
        or (p.price_band='under50' and g.listing_price<50)
        or (p.price_band='50to250' and g.listing_price>=50 and g.listing_price<=250)
        or (p.price_band='250to1000' and g.listing_price>=250 and g.listing_price<=1000)
        or (p.price_band='over1000' and g.listing_price>1000)
      )
      and (
        p.market_view='all'
        or (p.market_view='deals' and g.listing_price is not null and g.estimated_value>0 and g.listing_price<=g.estimated_value*0.78)
        or (p.market_view='rare' and least(g.model_rarity_per_mille,g.backdrop_rarity_per_mille,g.symbol_rarity_per_mille)<=30)
        or (p.market_view='new' and g.created_at>=now()-interval '48 hours')
        or (p.market_view='offers' and g.offer_count>0)
      )
  ), ranked as (
    select f.*,
      row_number() over(order by
        case when f.market_sort='price' then f.listing_price end asc nulls last,
        case when f.market_sort='newest' then f.created_at end desc nulls last,
        case when f.market_sort='number' then f.gift_number end asc nulls last,
        case when f.market_sort='rarity' then coalesce(f.model_rarity_per_mille,1000)+coalesce(f.backdrop_rarity_per_mille,1000)+coalesce(f.symbol_rarity_per_mille,1000) end asc nulls last,
        case when f.market_sort='offers' then f.offer_count end desc nulls last,
        case when f.market_sort='random' and f.market_shuffle_key>=f.start_key then 0
             when f.market_sort='random' then 1 else 0 end,
        case when f.market_sort='random' then f.market_shuffle_key end,
        f.virtual_gift_id
      )::integer as page_ordinal
    from filtered f
  ), page as (
    select r.* from ranked r cross join params p
    where r.page_ordinal>p.page_offset
      and r.page_ordinal<=p.page_offset+p.page_limit
  ), totals as (
    select coalesce(max(total_count),0)::integer as total_count from filtered
  )
  select jsonb_build_object(
    'gifts',coalesce((
      select jsonb_agg(
        to_jsonb(pg)-'market_shuffle_key'-'start_key'-'market_sort'-'total_count'-'page_ordinal'
        order by pg.page_ordinal
      ) from page pg
    ),'[]'::jsonb),
    'totalGifts',t.total_count,
    'nextOffset',case
      when p.page_offset+(select count(*) from page)<t.total_count
      then p.page_offset+(select count(*) from page)
      else null
    end
  )
  from params p cross join totals t;
$$;

revoke execute on function public.gift_market_filtered_page_complex_v0657(text,integer,integer,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.gift_market_filtered_page_complex_v0657(text,integer,integer,text,text,text,text,text,text,text) to service_role;

create or replace function public.gift_market_filtered_page_v200(
  p_seed text default 'mxm',
  p_offset integer default 0,
  p_limit integer default 24,
  p_collection text default null,
  p_model text default null,
  p_backdrop text default null,
  p_symbol text default null,
  p_price_band text default 'all',
  p_view text default 'all',
  p_sort text default 'random'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_collection),'') is null
    and nullif(trim(p_model),'') is null
    and nullif(trim(p_backdrop),'') is null
    and nullif(trim(p_symbol),'') is null
    and coalesce(p_price_band,'all')='all'
    and coalesce(p_view,'all')='all'
    and coalesce(p_sort,'random')='random'
  then
    return public.gift_market_default_page_v0657(p_seed,p_offset,p_limit);
  end if;

  return public.gift_market_filtered_page_complex_v0657(
    p_seed,p_offset,p_limit,p_collection,p_model,p_backdrop,p_symbol,p_price_band,p_view,p_sort
  );
end;
$$;

revoke execute on function public.gift_market_filtered_page_v200(text,integer,integer,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.gift_market_filtered_page_v200(text,integer,integer,text,text,text,text,text,text,text) to service_role;
