begin;

-- MXM v0.12 — zero-config real Gift discovery via TonAPI + safer catalogue state.
-- TonAPI rows represent real exported Telegram Gift NFTs on TON. No synthetic
-- NFT identity, model, symbol or backdrop is created by this migration.

alter table public.gift_assets add column if not exists chain_nft_address text;
alter table public.gift_assets add column if not exists chain_collection_address text;
alter table public.gift_assets add column if not exists chain_verified boolean not null default false;
alter table public.gift_assets add column if not exists chain_metadata jsonb;

create unique index if not exists gift_assets_chain_nft_address_uidx
  on public.gift_assets(chain_nft_address)
  where chain_nft_address is not null;
create index if not exists gift_assets_chain_collection_idx
  on public.gift_assets(chain_collection_address)
  where chain_collection_address is not null;

alter table public.gift_assets drop constraint if exists gift_assets_catalog_source_check;
alter table public.gift_assets add constraint gift_assets_catalog_source_check
  check (catalog_source in ('profile_sync','bot_catalog','tonapi'));

create table if not exists public.tonapi_catalog_state (
  singleton boolean primary key default true check (singleton),
  collection_offset integer not null default 0 check (collection_offset >= 0),
  last_discovery_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  lock_until timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.tonapi_catalog_state(singleton) values(true) on conflict(singleton) do nothing;
alter table public.tonapi_catalog_state enable row level security;
revoke all on public.tonapi_catalog_state from public,anon,authenticated;
grant all on public.tonapi_catalog_state to service_role;

create or replace function public.acquire_tonapi_catalog_lock(p_seconds integer default 90)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_until timestamptz;
begin
  if p_seconds<10 or p_seconds>300 then raise exception 'Invalid TonAPI lock duration'; end if;
  select lock_until into v_until from public.tonapi_catalog_state where singleton=true for update;
  if v_until is not null and v_until>now() then return false; end if;
  update public.tonapi_catalog_state set lock_until=now()+make_interval(secs=>p_seconds),updated_at=now() where singleton=true;
  return true;
end;
$$;

create or replace function public.release_tonapi_catalog_lock()
returns void language sql security definer set search_path=public as $$
  update public.tonapi_catalog_state set lock_until=null,updated_at=now() where singleton=true;
$$;

revoke execute on function public.acquire_tonapi_catalog_lock(integer) from public,anon,authenticated;
revoke execute on function public.release_tonapi_catalog_lock() from public,anon,authenticated;
grant execute on function public.acquire_tonapi_catalog_lock(integer) to service_role;
grant execute on function public.release_tonapi_catalog_lock() to service_role;

create table if not exists public.tonapi_gift_collections (
  address text primary key,
  name text not null,
  description text,
  total_hint bigint,
  next_offset integer not null default 0 check (next_offset >= 0),
  active boolean not null default true,
  verified_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tonapi_gift_collections_sync_idx
  on public.tonapi_gift_collections(active,last_synced_at,next_offset);
alter table public.tonapi_gift_collections enable row level security;
revoke all on public.tonapi_gift_collections from public,anon,authenticated;
grant all on public.tonapi_gift_collections to service_role;

-- v0.12 intentionally re-opens the finite initial cohort once so newly
-- discovered real on-chain Telegram Gifts can join the initial distribution.
-- Already sold/released items are not duplicated.
update public.gift_genesis_state
set completed_at=null, updated_at=now()
where singleton=true;

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
    where ga.catalog_source in ('bot_catalog','tonapi')
      and ga.is_burned=false
      and ga.telegram_name is not null
      and (
        (ga.catalog_source='bot_catalog' and ga.model_file_id is not null and ga.symbol_file_id is not null)
        or
        (ga.catalog_source='tonapi' and ga.chain_verified=true and ga.model_media_url is not null)
      )
    on conflict(asset_id) do nothing;

    if v_started is null then
      update public.gift_genesis_state set started_at=now(),updated_at=now() where singleton=true;
    end if;
  end if;

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
  if v_asset.catalog_source not in ('bot_catalog','tonapi') then raise exception 'NPC can list only verified Telegram catalogue assets'; end if;
  if v_asset.catalog_source='tonapi' and not v_asset.chain_verified then raise exception 'Unverified TON NFT cannot enter Genesis'; end if;
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

revoke execute on function public.initialize_gift_genesis_pool() from public,anon,authenticated;
revoke execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) from public,anon,authenticated;
grant execute on function public.initialize_gift_genesis_pool() to service_role;
grant execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) to service_role;

-- ---------------------------------------------------------------------------
-- Trading v3: authoritative server execution with client-provided slippage
-- floor. The UI may calculate quotes instantly, but PostgreSQL recomputes the
-- AMM result under row locks and rejects stale quotes.
-- ---------------------------------------------------------------------------
create or replace function public.buy_coin_v2(
  p_profile_id uuid,
  p_coin_id uuid,
  p_quote_amount numeric,
  p_min_token_out numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles; v_coin public.coins; v_fee_rate numeric := 0.005;
  v_quote_net numeric; v_k numeric; v_new_quote numeric; v_new_token numeric;
  v_token_out numeric; v_exec_price numeric; v_reserved numeric;
begin
  if p_quote_amount is null or p_quote_amount < 0.01 then raise exception 'Minimum buy is 0.01 virtual TON'; end if;
  if p_min_token_out is null or p_min_token_out < 0 then raise exception 'Invalid slippage floor'; end if;

  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  v_reserved := public.pending_gift_offer_total(p_profile_id,null);
  if v_profile.balance-v_reserved < p_quote_amount then raise exception 'Insufficient available balance'; end if;

  select * into v_coin from public.coins where id=p_coin_id and status='active' for update;
  if not found then raise exception 'Coin is not tradeable'; end if;
  if v_coin.token_reserve<=0 or v_coin.quote_reserve<=0 then raise exception 'Coin reserves are invalid'; end if;

  v_quote_net := p_quote_amount*(1-v_fee_rate);
  v_k := v_coin.token_reserve*v_coin.quote_reserve;
  v_new_quote := v_coin.quote_reserve+v_quote_net;
  v_new_token := v_k/v_new_quote;
  v_token_out := v_coin.token_reserve-v_new_token;
  if v_token_out<=0 then raise exception 'Trade too small'; end if;
  if p_min_token_out>0 and v_token_out<p_min_token_out then raise exception 'Price moved beyond slippage limit'; end if;
  v_exec_price := p_quote_amount/v_token_out;

  update public.profiles set balance=balance-p_quote_amount,updated_at=now() where id=p_profile_id;
  insert into public.holdings(profile_id,coin_id,quantity,cost_basis)
  values(p_profile_id,p_coin_id,v_token_out,p_quote_amount)
  on conflict(profile_id,coin_id) do update set
    quantity=public.holdings.quantity+excluded.quantity,
    cost_basis=public.holdings.cost_basis+excluded.cost_basis,
    updated_at=now();

  update public.coins set
    token_reserve=v_new_token,
    quote_reserve=v_new_quote,
    current_price=v_new_quote/v_new_token,
    market_cap=(v_new_quote/v_new_token)*total_supply,
    updated_at=now()
  where id=p_coin_id returning * into v_coin;

  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl)
  values(p_profile_id,p_coin_id,'buy',p_quote_amount,v_token_out,v_exec_price,0);
  perform public.record_candle(p_coin_id,v_coin.current_price,p_quote_amount);
  perform public.bump_mission(p_profile_id,'coin_trade',1);

  return jsonb_build_object(
    'side','buy','quoteAmount',p_quote_amount,'tokenAmount',v_token_out,
    'executionPrice',v_exec_price,'newPrice',v_coin.current_price,
    'tokenReserve',v_coin.token_reserve,'quoteReserve',v_coin.quote_reserve
  );
end;
$$;

create or replace function public.sell_coin_v2(
  p_profile_id uuid,
  p_coin_id uuid,
  p_token_amount numeric,
  p_min_quote_out numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_coin public.coins; v_holding public.holdings; v_fee_rate numeric := 0.005;
  v_k numeric; v_new_token numeric; v_new_quote numeric; v_quote_gross numeric;
  v_quote_out numeric; v_exec_price numeric; v_cost_reduction numeric; v_realized numeric;
  v_sell_amount numeric;
begin
  if p_token_amount is null or p_token_amount<=0 then raise exception 'Invalid sell amount'; end if;
  if p_min_quote_out is null or p_min_quote_out<0 then raise exception 'Invalid slippage floor'; end if;

  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into v_holding from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id for update;
  if not found or v_holding.quantity<=0 then raise exception 'Недостаточно токенов'; end if;

  v_sell_amount := p_token_amount;
  if v_sell_amount>v_holding.quantity then
    if v_sell_amount-v_holding.quantity<=greatest(0.00000001,v_holding.quantity*0.000000000001) then
      v_sell_amount := v_holding.quantity;
    else
      raise exception 'Недостаточно токенов';
    end if;
  elsif v_holding.quantity-v_sell_amount<=greatest(0.00000001,v_holding.quantity*0.000000000001) then
    v_sell_amount := v_holding.quantity;
  end if;

  select * into v_coin from public.coins where id=p_coin_id and status='active' for update;
  if not found then raise exception 'Coin is not tradeable'; end if;
  if v_coin.token_reserve<=0 or v_coin.quote_reserve<=0 then raise exception 'Coin reserves are invalid'; end if;

  v_k := v_coin.token_reserve*v_coin.quote_reserve;
  v_new_token := v_coin.token_reserve+v_sell_amount;
  v_new_quote := v_k/v_new_token;
  v_quote_gross := v_coin.quote_reserve-v_new_quote;
  v_quote_out := v_quote_gross*(1-v_fee_rate);
  if v_quote_out<0.000001 then raise exception 'Trade too small'; end if;
  if p_min_quote_out>0 and v_quote_out<p_min_quote_out then raise exception 'Price moved beyond slippage limit'; end if;
  v_exec_price := v_quote_out/v_sell_amount;
  v_cost_reduction := case when v_sell_amount>=v_holding.quantity then v_holding.cost_basis else v_holding.cost_basis*(v_sell_amount/v_holding.quantity) end;
  v_realized := v_quote_out-v_cost_reduction;

  update public.profiles set balance=balance+v_quote_out,updated_at=now() where id=p_profile_id;
  update public.holdings set
    quantity=case when v_sell_amount>=quantity then 0 else quantity-v_sell_amount end,
    cost_basis=case when v_sell_amount>=quantity then 0 else greatest(0,cost_basis-v_cost_reduction) end,
    updated_at=now()
  where profile_id=p_profile_id and coin_id=p_coin_id;

  update public.coins set
    token_reserve=v_new_token,
    quote_reserve=v_new_quote,
    current_price=v_new_quote/v_new_token,
    market_cap=(v_new_quote/v_new_token)*total_supply,
    updated_at=now()
  where id=p_coin_id returning * into v_coin;

  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl)
  values(p_profile_id,p_coin_id,'sell',v_quote_out,v_sell_amount,v_exec_price,v_realized);
  perform public.record_candle(p_coin_id,v_coin.current_price,v_quote_out);
  perform public.bump_mission(p_profile_id,'coin_trade',1);
  if v_realized>0 then perform public.bump_mission(p_profile_id,'profitable_trade',1); end if;

  return jsonb_build_object(
    'side','sell','quoteAmount',v_quote_out,'tokenAmount',v_sell_amount,
    'executionPrice',v_exec_price,'newPrice',v_coin.current_price,'realizedPnl',v_realized,
    'tokenReserve',v_coin.token_reserve,'quoteReserve',v_coin.quote_reserve
  );
end;
$$;

create or replace function public.sell_coin_all_v2(
  p_profile_id uuid,
  p_coin_id uuid,
  p_min_quote_out numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_quantity numeric;
begin
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select quantity into v_quantity from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id for update;
  if v_quantity is null or v_quantity<=0 then raise exception 'Недостаточно токенов'; end if;
  return public.sell_coin_v2(p_profile_id,p_coin_id,v_quantity,p_min_quote_out);
end;
$$;

-- Idempotency ledger: a client/network retry can never execute the same
-- virtual coin trade twice. The advisory transaction lock serializes duplicate
-- request IDs even when they arrive concurrently at separate server instances.
create table if not exists public.coin_trade_requests (
  request_id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  coin_id uuid not null references public.coins(id) on delete cascade,
  side text not null check (side in ('buy','sell')),
  input_amount numeric not null,
  sell_all boolean not null default false,
  min_output numeric not null default 0,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists coin_trade_requests_profile_created_idx on public.coin_trade_requests(profile_id,created_at desc);
alter table public.coin_trade_requests enable row level security;
revoke all on public.coin_trade_requests from public,anon,authenticated;
grant all on public.coin_trade_requests to service_role;

create or replace function public.execute_coin_trade_v3(
  p_request_id uuid,
  p_profile_id uuid,
  p_coin_id uuid,
  p_side text,
  p_amount numeric,
  p_sell_all boolean default false,
  p_min_output numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_existing public.coin_trade_requests; v_result jsonb;
begin
  if p_request_id is null then raise exception 'Trade request ID is required'; end if;
  if p_side not in ('buy','sell') then raise exception 'Invalid trade side'; end if;
  if p_min_output is null or p_min_output<0 then raise exception 'Invalid slippage floor'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_existing from public.coin_trade_requests where request_id=p_request_id;
  if found then
    if v_existing.profile_id<>p_profile_id or v_existing.coin_id<>p_coin_id or v_existing.side<>p_side
       or v_existing.input_amount is distinct from p_amount
       or v_existing.sell_all is distinct from p_sell_all
       or v_existing.min_output is distinct from p_min_output then
      raise exception 'Trade request ID was already used for another operation';
    end if;
    return v_existing.result;
  end if;

  if p_side='buy' then
    if p_sell_all then raise exception 'sell_all is invalid for buy'; end if;
    v_result := public.buy_coin_v2(p_profile_id,p_coin_id,p_amount,p_min_output);
  elsif p_sell_all then
    v_result := public.sell_coin_all_v2(p_profile_id,p_coin_id,p_min_output);
  else
    v_result := public.sell_coin_v2(p_profile_id,p_coin_id,p_amount,p_min_output);
  end if;

  insert into public.coin_trade_requests(request_id,profile_id,coin_id,side,input_amount,sell_all,min_output,result)
  values(p_request_id,p_profile_id,p_coin_id,p_side,p_amount,p_sell_all,p_min_output,v_result);
  return v_result;
end;
$$;

revoke execute on function public.buy_coin_v2(uuid,uuid,numeric,numeric) from public,anon,authenticated;
revoke execute on function public.sell_coin_v2(uuid,uuid,numeric,numeric) from public,anon,authenticated;
revoke execute on function public.sell_coin_all_v2(uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.buy_coin_v2(uuid,uuid,numeric,numeric) to service_role;
grant execute on function public.sell_coin_v2(uuid,uuid,numeric,numeric) to service_role;
grant execute on function public.sell_coin_all_v2(uuid,uuid,numeric) to service_role;
revoke execute on function public.execute_coin_trade_v3(uuid,uuid,uuid,text,numeric,boolean,numeric) from public,anon,authenticated;
grant execute on function public.execute_coin_trade_v3(uuid,uuid,uuid,text,numeric,boolean,numeric) to service_role;


commit;
