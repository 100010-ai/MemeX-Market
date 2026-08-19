begin;

-- MXM v0.11 — finite Genesis Gift market.
-- Only real Telegram Gift assets already stored in gift_assets are eligible.
-- The pool is snapshotted once, released by system market makers once, and is
-- never replenished after players buy it. Secondary trading then belongs to players.

create table if not exists public.gift_genesis_state (
  singleton boolean primary key default true check (singleton),
  seed text not null default encode(gen_random_bytes(24),'hex'),
  started_at timestamptz,
  completed_at timestamptz,
  snapshot_count integer not null default 0 check (snapshot_count >= 0),
  released_count integer not null default 0 check (released_count >= 0),
  updated_at timestamptz not null default now()
);
insert into public.gift_genesis_state(singleton) values(true) on conflict(singleton) do nothing;
alter table public.gift_genesis_state enable row level security;
revoke all on public.gift_genesis_state from public,anon,authenticated;
grant all on public.gift_genesis_state to service_role;

create table if not exists public.gift_genesis_pool (
  asset_id uuid primary key references public.gift_assets(id) on delete cascade,
  release_key text not null,
  rarity_tier text not null check (rarity_tier in ('common','uncommon','rare','epic','legendary')),
  virtual_gift_id uuid unique references public.virtual_gifts(id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists gift_genesis_pool_release_idx on public.gift_genesis_pool(released_at,rarity_tier,release_key);
alter table public.gift_genesis_pool enable row level security;
revoke all on public.gift_genesis_pool from public,anon,authenticated;
grant all on public.gift_genesis_pool to service_role;

create or replace function public.initialize_gift_genesis_pool()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_seed text;
  v_started timestamptz;
  v_completed timestamptz;
  v_total integer;
  v_released integer;
begin
  select seed,started_at,completed_at into v_seed,v_started,v_completed
  from public.gift_genesis_state where singleton=true for update;

  -- Until the Genesis cohort is fully released, newly synchronized verified
  -- catalogue assets can still join the initial finite pool. Once completed,
  -- the pool is sealed forever and no new NPC supply is introduced.
  if v_completed is null then
    insert into public.gift_genesis_pool(asset_id,release_key,rarity_tier)
    select
      ga.id,
      md5(v_seed || ':' || ga.id::text),
      case
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille) <= 5 then 'legendary'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille) <= 20 then 'epic'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille) <= 60 then 'rare'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille) <= 180 then 'uncommon'
        else 'common'
      end
    from public.gift_assets ga
    where ga.catalog_source='bot_catalog'
      and ga.is_burned=false
      and ga.telegram_name is not null
      and ga.model_file_id is not null
      and ga.symbol_file_id is not null
    on conflict(asset_id) do nothing;

    if v_started is null then
      update public.gift_genesis_state set started_at=now(),updated_at=now() where singleton=true;
    end if;
  end if;

  -- Existing virtual instances from an earlier NPC version become part of the
  -- finite Genesis cohort instead of being duplicated.
  update public.gift_genesis_pool gp
  set virtual_gift_id=vg.id,
      released_at=coalesce(gp.released_at,vg.created_at,now())
  from public.virtual_gifts vg
  where vg.asset_id=gp.asset_id
    and (gp.virtual_gift_id is distinct from vg.id or gp.released_at is null);

  select count(*)::integer,
         count(*) filter(where released_at is not null)::integer
  into v_total,v_released
  from public.gift_genesis_pool;

  update public.gift_genesis_state
  set snapshot_count=v_total,
      released_count=v_released,
      completed_at=case when v_total>0 and v_released>=v_total then coalesce(completed_at,now()) else null end,
      updated_at=now()
  where singleton=true;

  return jsonb_build_object(
    'total',v_total,
    'released',v_released,
    'remaining',greatest(0,v_total-v_released),
    'completed',v_total>0 and v_released>=v_total,
    'seed',v_seed
  );
end;
$$;

create or replace function public.genesis_market_candidates(p_limit integer default 24)
returns table(
  asset_id uuid,
  base_name text,
  gift_number integer,
  model_rarity_per_mille integer,
  symbol_rarity_per_mille integer,
  backdrop_rarity_per_mille integer,
  last_seen_at timestamptz,
  rarity_tier text,
  release_key text
) language sql security definer set search_path=public stable as $$
  with ranked as (
    select
      ga.id as asset_id,
      ga.base_name,
      ga.gift_number,
      ga.model_rarity_per_mille,
      ga.symbol_rarity_per_mille,
      ga.backdrop_rarity_per_mille,
      ga.last_seen_at,
      gp.rarity_tier,
      gp.release_key,
      row_number() over(partition by gp.rarity_tier order by gp.release_key) as tier_row,
      case gp.rarity_tier
        when 'common' then 1
        when 'uncommon' then 2
        when 'rare' then 3
        when 'epic' then 4
        else 5
      end as tier_order
    from public.gift_genesis_pool gp
    join public.gift_assets ga on ga.id=gp.asset_id
    where gp.released_at is null
      and ga.is_burned=false
      and not exists(select 1 from public.virtual_gifts vg where vg.asset_id=ga.id)
  )
  select asset_id,base_name,gift_number,model_rarity_per_mille,symbol_rarity_per_mille,
         backdrop_rarity_per_mille,last_seen_at,rarity_tier,release_key
  from ranked
  order by tier_row,tier_order,release_key
  limit greatest(1,least(coalesce(p_limit,24),1000));
$$;

-- Preserve the existing seeding API, but mark every successful system release
-- as consumed from the finite Genesis pool.
create or replace function public.npc_seed_virtual_gift(
  p_asset_id uuid,
  p_price numeric,
  p_fair_price numeric,
  p_rarity_score numeric,
  p_pricing_mode text,
  p_desk integer default 0
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_asset public.gift_assets; v_profile public.profiles; v_id uuid;
begin
  if p_price is null or p_price<=0 or p_price>1000000 then raise exception 'Invalid NPC listing price'; end if;
  if p_fair_price is null or p_fair_price<=0 then raise exception 'Invalid NPC fair price'; end if;
  if p_rarity_score is null or p_rarity_score<0 or p_rarity_score>1 then raise exception 'Invalid NPC rarity score'; end if;
  if p_pricing_mode not in ('normal','discount','rare_deal') then raise exception 'Invalid NPC pricing mode'; end if;

  select * into v_asset from public.gift_assets where id=p_asset_id for update;
  if not found then raise exception 'Gift asset not found'; end if;
  if v_asset.catalog_source<>'bot_catalog' then raise exception 'NPC can list only Telegram catalogue assets'; end if;
  if v_asset.is_burned then raise exception 'Burned Gift cannot be listed'; end if;

  select id into v_id from public.virtual_gifts where asset_id=p_asset_id;
  if v_id is not null then
    update public.gift_genesis_pool set virtual_gift_id=v_id,released_at=coalesce(released_at,now()) where asset_id=p_asset_id;
    return v_id;
  end if;

  v_profile := public.ensure_npc_market_maker(p_desk);
  insert into public.virtual_gifts(asset_id,source_owner_profile_id,owner_profile_id,acquired_price,listing_price,status)
  values(p_asset_id,v_profile.id,v_profile.id,p_fair_price,p_price,'listed')
  returning id into v_id;

  insert into public.npc_market_log(virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score)
  values(v_id,p_asset_id,v_profile.id,p_fair_price,p_price,p_pricing_mode,p_rarity_score);

  update public.gift_genesis_pool set virtual_gift_id=v_id,released_at=now() where asset_id=p_asset_id;

  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount)
  values(v_profile.id,'listing',v_id,p_price);
  return v_id;
end;
$$;

create or replace function public.gift_genesis_public_state()
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'total',s.snapshot_count,
    'released',s.released_count,
    'remainingToRelease',greatest(0,s.snapshot_count-s.released_count),
    'completed',s.completed_at is not null,
    'npcAvailable',(
      select count(*)::integer
      from public.gift_genesis_pool gp
      join public.virtual_gifts vg on vg.id=gp.virtual_gift_id
      join public.profiles p on p.id=vg.owner_profile_id
      where p.is_system=true and vg.status='listed'
    )
  )
  from public.gift_genesis_state s where s.singleton=true;
$$;

create or replace function public.gift_market_random_page(p_seed text,p_offset integer default 0,p_limit integer default 72)
returns setof public.gift_market_overview
language sql security definer set search_path=public stable as $$
  select g.*
  from public.gift_market_overview g
  where g.status='listed' and g.is_burned=false and g.telegram_name is not null
  order by md5(coalesce(p_seed,'mxm') || ':' || g.virtual_gift_id::text)
  offset greatest(0,coalesce(p_offset,0))
  limit greatest(1,least(coalesce(p_limit,72),120));
$$;

create or replace function public.gift_market_listed_count()
returns integer language sql security definer set search_path=public stable as $$
  select count(*)::integer from public.gift_market_overview
  where status='listed' and is_burned=false and telegram_name is not null;
$$;

revoke execute on function public.initialize_gift_genesis_pool() from public,anon,authenticated;
revoke execute on function public.genesis_market_candidates(integer) from public,anon,authenticated;
revoke execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) from public,anon,authenticated;
revoke execute on function public.gift_genesis_public_state() from public,anon,authenticated;
revoke execute on function public.gift_market_random_page(text,integer,integer) from public,anon,authenticated;
revoke execute on function public.gift_market_listed_count() from public,anon,authenticated;
grant execute on function public.initialize_gift_genesis_pool() to service_role;
grant execute on function public.genesis_market_candidates(integer) to service_role;
grant execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) to service_role;
grant execute on function public.gift_genesis_public_state() to service_role;
grant execute on function public.gift_market_random_page(text,integer,integer) to service_role;
grant execute on function public.gift_market_listed_count() to service_role;

commit;
