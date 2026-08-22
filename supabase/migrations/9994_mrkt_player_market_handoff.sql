begin;

-- NPCs are bootstrap liquidity only. Once the player economy is deep enough,
-- the market permanently hands off to player-owned/player-listed inventory.
create table if not exists public.gift_market_liquidity_policy (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'npc_bootstrap' check (mode in ('npc_bootstrap','player_only')),
  player_owned_threshold integer not null default 500 check (player_owned_threshold >= 1),
  player_listed_threshold integer not null default 120 check (player_listed_threshold >= 1),
  active_sellers_threshold integer not null default 20 check (active_sellers_threshold >= 1),
  transitioned_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.gift_market_liquidity_policy(singleton) values(true) on conflict(singleton) do nothing;
alter table public.gift_market_liquidity_policy add column if not exists transition_player_owned integer;
alter table public.gift_market_liquidity_policy add column if not exists transition_player_listed integer;
alter table public.gift_market_liquidity_policy add column if not exists transition_active_sellers integer;

alter table public.gift_market_liquidity_policy enable row level security;
revoke all on public.gift_market_liquidity_policy from public,anon,authenticated;
grant all on public.gift_market_liquidity_policy to service_role;

create or replace function public.gift_market_liquidity_state()
returns jsonb
language plpgsql
security definer
set search_path=public
stable
as $$
declare
  v_policy public.gift_market_liquidity_policy%rowtype;
  v_player_owned integer:=0;
  v_player_listed integer:=0;
  v_active_sellers integer:=0;
  v_npc_listed integer:=0;
begin
  select * into v_policy from public.gift_market_liquidity_policy where singleton=true;
  if not found then raise exception 'Gift market liquidity policy is missing'; end if;

  -- After handoff we never need to rescan the full player inventory on every
  -- public market request. Keep the transition snapshot for diagnostics and
  -- only report NPC listings as zero: DB enforcement prevents them returning.
  if v_policy.mode='player_only' then
    return jsonb_build_object(
      'mode','player_only',
      'playerOnly',true,
      'playerOwned',coalesce(v_policy.transition_player_owned,v_policy.player_owned_threshold),
      'playerListed',coalesce(v_policy.transition_player_listed,v_policy.player_listed_threshold),
      'activeSellers',coalesce(v_policy.transition_active_sellers,v_policy.active_sellers_threshold),
      'npcListed',0,
      'playerOwnedThreshold',v_policy.player_owned_threshold,
      'playerListedThreshold',v_policy.player_listed_threshold,
      'activeSellersThreshold',v_policy.active_sellers_threshold,
      'ready',true,
      'transitionedAt',v_policy.transitioned_at
    );
  end if;

  select
    count(*) filter(where coalesce(p.is_system,false)=false)::integer,
    count(*) filter(
      where coalesce(p.is_system,false)=false
        and vg.status='listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
    )::integer,
    count(distinct vg.owner_profile_id) filter(
      where coalesce(p.is_system,false)=false
        and vg.status='listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
    )::integer,
    count(*) filter(
      where coalesce(p.is_system,false)=true
        and vg.status='listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
    )::integer
  into v_player_owned,v_player_listed,v_active_sellers,v_npc_listed
  from public.virtual_gifts vg
  join public.profiles p on p.id=vg.owner_profile_id
  join public.gift_assets ga on ga.id=vg.asset_id
  where coalesce(ga.is_burned,false)=false;

  return jsonb_build_object(
    'mode',v_policy.mode,
    'playerOnly',false,
    'playerOwned',v_player_owned,
    'playerListed',v_player_listed,
    'activeSellers',v_active_sellers,
    'npcListed',v_npc_listed,
    'playerOwnedThreshold',v_policy.player_owned_threshold,
    'playerListedThreshold',v_policy.player_listed_threshold,
    'activeSellersThreshold',v_policy.active_sellers_threshold,
    'ready',v_player_owned>=v_policy.player_owned_threshold
      and v_player_listed>=v_policy.player_listed_threshold
      and v_active_sellers>=v_policy.active_sellers_threshold,
    'transitionedAt',v_policy.transitioned_at
  );
end;
$$;

create or replace function public.maybe_handoff_gift_market_to_players(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_policy public.gift_market_liquidity_policy%rowtype;
  v_player_owned integer := 0;
  v_player_listed integer := 0;
  v_active_sellers integer := 0;
  v_npc_removed integer := 0;
  v_should_handoff boolean := false;
begin
  select * into v_policy
  from public.gift_market_liquidity_policy
  where singleton=true
  for update;
  if not found then raise exception 'Gift market liquidity policy is missing'; end if;

  if v_policy.mode='player_only' then
    update public.virtual_gifts vg
    set status='owned',listing_price=null,listed_at=null,listing_updated_at=now(),listing_expires_at=null
    from public.profiles p
    where p.id=vg.owner_profile_id
      and coalesce(p.is_system,false)=true
      and (vg.status='listed' or vg.listing_price is not null);
    get diagnostics v_npc_removed = row_count;
    return public.gift_market_liquidity_state() || jsonb_build_object('npcRemoved',v_npc_removed);
  end if;

  select
    count(*) filter(where coalesce(p.is_system,false)=false)::integer,
    count(*) filter(
      where coalesce(p.is_system,false)=false
        and vg.status='listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
    )::integer,
    count(distinct vg.owner_profile_id) filter(
      where coalesce(p.is_system,false)=false
        and vg.status='listed'
        and vg.listing_price is not null
        and (vg.listing_expires_at is null or vg.listing_expires_at>now())
    )::integer
  into v_player_owned,v_player_listed,v_active_sellers
  from public.virtual_gifts vg
  join public.profiles p on p.id=vg.owner_profile_id
  join public.gift_assets ga on ga.id=vg.asset_id
  where coalesce(ga.is_burned,false)=false;

  v_should_handoff := v_policy.mode='player_only' or coalesce(p_force,false)
    or (
      v_player_owned>=v_policy.player_owned_threshold
      and v_player_listed>=v_policy.player_listed_threshold
      and v_active_sellers>=v_policy.active_sellers_threshold
    );

  if v_should_handoff and v_policy.mode<>'player_only' then
    update public.gift_market_liquidity_policy
    set mode='player_only',
        transitioned_at=coalesce(transitioned_at,now()),
        transition_player_owned=v_player_owned,
        transition_player_listed=v_player_listed,
        transition_active_sellers=v_active_sellers,
        updated_at=now()
    where singleton=true;
  end if;

  if v_should_handoff then
    -- System accounts remain for historical ownership/trade provenance, but
    -- they can no longer supply visible market liquidity after the handoff.
    update public.virtual_gifts vg
    set status='owned',listing_price=null,listed_at=null,listing_updated_at=now(),listing_expires_at=null
    from public.profiles p
    where p.id=vg.owner_profile_id
      and coalesce(p.is_system,false)=true
      and (vg.status='listed' or vg.listing_price is not null);
    get diagnostics v_npc_removed = row_count;
  end if;

  return (select public.gift_market_liquidity_state()) || jsonb_build_object('npcRemoved',v_npc_removed);
end;
$$;

-- Visible listing count must respect player-only mode even if a stale system
-- listing is reintroduced manually.
create or replace function public.gift_market_listed_count()
returns integer
language sql
security definer
set search_path=public
stable
as $$
  select count(*)::integer
  from public.gift_market_overview g
  join public.profiles p on p.id=g.owner_profile_id
  cross join public.gift_market_liquidity_policy policy
  where policy.singleton=true
    and g.status='listed'
    and g.is_burned=false
    and g.telegram_name is not null
    and (g.listing_expires_at is null or g.listing_expires_at>now())
    and (policy.mode<>'player_only' or coalesce(p.is_system,false)=false);
$$;

create or replace function public.gift_market_random_page(p_seed text,p_offset integer default 0,p_limit integer default 72)
returns setof public.gift_market_overview
language sql
security definer
set search_path=public
stable
as $$
  select g.*
  from public.gift_market_overview g
  join public.profiles p on p.id=g.owner_profile_id
  cross join public.gift_market_liquidity_policy policy
  where policy.singleton=true
    and g.status='listed'
    and g.is_burned=false
    and g.telegram_name is not null
    and (g.listing_expires_at is null or g.listing_expires_at>now())
    and (policy.mode<>'player_only' or coalesce(p.is_system,false)=false)
  order by md5(coalesce(p_seed,'mxm')||':'||g.virtual_gift_id::text)
  offset greatest(0,coalesce(p_offset,0))
  limit greatest(1,least(coalesce(p_limit,72),120));
$$;

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

-- Collection cards for the MRKT-style grouped marketplace. Previews always
-- come from currently visible listings and therefore obey player-only mode.
create or replace function public.gift_market_collection_cards_v210(p_limit integer default 30)
returns jsonb
language sql
security definer
set search_path=public
stable
as $$
  with policy as (
    select mode from public.gift_market_liquidity_policy where singleton=true
  ), visible as materialized (
    select g.*
    from public.gift_market_overview g
    join public.profiles p on p.id=g.owner_profile_id
    cross join policy
    where g.status='listed'
      and g.is_burned=false
      and g.listing_price is not null
      and (g.listing_expires_at is null or g.listing_expires_at>now())
      and (policy.mode<>'player_only' or coalesce(p.is_system,false)=false)
  ), ranked as (
    select v.*,
      row_number() over(partition by v.base_name order by v.listing_price asc,v.gift_number asc,v.virtual_gift_id) as rn,
      count(*) over(partition by v.base_name)::integer as listed_count,
      min(v.listing_price) over(partition by v.base_name) as floor_price
    from visible v
  ), collection_names as (
    select base_name,max(listed_count)::integer as listed_count,min(floor_price) as floor_price
    from ranked
    group by base_name
    order by max(listed_count) desc,min(floor_price) asc,base_name
    limit greatest(1,least(coalesce(p_limit,30),80))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'baseName',c.base_name,
    'listedCount',c.listed_count,
    'floorPrice',c.floor_price,
    'previewTotal',coalesce((select sum(r.listing_price) from ranked r where r.base_name=c.base_name and r.rn<=3),0),
    'previews',coalesce((
      select jsonb_agg(jsonb_build_object(
        'virtualGiftId',r.virtual_gift_id,
        'giftNumber',r.gift_number,
        'modelPreviewUrl',r.model_preview_url,
        'modelMediaUrl',r.model_media_url,
        'symbolMediaUrl',r.symbol_media_url,
        'listingPrice',r.listing_price,
        'modelName',r.model_name,
        'backdropName',r.backdrop_name,
        'symbolName',r.symbol_name
      ) order by r.rn)
      from ranked r where r.base_name=c.base_name and r.rn<=3
    ),'[]'::jsonb)
  ) order by c.listed_count desc,c.floor_price asc,c.base_name),'[]'::jsonb)
  from collection_names c;
$$;


-- Defense in depth: once the market is player-only, no old route, admin action,
-- cron, or stale deployment can silently put a system-owned Gift back on sale.
create or replace function public.enforce_player_only_gift_listing()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_mode text;
  v_is_system boolean:=false;
  v_previous_owner_is_system boolean:=false;
begin
  select mode into v_mode
  from public.gift_market_liquidity_policy
  where singleton=true;

  if coalesce(v_mode,'npc_bootstrap')<>'player_only' then
    return new;
  end if;

  -- No system account may create or keep a visible listing after handoff.
  if new.status='listed' and new.listing_price is not null then
    select coalesce(is_system,false) into v_is_system
    from public.profiles
    where id=new.owner_profile_id;

    if coalesce(v_is_system,false) then
      raise exception using
        errcode='P0001',
        message='NPC liquidity is permanently disabled for the player-only Gift market';
    end if;
  end if;

  -- Defense in depth for stale rows: even if an old/system listing somehow
  -- survived the handoff, it cannot be purchased through an older deployment.
  -- Cleanup is still allowed because it keeps the same owner and only unlists.
  if tg_op='UPDATE' then
    if old.status='listed'
       and old.listing_price is not null
       and new.owner_profile_id is distinct from old.owner_profile_id then
      select coalesce(is_system,false) into v_previous_owner_is_system
      from public.profiles
      where id=old.owner_profile_id;

      if coalesce(v_previous_owner_is_system,false) then
        raise exception using
          errcode='P0001',
          message='NPC listing cannot be purchased after player-only market handoff';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_player_only_gift_listing on public.virtual_gifts;
create trigger trg_enforce_player_only_gift_listing
before insert or update of owner_profile_id,status,listing_price on public.virtual_gifts
for each row execute function public.enforce_player_only_gift_listing();

-- Admin-only policy tuning. Thresholds can be adjusted while the bootstrap
-- market is active, but a completed handoff cannot be reversed by this RPC.
create or replace function public.configure_gift_market_liquidity_policy(
  p_player_owned_threshold integer,
  p_player_listed_threshold integer,
  p_active_sellers_threshold integer
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_mode text;
begin
  if p_player_owned_threshold is null or p_player_owned_threshold<1 or p_player_owned_threshold>10000000 then
    raise exception 'Invalid player-owned threshold';
  end if;
  if p_player_listed_threshold is null or p_player_listed_threshold<1 or p_player_listed_threshold>1000000 then
    raise exception 'Invalid player-listed threshold';
  end if;
  if p_active_sellers_threshold is null or p_active_sellers_threshold<1 or p_active_sellers_threshold>100000 then
    raise exception 'Invalid active-sellers threshold';
  end if;

  select mode into v_mode
  from public.gift_market_liquidity_policy
  where singleton=true
  for update;

  if v_mode='player_only' then
    raise exception 'Player-only market handoff is irreversible';
  end if;

  update public.gift_market_liquidity_policy
  set player_owned_threshold=p_player_owned_threshold,
      player_listed_threshold=p_player_listed_threshold,
      active_sellers_threshold=p_active_sellers_threshold,
      updated_at=now()
  where singleton=true;

  return public.gift_market_liquidity_state();
end;
$$;

-- The handoff state is recalculated often, so keep the metric scan bounded to
-- the columns used by the policy and visible-market filters.
create index if not exists virtual_gifts_owner_status_listing_handoff_v210_idx
  on public.virtual_gifts(owner_profile_id,status,listing_expires_at)
  where listing_price is not null;
create index if not exists profiles_system_handoff_v210_idx
  on public.profiles(is_system,id);

revoke execute on function public.gift_market_liquidity_state() from public,anon,authenticated;
revoke execute on function public.maybe_handoff_gift_market_to_players(boolean) from public,anon,authenticated;
revoke execute on function public.configure_gift_market_liquidity_policy(integer,integer,integer) from public,anon,authenticated;
revoke execute on function public.gift_market_collection_cards_v210(integer) from public,anon,authenticated;
revoke execute on function public.gift_market_listed_count() from public,anon,authenticated;
revoke execute on function public.gift_market_random_page(text,integer,integer) from public,anon,authenticated;
revoke execute on function public.gift_market_filtered_page_v200(text,integer,integer,text,text,text,text,text,text,text) from public,anon,authenticated;

grant execute on function public.gift_market_liquidity_state() to service_role;
grant execute on function public.maybe_handoff_gift_market_to_players(boolean) to service_role;
grant execute on function public.configure_gift_market_liquidity_policy(integer,integer,integer) to service_role;
grant execute on function public.gift_market_collection_cards_v210(integer) to service_role;
grant execute on function public.gift_market_listed_count() to service_role;
grant execute on function public.gift_market_random_page(text,integer,integer) to service_role;
grant execute on function public.gift_market_filtered_page_v200(text,integer,integer,text,text,text,text,text,text,text) to service_role;

commit;
