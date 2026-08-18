begin;

-- MXM v0.8.1 — Bot API catalogue sources + offline NPC liquidity engine.
-- No demo/fake Gifts are inserted. NPCs may list only validated rows that
-- already exist in gift_assets and were imported from Telegram Bot API.

alter table public.gift_assets drop constraint if exists gift_assets_catalog_source_check;

update public.gift_assets
set catalog_source='bot_catalog',
    source_reference=coalesce(source_reference,'legacy-catalog')
where catalog_source='telegram_resale';

alter table public.gift_assets add constraint gift_assets_catalog_source_check
  check (catalog_source in ('profile_sync','bot_catalog'));

create index if not exists gift_assets_bot_catalog_idx
  on public.gift_assets(catalog_source,last_seen_at desc)
  where catalog_source='bot_catalog' and is_burned=false;

create table if not exists public.gift_catalog_sources (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique check (telegram_id > 0),
  label text,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gift_catalog_sources_active_idx on public.gift_catalog_sources(active,created_at);
alter table public.gift_catalog_sources enable row level security;
revoke all on public.gift_catalog_sources from public,anon,authenticated;
grant all on public.gift_catalog_sources to service_role;

create table if not exists public.npc_market_state (
  key text primary key,
  locked_until timestamptz,
  last_tick_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  cycle bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.npc_market_state(key) values('gift-liquidity') on conflict(key) do nothing;
alter table public.npc_market_state enable row level security;
revoke all on public.npc_market_state from public,anon,authenticated;
grant all on public.npc_market_state to service_role;

create table if not exists public.npc_market_log (
  id uuid primary key default gen_random_uuid(),
  virtual_gift_id uuid references public.virtual_gifts(id) on delete set null,
  asset_id uuid references public.gift_assets(id) on delete set null,
  npc_profile_id uuid references public.profiles(id) on delete set null,
  fair_price numeric(24,8) not null check (fair_price > 0),
  listing_price numeric(24,8) not null check (listing_price > 0),
  pricing_mode text not null check (pricing_mode in ('normal','discount','rare_deal')),
  rarity_score numeric(8,6) not null check (rarity_score between 0 and 1),
  created_at timestamptz not null default now()
);
create index if not exists npc_market_log_created_idx on public.npc_market_log(created_at desc);
alter table public.npc_market_log enable row level security;
revoke all on public.npc_market_log from public,anon,authenticated;
grant all on public.npc_market_log to service_role;

create or replace function public.ensure_npc_market_maker(p_desk integer)
returns public.profiles language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles; v_telegram_id bigint; v_name text;
begin
  if p_desk not between 0 and 2 then raise exception 'Invalid NPC desk'; end if;
  v_telegram_id := -900000000000000011 - p_desk;
  v_name := case p_desk when 0 then 'MXM Liquidity' when 1 then 'MXM Market Maker' else 'MXM Gift Desk' end;
  insert into public.profiles(telegram_id,username,first_name,last_name,photo_url,balance,is_system,hidden_from_leaderboard)
  values(v_telegram_id,null,v_name,null,null,0,true,true)
  on conflict(telegram_id) do update set is_system=true,hidden_from_leaderboard=true,first_name=v_name,updated_at=now()
  returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.acquire_npc_market_lock(p_cooldown_seconds integer default 20,p_lock_seconds integer default 8)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_acquired boolean := false;
begin
  if p_cooldown_seconds < 5 or p_cooldown_seconds > 600 then raise exception 'Invalid NPC cooldown'; end if;
  if p_lock_seconds < 2 or p_lock_seconds > 60 then raise exception 'Invalid NPC lock'; end if;
  update public.npc_market_state
  set locked_until=now()+make_interval(secs=>p_lock_seconds),last_tick_at=now(),cycle=cycle+1,updated_at=now()
  where key='gift-liquidity'
    and (locked_until is null or locked_until<now())
    and (last_tick_at is null or last_tick_at<now()-make_interval(secs=>p_cooldown_seconds))
  returning true into v_acquired;
  return coalesce(v_acquired,false);
end;
$$;

create or replace function public.release_npc_market_lock(p_success boolean,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.npc_market_state
  set locked_until=null,
      last_success_at=case when p_success then now() else last_success_at end,
      last_error=case when p_success then null else left(coalesce(p_error,'Unknown NPC market error'),1200) end,
      updated_at=now()
  where key='gift-liquidity';
end;
$$;

create or replace function public.npc_market_listing_count()
returns integer language sql security definer set search_path=public stable as $$
  select count(*)::integer
  from public.virtual_gifts vg
  join public.profiles p on p.id=vg.owner_profile_id
  join public.gift_assets ga on ga.id=vg.asset_id
  where p.is_system=true and vg.status='listed' and vg.listing_price is not null and ga.is_burned=false;
$$;

create or replace function public.npc_market_candidates(p_limit integer default 80)
returns table(
  asset_id uuid,
  base_name text,
  gift_number integer,
  model_rarity_per_mille integer,
  symbol_rarity_per_mille integer,
  backdrop_rarity_per_mille integer,
  last_seen_at timestamptz
) language sql security definer set search_path=public stable as $$
  select ga.id,ga.base_name,ga.gift_number,ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille,ga.last_seen_at
  from public.gift_assets ga
  where ga.catalog_source='bot_catalog'
    and ga.is_burned=false
    and ga.telegram_name is not null
    and not exists(select 1 from public.virtual_gifts vg where vg.asset_id=ga.id)
  order by ga.last_seen_at desc,ga.id
  limit greatest(1,least(coalesce(p_limit,80),240));
$$;

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
  if v_asset.catalog_source<>'bot_catalog' then raise exception 'NPC can list only Bot API catalogue assets'; end if;
  if v_asset.is_burned then raise exception 'Burned Gift cannot be listed'; end if;
  if exists(select 1 from public.virtual_gifts where asset_id=p_asset_id) then
    select id into v_id from public.virtual_gifts where asset_id=p_asset_id;
    return v_id;
  end if;

  v_profile := public.ensure_npc_market_maker(p_desk);
  insert into public.virtual_gifts(asset_id,source_owner_profile_id,owner_profile_id,acquired_price,listing_price,status)
  values(p_asset_id,v_profile.id,v_profile.id,p_fair_price,p_price,'listed')
  returning id into v_id;

  insert into public.npc_market_log(virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score)
  values(v_id,p_asset_id,v_profile.id,p_fair_price,p_price,p_pricing_mode,p_rarity_score);

  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount)
  values(v_profile.id,'listing',v_id,p_price);
  return v_id;
end;
$$;

revoke execute on function public.ensure_npc_market_maker(integer) from public,anon,authenticated;
revoke execute on function public.acquire_npc_market_lock(integer,integer) from public,anon,authenticated;
revoke execute on function public.release_npc_market_lock(boolean,text) from public,anon,authenticated;
revoke execute on function public.npc_market_listing_count() from public,anon,authenticated;
revoke execute on function public.npc_market_candidates(integer) from public,anon,authenticated;
revoke execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) from public,anon,authenticated;
grant execute on function public.ensure_npc_market_maker(integer) to service_role;
grant execute on function public.acquire_npc_market_lock(integer,integer) to service_role;
grant execute on function public.release_npc_market_lock(boolean,text) to service_role;
grant execute on function public.npc_market_listing_count() to service_role;
grant execute on function public.npc_market_candidates(integer) to service_role;
grant execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) to service_role;

-- Any legacy MTProto catalogue diagnostics are left intact for upgrade safety,
-- but v0.8.1 no longer reads them and no user session is required by the app.

commit;
