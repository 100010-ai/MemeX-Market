begin;

-- Production repair: restore market objects missing from remote Supabase.

create table if not exists public.market_events (
 id uuid primary key default gen_random_uuid(),
 actor_profile_id uuid references public.profiles(id) on delete set null,
 kind text not null,
 virtual_gift_id uuid,
 coin_id uuid,
 amount numeric default 0,
 created_at timestamptz not null default now()
);

create index if not exists market_events_created_idx on public.market_events(created_at desc);

begin;

-- Stable, indexed shuffle order. A session seed chooses a rotation point in
-- this order, avoiding ORDER BY md5(...) + OFFSET over the full market view.
alter table public.virtual_gifts add column if not exists market_shuffle_key bigint;
update public.virtual_gifts
set market_shuffle_key=hashtextextended(id::text,200)
where market_shuffle_key is null;

create or replace function public.set_virtual_gift_shuffle_key_v200()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.market_shuffle_key is null then
    new.market_shuffle_key:=hashtextextended(new.id::text,200);
  end if;
  return new;
end;
$$;

drop trigger if exists virtual_gift_shuffle_key_v200 on public.virtual_gifts;
create trigger virtual_gift_shuffle_key_v200
before insert on public.virtual_gifts
for each row execute function public.set_virtual_gift_shuffle_key_v200();

alter table public.virtual_gifts alter column market_shuffle_key set not null;
create index if not exists virtual_gifts_listed_shuffle_v200_idx
  on public.virtual_gifts(market_shuffle_key,id) where status='listed';
create index if not exists virtual_gifts_listed_expiry_v200_idx
  on public.virtual_gifts(listing_expires_at,id) where status='listed';

create or replace function public.gift_market_random_page(
  p_seed text,p_offset integer default 0,p_limit integer default 72
) returns setof public.gift_market_overview
language sql security definer set search_path=public stable as $$
  with params as (
    select greatest(0,coalesce(p_offset,0)) as page_offset,
      greatest(1,least(coalesce(p_limit,72),120)) as page_limit,
      hashtextextended(coalesce(nullif(p_seed,''),'mxm'),200) as start_key
  ), candidate_pool as materialized (
    (select vg.id,0 as section,vg.market_shuffle_key
      from public.virtual_gifts vg
      join public.gift_assets ga on ga.id=vg.asset_id
      cross join params p
      where vg.status='listed'
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
        and ga.is_burned=false and ga.telegram_name is not null
        and vg.market_shuffle_key>=p.start_key
      order by vg.market_shuffle_key,vg.id
      limit (select page_offset+page_limit from params))
    union all
    (select vg.id,1 as section,vg.market_shuffle_key
      from public.virtual_gifts vg
      join public.gift_assets ga on ga.id=vg.asset_id
      cross join params p
      where vg.status='listed'
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
        and ga.is_burned=false and ga.telegram_name is not null
        and vg.market_shuffle_key<p.start_key
      order by vg.market_shuffle_key,vg.id
      limit (select page_offset+page_limit from params))
  ), ranked as (
    select id,row_number() over(order by section,market_shuffle_key,id)-1 as ordinal
    from candidate_pool
  ), page_ids as (
    select r.id,r.ordinal from ranked r cross join params p
    where r.ordinal>=p.page_offset and r.ordinal<p.page_offset+p.page_limit
  )
  select g.*
  from page_ids p
  join public.gift_market_overview g on g.virtual_gift_id=p.id
  order by p.ordinal;
$$;

revoke execute on function public.gift_market_random_page(text,integer,integer) from public,anon,authenticated;
grant execute on function public.gift_market_random_page(text,integer,integer) to service_role;

-- Catalogue-wide filtering and sorting. The previous client filtered only the
-- random pages that happened to be loaded, so a valid rare/new/trait match
-- could be invisible. This function applies the same predicates before
-- pagination and returns an authoritative total in a single snapshot.
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
) returns jsonb
language sql security definer set search_path=public stable as $$
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
    cross join params p
    where g.status='listed'
      and g.is_burned=false
      and g.telegram_name is not null
      and (g.listing_expires_at is null or g.listing_expires_at>now())
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
        or (p.market_view='deals' and g.listing_price is not null)
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

revoke execute on function public.gift_market_filtered_page_v200(text,integer,integer,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.gift_market_filtered_page_v200(text,integer,integer,text,text,text,text,text,text,text) to service_role;

-- Paid creator boosts are a real discovery placement, not a detached receipt.
-- The endpoint merges active boosts ahead of organically-new coins while HOT
-- remains an activity-only score.
create or replace view public.active_coin_boosts_v200 with (security_invoker=true) as
select coin_id,max(ends_at) as boosted_until
from public.coin_boosts
where ends_at>now()
group by coin_id;

revoke all on public.active_coin_boosts_v200 from public,anon,authenticated;
grant select on public.active_coin_boosts_v200 to service_role;

commit;

commit;
