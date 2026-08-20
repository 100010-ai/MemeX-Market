begin;

-- MXM v0.56 — Quality Update + Marketplace 2.0 + conditional memecoin orders
-- + runtime configuration + economy/risk observability.
-- All TON amounts remain internal MXM units and are not withdrawable on-chain.

-- ---------------------------------------------------------------------------
-- Runtime config. This is intentionally service-role only: the public API
-- exposes a sanitized read model and the admin API performs validated writes.
-- ---------------------------------------------------------------------------
create table if not exists public.runtime_config_v056 (
  singleton boolean primary key default true check(singleton),
  maintenance_mode boolean not null default false,
  maintenance_message text not null default 'Проводим технические работы. Попробуйте ещё раз чуть позже.' check(char_length(maintenance_message) between 1 and 240),
  feature_flags jsonb not null default '{"gifts":true,"memecoins":true,"referrals":true,"rewardedAds":true,"sponsoredTasks":false,"stars":true}'::jsonb,
  remote_config jsonb not null default '{"maxPriceAlerts":20,"maxWatchlistItems":100,"marketPageSize":24,"coinOrderMaxOpen":20,"coinOrderMaxDays":30}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.runtime_config_v056(singleton) values(true) on conflict(singleton) do nothing;
alter table public.runtime_config_v056 enable row level security;
revoke all on public.runtime_config_v056 from public,anon,authenticated;
grant select,update on public.runtime_config_v056 to service_role;

-- ---------------------------------------------------------------------------
-- Advanced Gift offers: collection/model/backdrop/symbol bids with a maximum
-- number of fills. Maximum commitment is reserved from the buyer's balance.
-- ---------------------------------------------------------------------------
create table if not exists public.advanced_gift_offers_v056 (
  id uuid primary key default gen_random_uuid(),
  buyer_profile_id uuid not null references public.profiles(id) on delete cascade,
  base_name text not null check(char_length(trim(base_name)) between 1 and 120),
  scope_type text not null check(scope_type in ('collection','model','backdrop','symbol')),
  trait_value text,
  amount numeric(24,8) not null check(amount between 0.01 and 1000000000),
  max_fills integer not null default 1 check(max_fills between 1 and 50),
  filled_count integer not null default 0 check(filled_count>=0 and filled_count<=max_fills),
  status text not null default 'active' check(status in ('active','filled','cancelled','expired')),
  expires_at timestamptz not null default (now()+interval '72 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (scope_type='collection' and trait_value is null)
    or (scope_type in ('model','backdrop','symbol') and trait_value is not null and char_length(trim(trait_value)) between 1 and 120)
  )
);
create index if not exists advanced_gift_offers_v056_market_idx on public.advanced_gift_offers_v056(base_name,scope_type,status,amount desc) where status='active';
create index if not exists advanced_gift_offers_v056_buyer_idx on public.advanced_gift_offers_v056(buyer_profile_id,created_at desc);
create unique index if not exists advanced_gift_offers_v056_one_active_idx
  on public.advanced_gift_offers_v056(buyer_profile_id,base_name,scope_type,coalesce(trait_value,'')) where status='active';
alter table public.advanced_gift_offers_v056 enable row level security;
revoke all on public.advanced_gift_offers_v056 from public,anon,authenticated;
grant all on public.advanced_gift_offers_v056 to service_role;

-- ---------------------------------------------------------------------------
-- Conditional memecoin orders. Buy orders reserve internal TON. Sell orders
-- reserve token quantity logically at creation time by checking all open sells.
-- Execution is idempotent via execute_coin_trade_v3 + execution_request_id.
-- ---------------------------------------------------------------------------
create table if not exists public.coin_conditional_orders_v056 (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  coin_id uuid not null references public.coins(id) on delete cascade,
  kind text not null check(kind in ('limit_buy','limit_sell','take_profit','stop_loss')),
  trigger_price numeric(30,16) not null check(trigger_price>0),
  input_amount numeric(30,8) not null check(input_amount>0),
  status text not null default 'active' check(status in ('active','executing','filled','cancelled','expired','failed')),
  request_key text not null check(char_length(request_key) between 8 and 120),
  execution_request_id uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  result jsonb,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_at timestamptz,
  unique(profile_id,request_key)
);
create index if not exists coin_conditional_orders_v056_trigger_idx on public.coin_conditional_orders_v056(coin_id,status,trigger_price) where status='active';
create index if not exists coin_conditional_orders_v056_profile_idx on public.coin_conditional_orders_v056(profile_id,created_at desc);
alter table public.coin_conditional_orders_v056 enable row level security;
revoke all on public.coin_conditional_orders_v056 from public,anon,authenticated;
grant all on public.coin_conditional_orders_v056 to service_role;

-- Unified reserved balance. Existing functions keep calling
-- pending_gift_offer_total, so redefining it upgrades all hot paths without
-- proliferating a second notion of "available balance".
create or replace function public.reserved_market_balance_v056(
  p_profile_id uuid,
  p_exclude_virtual_gift_id uuid default null,
  p_exclude_advanced_offer_id uuid default null,
  p_exclude_coin_order_id uuid default null
)
returns numeric language sql security definer set search_path=public stable as $$
  select
    coalesce((
      select sum(amount) from public.gift_offers
      where buyer_profile_id=p_profile_id and status='pending'
        and (expires_at is null or expires_at>now())
        and (p_exclude_virtual_gift_id is null or virtual_gift_id<>p_exclude_virtual_gift_id)
    ),0)
    + coalesce((
      select sum(amount*greatest(0,max_fills-filled_count)) from public.advanced_gift_offers_v056
      where buyer_profile_id=p_profile_id and status='active' and expires_at>now()
        and (p_exclude_advanced_offer_id is null or id<>p_exclude_advanced_offer_id)
    ),0)
    + coalesce((
      select sum(input_amount) from public.coin_conditional_orders_v056
      where profile_id=p_profile_id and kind='limit_buy' and status='active' and expires_at>now()
        and (p_exclude_coin_order_id is null or id<>p_exclude_coin_order_id)
    ),0);
$$;
revoke execute on function public.reserved_market_balance_v056(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserved_market_balance_v056(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.pending_gift_offer_total(p_profile_id uuid, p_exclude_virtual_gift_id uuid default null)
returns numeric language sql security definer set search_path=public stable as $$
  select public.reserved_market_balance_v056(p_profile_id,p_exclude_virtual_gift_id,null,null);
$$;

create or replace function public.create_advanced_gift_offer_v056(
  p_buyer_id uuid,
  p_base_name text,
  p_scope_type text,
  p_trait_value text,
  p_amount numeric,
  p_max_fills integer default 1,
  p_duration_hours integer default 72
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_buyer public.profiles;
  v_offer public.advanced_gift_offers_v056;
  v_reserved numeric;
  v_total numeric;
  v_trait text;
  v_hours integer;
begin
  p_base_name:=trim(coalesce(p_base_name,''));
  p_scope_type:=trim(coalesce(p_scope_type,''));
  v_trait:=nullif(trim(coalesce(p_trait_value,'')),'');
  if char_length(p_base_name)<1 or char_length(p_base_name)>120 then raise exception 'Invalid collection'; end if;
  if p_scope_type not in ('collection','model','backdrop','symbol') then raise exception 'Invalid offer scope'; end if;
  if p_scope_type='collection' then v_trait:=null; elsif v_trait is null or char_length(v_trait)>120 then raise exception 'Trait is required'; end if;
  if p_amount is null or p_amount<0.01 or p_amount>1000000000 then raise exception 'Invalid offer amount'; end if;
  if p_max_fills is null or p_max_fills<1 or p_max_fills>50 then raise exception 'Invalid max fills'; end if;
  v_hours:=greatest(1,least(coalesce(p_duration_hours,72),720));

  -- Reject impossible targets instead of creating inert orders.
  if not exists(select 1 from public.gift_assets where base_name=p_base_name and is_burned=false) then raise exception 'Collection not found'; end if;
  if p_scope_type='model' and not exists(select 1 from public.gift_assets where base_name=p_base_name and model_name=v_trait and is_burned=false) then raise exception 'Model not found'; end if;
  if p_scope_type='backdrop' and not exists(select 1 from public.gift_assets where base_name=p_base_name and backdrop_name=v_trait and is_burned=false) then raise exception 'Backdrop not found'; end if;
  if p_scope_type='symbol' and not exists(select 1 from public.gift_assets where base_name=p_base_name and symbol_name=v_trait and is_burned=false) then raise exception 'Symbol not found'; end if;

  select * into v_buyer from public.profiles where id=p_buyer_id for update;
  if not found then raise exception 'Buyer not found'; end if;
  v_reserved:=public.reserved_market_balance_v056(p_buyer_id,null,null,null);
  v_total:=p_amount*p_max_fills;
  if v_buyer.balance-v_reserved<v_total then raise exception 'Insufficient available balance for this offer'; end if;

  -- Replace the buyer's previous active offer for exactly this target. The row
  -- remains in history as cancelled rather than being overwritten.
  update public.advanced_gift_offers_v056 set status='cancelled',updated_at=now()
  where buyer_profile_id=p_buyer_id and base_name=p_base_name and scope_type=p_scope_type
    and coalesce(trait_value,'')=coalesce(v_trait,'') and status='active';

  insert into public.advanced_gift_offers_v056(buyer_profile_id,base_name,scope_type,trait_value,amount,max_fills,expires_at)
  values(p_buyer_id,p_base_name,p_scope_type,v_trait,p_amount,p_max_fills,now()+make_interval(hours=>v_hours))
  returning * into v_offer;

  return jsonb_build_object('id',v_offer.id,'amount',v_offer.amount,'maxFills',v_offer.max_fills,'expiresAt',v_offer.expires_at,'reservedTotal',v_reserved+v_total);
end;
$$;
revoke execute on function public.create_advanced_gift_offer_v056(uuid,text,text,text,numeric,integer,integer) from public,anon,authenticated;
grant execute on function public.create_advanced_gift_offer_v056(uuid,text,text,text,numeric,integer,integer) to service_role;

create or replace function public.cancel_advanced_gift_offer_v056(p_buyer_id uuid,p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_offer public.advanced_gift_offers_v056;
begin
  select * into v_offer from public.advanced_gift_offers_v056 where id=p_offer_id for update;
  if not found or v_offer.buyer_profile_id<>p_buyer_id then raise exception 'Offer not found'; end if;
  if v_offer.status<>'active' then return jsonb_build_object('status',v_offer.status); end if;
  update public.advanced_gift_offers_v056 set status='cancelled',updated_at=now() where id=p_offer_id;
  return jsonb_build_object('status','cancelled');
end;
$$;
revoke execute on function public.cancel_advanced_gift_offer_v056(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_advanced_gift_offer_v056(uuid,uuid) to service_role;

create or replace function public.accept_advanced_gift_offer_v056(p_owner_id uuid,p_virtual_gift_id uuid,p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_offer public.advanced_gift_offers_v056;
  v_gift public.virtual_gifts;
  v_asset public.gift_assets;
  v_buyer public.profiles;
  v_reserved numeric;
  v_fee_bps integer:=0;
  v_fee numeric:=0;
  v_seller_net numeric;
  v_realized numeric;
  v_treasury uuid;
begin
  select * into v_offer from public.advanced_gift_offers_v056 where id=p_offer_id for update;
  if not found or v_offer.status<>'active' then raise exception 'Offer is no longer active'; end if;
  if v_offer.expires_at<=now() then update public.advanced_gift_offers_v056 set status='expired',updated_at=now() where id=v_offer.id; raise exception 'Offer expired'; end if;
  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id for update;
  if not found or v_gift.owner_profile_id is distinct from p_owner_id then raise exception 'You do not own this Gift'; end if;
  if v_gift.owner_profile_id=v_offer.buyer_profile_id then raise exception 'Buyer already owns this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
  if not found or v_asset.is_burned then raise exception 'Gift is unavailable'; end if;
  if v_asset.base_name<>v_offer.base_name then raise exception 'Offer does not match this collection'; end if;
  if v_offer.scope_type='model' and v_asset.model_name<>v_offer.trait_value then raise exception 'Offer does not match model'; end if;
  if v_offer.scope_type='backdrop' and v_asset.backdrop_name<>v_offer.trait_value then raise exception 'Offer does not match backdrop'; end if;
  if v_offer.scope_type='symbol' and v_asset.symbol_name<>v_offer.trait_value then raise exception 'Offer does not match symbol'; end if;

  select gift_fee_bps,treasury_profile_id into v_fee_bps,v_treasury from public.market_settings where singleton=true;
  perform 1 from public.profiles where id in (p_owner_id,v_offer.buyer_profile_id,v_treasury) order by id for update;
  select * into v_buyer from public.profiles where id=v_offer.buyer_profile_id;
  v_reserved:=public.reserved_market_balance_v056(v_offer.buyer_profile_id,null,v_offer.id,null);
  if v_buyer.balance-v_reserved<v_offer.amount then raise exception 'Buyer no longer has enough available balance'; end if;

  v_fee:=case when v_treasury is null or v_treasury in (p_owner_id,v_offer.buyer_profile_id) then 0 else round(v_offer.amount*coalesce(v_fee_bps,0)/10000.0,8) end;
  v_seller_net:=v_offer.amount-v_fee;
  v_realized:=v_seller_net-v_gift.acquired_price;
  update public.profiles set balance=balance-v_offer.amount,updated_at=now() where id=v_offer.buyer_profile_id;
  update public.profiles set balance=balance+v_seller_net,updated_at=now() where id=p_owner_id;
  if v_fee>0 and v_treasury is not null and v_treasury<>p_owner_id and v_treasury<>v_offer.buyer_profile_id then update public.profiles set balance=balance+v_fee,updated_at=now() where id=v_treasury; end if;

  update public.virtual_gifts set owner_profile_id=v_offer.buyer_profile_id,acquired_price=v_offer.amount,last_sale_price=v_offer.amount,
    listing_price=null,status='owned',listing_expires_at=null,listing_updated_at=now(),updated_at=now() where id=v_gift.id;
  update public.gift_offers set status='rejected',updated_at=now() where virtual_gift_id=v_gift.id and status='pending';
  delete from public.market_cart_items where virtual_gift_id=v_gift.id;
  insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl)
    values(v_gift.id,v_gift.asset_id,v_offer.buyer_profile_id,p_owner_id,v_offer.amount,v_realized);
  insert into public.gift_listing_events(virtual_gift_id,asset_id,actor_profile_id,kind,price,previous_price)
    values(v_gift.id,v_gift.asset_id,v_offer.buyer_profile_id,'offer_accepted',v_offer.amount,v_gift.listing_price);
  insert into public.gift_price_observations(asset_id,base_name,source,kind,price_ton,source_ref)
    values(v_asset.id,v_asset.base_name,'mxm','sale',v_offer.amount,'advanced-offer:'||v_offer.id::text);
  perform public.record_gift_collection_candle(v_asset.base_name,v_offer.amount);
  perform public.bump_mission(v_offer.buyer_profile_id,'gift_buy',1);
  perform public.bump_mission(p_owner_id,'gift_sell',1);
  if v_realized>0 then perform public.bump_mission(p_owner_id,'profitable_gift_sale',1); end if;

  update public.advanced_gift_offers_v056
  set filled_count=filled_count+1,
      status=case when filled_count+1>=max_fills then 'filled' else 'active' end,
      updated_at=now()
  where id=v_offer.id;

  perform public.push_notification_v048(v_offer.buyer_profile_id,'offer_resolved','Оффер исполнен',
    format('%s #%s куплен за %s TON',v_asset.base_name,v_asset.gift_number,trim(to_char(v_offer.amount,'FM9999999990.00'))),
    '/gifts/'||v_gift.id::text,jsonb_build_object('advancedOfferId',v_offer.id,'price',v_offer.amount));

  return jsonb_build_object('status','accepted','virtualGiftId',v_gift.id,'price',v_offer.amount,'fee',v_fee,'sellerNet',v_seller_net,'buyerId',v_offer.buyer_profile_id);
end;
$$;
revoke execute on function public.accept_advanced_gift_offer_v056(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_advanced_gift_offer_v056(uuid,uuid,uuid) to service_role;

-- Cart checkout must respect v0.56 reservations as well.
create or replace function public.buy_virtual_gift_cart_v2(p_buyer_id uuid,p_virtual_gift_ids uuid[],p_request_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ids uuid[]; v_cart_key text; v_req public.gift_cart_purchase_requests; v_gift public.virtual_gifts; v_asset public.gift_assets;
  v_buyer public.profiles; v_count integer:=0; v_total numeric:=0; v_reserved numeric:=0; v_realized numeric;
  v_fee_bps integer:=0; v_fee numeric:=0; v_total_fee numeric:=0; v_seller_net numeric; v_treasury uuid; v_results jsonb:='[]'::jsonb; v_result jsonb;
begin
  if p_request_key is null or char_length(p_request_key)<8 or char_length(p_request_key)>120 or p_request_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'Invalid cart request key'; end if;
  if p_virtual_gift_ids is null or cardinality(p_virtual_gift_ids)<1 or cardinality(p_virtual_gift_ids)>20 then raise exception 'Cart must contain between 1 and 20 Gifts'; end if;
  select array_agg(value order by value),count(distinct value)::integer into v_ids,v_count from unnest(p_virtual_gift_ids) as t(value);
  if v_count<>cardinality(p_virtual_gift_ids) then raise exception 'Cart contains duplicate Gifts'; end if;
  v_cart_key:=array_to_string(v_ids,',');

  insert into public.gift_cart_purchase_requests(buyer_profile_id,request_key,cart_key)
  values(p_buyer_id,p_request_key,v_cart_key) on conflict(buyer_profile_id,request_key) do nothing;
  select * into v_req from public.gift_cart_purchase_requests where buyer_profile_id=p_buyer_id and request_key=p_request_key for update;
  if v_req.cart_key<>v_cart_key then raise exception 'Cart request key was already used for another cart'; end if;
  if v_req.response is not null then return v_req.response; end if;

  v_count:=0;
  for v_gift in select * from public.virtual_gifts where id=any(v_ids) order by id for update loop
    v_count:=v_count+1;
    if v_gift.status<>'listed' or v_gift.listing_price is null then raise exception 'One or more Gifts are no longer listed'; end if;
    if v_gift.listing_expires_at is not null and v_gift.listing_expires_at<=now() then raise exception 'One or more Gift listings expired'; end if;
    if v_gift.owner_profile_id=p_buyer_id then raise exception 'Cart contains a Gift you already own'; end if;
    select * into v_asset from public.gift_assets where id=v_gift.asset_id;
    if not found then raise exception 'Gift asset is missing'; end if;
    if v_asset.is_burned then raise exception 'Cart contains a burned Gift'; end if;
    v_total:=v_total+v_gift.listing_price;
  end loop;
  if v_count<>cardinality(v_ids) then raise exception 'One or more Gifts do not exist'; end if;

  select gift_fee_bps,treasury_profile_id into v_fee_bps,v_treasury from public.market_settings where singleton=true;
  -- Lock every balance row after Gift rows, in one deterministic UUID order.
  perform 1 from public.profiles p
  where p.id=p_buyer_id
     or p.id=v_treasury
     or p.id in (select distinct vg.owner_profile_id from public.virtual_gifts vg where vg.id=any(v_ids))
  order by p.id for update;
  select * into v_buyer from public.profiles where id=p_buyer_id;
  if not found then raise exception 'Buyer not found'; end if;

  -- Reserve every other commitment (advanced offers + conditional buys)
  -- while allowing direct offers on the exact cart Gifts to be consumed by
  -- this purchase, matching the single-Gift purchase semantics.
  v_reserved:=public.reserved_market_balance_v056(p_buyer_id,null,null,null);
  select greatest(0,v_reserved-coalesce(sum(go.amount),0)) into v_reserved
  from public.gift_offers go
  where go.buyer_profile_id=p_buyer_id and go.status='pending'
    and (go.expires_at is null or go.expires_at>now())
    and go.virtual_gift_id=any(v_ids);
  if v_buyer.balance-v_reserved<v_total then raise exception 'Insufficient available balance'; end if;

  update public.profiles set balance=balance-v_total where id=p_buyer_id;
  for v_gift in select * from public.virtual_gifts where id=any(v_ids) order by id loop
    select * into v_asset from public.gift_assets where id=v_gift.asset_id;
    v_fee:=case when v_treasury is null or v_treasury in (v_gift.owner_profile_id,p_buyer_id) then 0 else round(v_gift.listing_price*coalesce(v_fee_bps,0)/10000.0,8) end;
    v_seller_net:=v_gift.listing_price-v_fee;
    v_total_fee:=v_total_fee+v_fee;
    v_realized:=v_seller_net-v_gift.acquired_price;

    update public.profiles set balance=balance+v_seller_net where id=v_gift.owner_profile_id;
    if v_fee>0 then update public.profiles set balance=balance+v_fee where id=v_treasury; end if;
    update public.virtual_gifts
      set owner_profile_id=p_buyer_id,acquired_price=v_gift.listing_price,last_sale_price=v_gift.listing_price,
          listing_price=null,status='owned',listing_expires_at=null,listing_updated_at=now()
      where id=v_gift.id;
    update public.gift_offers set status='rejected',updated_at=now() where virtual_gift_id=v_gift.id and status='pending';
    delete from public.market_cart_items where virtual_gift_id=v_gift.id;
    insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl)
      values(v_gift.id,v_gift.asset_id,p_buyer_id,v_gift.owner_profile_id,v_gift.listing_price,v_realized);
    insert into public.gift_listing_events(virtual_gift_id,asset_id,actor_profile_id,kind,price,previous_price)
      values(v_gift.id,v_gift.asset_id,p_buyer_id,'sold',v_gift.listing_price,v_gift.listing_price);
    insert into public.gift_price_observations(asset_id,base_name,source,kind,price_ton,source_ref)
      values(v_asset.id,v_asset.base_name,'mxm','sale',v_gift.listing_price,'cart:'||p_request_key);
    perform public.record_gift_collection_candle(v_asset.base_name,v_gift.listing_price);
    perform public.bump_mission(p_buyer_id,'gift_buy',1);
    perform public.bump_mission(v_gift.owner_profile_id,'gift_sell',1);
    if v_realized>0 then perform public.bump_mission(v_gift.owner_profile_id,'profitable_gift_sale',1); end if;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('virtualGiftId',v_gift.id,'price',v_gift.listing_price,'fee',v_fee,'sellerNet',v_seller_net));
  end loop;

  delete from public.market_cart_items where profile_id=p_buyer_id and virtual_gift_id=any(v_ids);
  v_result:=jsonb_build_object('itemCount',v_count,'total',v_total,'fee',v_total_fee,'items',v_results,'requestKey',p_request_key);
  update public.gift_cart_purchase_requests set response=v_result,completed_at=now() where id=v_req.id;
  return v_result;
end;
$$;


-- ---------------------------------------------------------------------------
-- Conditional coin orders.
-- ---------------------------------------------------------------------------
create or replace function public.create_coin_conditional_order_v056(
  p_profile_id uuid,
  p_coin_id uuid,
  p_kind text,
  p_trigger_price numeric,
  p_input_amount numeric,
  p_request_key text,
  p_duration_days integer default 7
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_coin public.coins;
  v_holding public.holdings;
  v_reserved numeric;
  v_reserved_tokens numeric:=0;
  v_order public.coin_conditional_orders_v056;
  v_days integer;
begin
  if p_kind not in ('limit_buy','limit_sell','take_profit','stop_loss') then raise exception 'Invalid order kind'; end if;
  if p_trigger_price is null or p_trigger_price<=0 then raise exception 'Invalid trigger price'; end if;
  if p_input_amount is null or p_input_amount<=0 then raise exception 'Invalid order amount'; end if;
  if p_request_key is null or char_length(p_request_key)<8 or char_length(p_request_key)>120 or p_request_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'Invalid request key'; end if;
  v_days:=greatest(1,least(coalesce(p_duration_days,7),30));

  -- Idempotent retry wins even if the market state changed after the first
  -- request. A reused key with different parameters remains an error.
  select * into v_order from public.coin_conditional_orders_v056 where profile_id=p_profile_id and request_key=p_request_key;
  if found then
    if v_order.coin_id<>p_coin_id or v_order.kind<>p_kind or v_order.trigger_price<>p_trigger_price or v_order.input_amount<>p_input_amount then raise exception 'Request key already used for another order'; end if;
    return jsonb_build_object('id',v_order.id,'status',v_order.status,'triggerPrice',v_order.trigger_price,'inputAmount',v_order.input_amount,'expiresAt',v_order.expires_at);
  end if;

  -- Keep the same row-lock order as execution: profile -> holding -> coin.
  -- This prevents order creation racing a manual sell from deadlocking.
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_kind<>'limit_buy' then
    select * into v_holding from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id for update;
    if not found or v_holding.quantity<=0 then raise exception 'Insufficient token balance'; end if;
  end if;
  select * into v_coin from public.coins where id=p_coin_id and status='active' for share;
  if not found then raise exception 'Coin is not tradeable'; end if;

  if p_kind='limit_buy' and p_trigger_price>v_coin.current_price then raise exception 'Limit buy trigger must be at or below current price'; end if;
  if p_kind in ('limit_sell','take_profit') and p_trigger_price<v_coin.current_price then raise exception 'Sell/Take Profit trigger must be at or above current price'; end if;
  if p_kind='stop_loss' and p_trigger_price>v_coin.current_price then raise exception 'Stop Loss trigger must be at or below current price'; end if;

  if (select count(*) from public.coin_conditional_orders_v056 where profile_id=p_profile_id and status='active')>=100 then raise exception 'Too many open orders'; end if;
  if p_kind='limit_buy' then
    v_reserved:=public.reserved_market_balance_v056(p_profile_id,null,null,null);
    if v_profile.balance-v_reserved<p_input_amount then raise exception 'Insufficient available balance'; end if;
  else
    select coalesce(sum(input_amount),0) into v_reserved_tokens
    from public.coin_conditional_orders_v056
    where profile_id=p_profile_id and coin_id=p_coin_id and kind in ('limit_sell','take_profit','stop_loss') and status in ('active','executing') and expires_at>now();
    if v_holding.quantity-v_reserved_tokens<p_input_amount then raise exception 'Insufficient unreserved token balance'; end if;
  end if;

  insert into public.coin_conditional_orders_v056(profile_id,coin_id,kind,trigger_price,input_amount,request_key,expires_at)
  values(p_profile_id,p_coin_id,p_kind,p_trigger_price,p_input_amount,p_request_key,now()+make_interval(days=>v_days))
  returning * into v_order;
  return jsonb_build_object('id',v_order.id,'status',v_order.status,'triggerPrice',v_order.trigger_price,'inputAmount',v_order.input_amount,'expiresAt',v_order.expires_at);
end;
$$;
revoke execute on function public.create_coin_conditional_order_v056(uuid,uuid,text,numeric,numeric,text,integer) from public,anon,authenticated;
grant execute on function public.create_coin_conditional_order_v056(uuid,uuid,text,numeric,numeric,text,integer) to service_role;

create or replace function public.cancel_coin_conditional_order_v056(p_profile_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order public.coin_conditional_orders_v056;
begin
  select * into v_order from public.coin_conditional_orders_v056 where id=p_order_id for update;
  if not found or v_order.profile_id<>p_profile_id then raise exception 'Order not found'; end if;
  if v_order.status not in ('active','failed') then return jsonb_build_object('status',v_order.status); end if;
  update public.coin_conditional_orders_v056 set status='cancelled',updated_at=now() where id=p_order_id;
  return jsonb_build_object('status','cancelled');
end;
$$;
revoke execute on function public.cancel_coin_conditional_order_v056(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_coin_conditional_order_v056(uuid,uuid) to service_role;

create or replace function public.process_coin_conditional_orders_v056(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_order public.coin_conditional_orders_v056;
  v_coin public.coins;
  v_result jsonb;
  v_processed integer:=0;
  v_filled integer:=0;
  v_failed integer:=0;
  v_matches boolean;
begin
  update public.coin_conditional_orders_v056 set status='expired',updated_at=now()
    where status='active' and expires_at<=now();

  for v_order in
    select o.* from public.coin_conditional_orders_v056 o
    join public.coins c on c.id=o.coin_id
    where o.status='active' and o.expires_at>now() and c.status='active'
      and (
        (o.kind='limit_buy' and c.current_price<=o.trigger_price)
        or (o.kind in ('limit_sell','take_profit') and c.current_price>=o.trigger_price)
        or (o.kind='stop_loss' and c.current_price<=o.trigger_price)
      )
    order by o.created_at asc
    limit greatest(1,least(coalesce(p_limit,50),200))
    for update of o skip locked
  loop
    v_processed:=v_processed+1;
    begin
      update public.coin_conditional_orders_v056 set status='executing',updated_at=now(),failure_reason=null where id=v_order.id;
      -- Use the same lock order as the AMM trade functions (profile -> holding -> coin)
      -- to avoid deadlocks with a manual sell arriving at the same moment.
      perform 1 from public.profiles where id=v_order.profile_id for update;
      if v_order.kind<>'limit_buy' then
        perform 1 from public.holdings where profile_id=v_order.profile_id and coin_id=v_order.coin_id for update;
      end if;
      select * into v_coin from public.coins where id=v_order.coin_id and status='active' for update;
      if not found then raise exception 'Coin is not tradeable'; end if;
      v_matches := (v_order.kind='limit_buy' and v_coin.current_price<=v_order.trigger_price)
        or (v_order.kind in ('limit_sell','take_profit') and v_coin.current_price>=v_order.trigger_price)
        or (v_order.kind='stop_loss' and v_coin.current_price<=v_order.trigger_price);
      if not v_matches then
        update public.coin_conditional_orders_v056 set status='active',updated_at=now() where id=v_order.id;
        continue;
      end if;
      if v_order.kind='limit_buy' then
        -- Excluding this order frees exactly its own reservation while all
        -- other pending commitments remain protected by buy_coin_v2.
        v_result:=public.execute_coin_trade_v3(v_order.execution_request_id,v_order.profile_id,v_order.coin_id,'buy',v_order.input_amount,false,0);
      else
        v_result:=public.execute_coin_trade_v3(v_order.execution_request_id,v_order.profile_id,v_order.coin_id,'sell',v_order.input_amount,false,0);
      end if;
      update public.coin_conditional_orders_v056 set status='filled',result=v_result,executed_at=now(),updated_at=now() where id=v_order.id;
      v_filled:=v_filled+1;
    exception when others then
      update public.coin_conditional_orders_v056 set status='failed',failure_reason=left(sqlerrm,240),updated_at=now() where id=v_order.id;
      v_failed:=v_failed+1;
    end;
  end loop;
  return jsonb_build_object('processed',v_processed,'filled',v_filled,'failed',v_failed);
end;
$$;
revoke execute on function public.process_coin_conditional_orders_v056(integer) from public,anon,authenticated;
grant execute on function public.process_coin_conditional_orders_v056(integer) to service_role;

-- Manual coin sells may not consume tokens committed to active sell/TP/SL
-- orders. The order processor marks the order being executed as `executing`,
-- so only the current order's own reservation is released inside that tx.
create or replace function public.execute_coin_trade_v3(
  p_request_id uuid,
  p_profile_id uuid,
  p_coin_id uuid,
  p_side text,
  p_amount numeric,
  p_sell_all boolean default false,
  p_min_output numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_existing public.coin_trade_requests;
  v_result jsonb;
  v_quantity numeric:=0;
  v_reserved_tokens numeric:=0;
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

  if p_side='sell' then
    -- Match sell_coin_v2 lock ordering so conditional/manual execution cannot
    -- deadlock by taking holding and profile rows in the opposite order.
    perform 1 from public.profiles where id=p_profile_id for update;
    if not found then raise exception 'Profile not found'; end if;
    select quantity into v_quantity from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id for update;
    if not found then v_quantity:=0; end if;
    select coalesce(sum(input_amount),0) into v_reserved_tokens
    from public.coin_conditional_orders_v056
    where profile_id=p_profile_id and coin_id=p_coin_id and kind in ('limit_sell','take_profit','stop_loss')
      and status='active' and expires_at>now();
    if p_sell_all and v_reserved_tokens>0 then raise exception 'Tokens are reserved by active conditional orders'; end if;
    if not p_sell_all and p_amount>greatest(0,v_quantity-v_reserved_tokens) then raise exception 'Insufficient unreserved token balance'; end if;
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
revoke execute on function public.execute_coin_trade_v3(uuid,uuid,uuid,text,numeric,boolean,numeric) from public,anon,authenticated;
grant execute on function public.execute_coin_trade_v3(uuid,uuid,uuid,text,numeric,boolean,numeric) to service_role;

-- Snapshot RPCs now include advanced Gift offers and conditional buy orders.
create or replace function public.profile_snapshot_v040(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'balance',p.balance,
    'reservedBalance',coalesce(public.reserved_market_balance_v056(p.id,null,null,null),0),
    'coinValue',coalesce(f.coin_value,0),
    'giftValue',coalesce(f.gift_value,0),
    'netWorth',coalesce(f.net_worth,p.balance),
    'realizedPnl',coalesce(f.realized_pnl,0)
  )
  from public.profiles p left join public.profile_financial_overview f on f.id=p.id
  where p.id=p_profile_id;
$$;

create or replace function public.session_profile_snapshot_v040(p_telegram_id bigint)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'id',p.id,'telegram_id',p.telegram_id,'username',p.username,'first_name',p.first_name,'last_name',p.last_name,'photo_url',p.photo_url,
    'balance',p.balance,'xp',p.xp,'last_gift_sync_at',p.last_gift_sync_at,'is_banned',p.is_banned,'banned_until',p.banned_until,'created_at',p.created_at,
    'reserved_balance',coalesce(public.reserved_market_balance_v056(p.id,null,null,null),0),
    'coin_value',coalesce(f.coin_value,0),'gift_value',coalesce(f.gift_value,0),'net_worth',coalesce(f.net_worth,p.balance),'realized_pnl',coalesce(f.realized_pnl,0)
  )
  from public.profiles p left join public.profile_financial_overview f on f.id=p.id
  where p.telegram_id=p_telegram_id;
$$;

-- Basic error inbox used by production health tooling. Server code stores only
-- scrubbed messages/hashes; secrets and request bodies must never be inserted.
create table if not exists public.app_error_inbox_v056 (
  id uuid primary key default gen_random_uuid(),
  error_hash text not null unique,
  route text not null,
  error_name text not null default 'Error',
  message text not null,
  count bigint not null default 1,
  affected_users bigint not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.app_error_inbox_v056 enable row level security;
revoke all on public.app_error_inbox_v056 from public,anon,authenticated;
grant all on public.app_error_inbox_v056 to service_role;

create table if not exists public.app_error_affected_v056 (
  error_hash text not null references public.app_error_inbox_v056(error_hash) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key(error_hash,profile_id)
);
alter table public.app_error_affected_v056 enable row level security;
revoke all on public.app_error_affected_v056 from public,anon,authenticated;
grant all on public.app_error_affected_v056 to service_role;

create or replace function public.record_app_error_v056(p_hash text,p_route text,p_message text,p_profile_id uuid default null,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_hash is null or char_length(p_hash)<16 or char_length(p_hash)>128 then return; end if;
  insert into public.app_error_inbox_v056(error_hash,route,error_name,message,last_profile_id,metadata)
  values(p_hash,left(coalesce(p_route,'unknown'),160),left(coalesce(p_metadata->>'errorName','Error'),120),left(coalesce(p_message,'Unknown error'),500),p_profile_id,coalesce(p_metadata,'{}'::jsonb))
  on conflict(error_hash) do update set count=public.app_error_inbox_v056.count+1,last_seen_at=now(),last_profile_id=excluded.last_profile_id,error_name=excluded.error_name,metadata=excluded.metadata;
  if p_profile_id is not null then
    insert into public.app_error_affected_v056(error_hash,profile_id) values(p_hash,p_profile_id) on conflict do nothing;
    update public.app_error_inbox_v056 set affected_users=(select count(*) from public.app_error_affected_v056 a where a.error_hash=p_hash) where error_hash=p_hash;
  end if;
end;
$$;
revoke execute on function public.record_app_error_v056(text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_app_error_v056(text,text,text,uuid,jsonb) to service_role;

update public.economy_settings set schema_version=56,updated_at=now() where singleton=true;
alter table public.economy_settings alter column schema_version set default 56;


-- Privacy-safe aggregate for public profiles. Never expose balance, portfolio
-- value, cost basis or realized/unrealized PnL through this function.
create or replace function public.public_profile_stats_v056(p_profile_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'giftCount', (select count(*)::int from virtual_gifts vg join gift_assets ga on ga.id = vg.asset_id where vg.owner_profile_id = p_profile_id and coalesce(ga.is_burned, false) = false),
    'giftSales', (select count(*)::int from gift_trades where seller_profile_id = p_profile_id),
    'giftTradeVolume', coalesce((select sum(price) from gift_trades where buyer_profile_id = p_profile_id or seller_profile_id = p_profile_id), 0),
    'coinTradeCount', (select count(*)::int from trades where profile_id = p_profile_id),
    'coinTradeVolume', coalesce((select sum(quote_amount) from trades where profile_id = p_profile_id), 0),
    'createdCoinCount', (select count(*)::int from coins where creator_profile_id = p_profile_id)
  );
$$;
revoke all on function public.public_profile_stats_v056(uuid) from public;
grant execute on function public.public_profile_stats_v056(uuid) to service_role;

create or replace function public.admin_economy_overview_v056()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with ranked_players as (
    select balance, ntile(100) over(order by balance desc) as wealth_bucket
    from profiles
    where coalesce(is_system,false)=false
  ), player_stats as (
    select count(*)::int as player_count,
           coalesce(sum(balance),0) as circulating_balance,
           coalesce(sum(balance) filter(where wealth_bucket=1),0) as richest_one_percent_balance,
           coalesce(avg(balance),0) as average_balance
    from ranked_players
  ), event_stats as (
    select
      coalesce(sum(amount) filter(where created_at >= now()-interval '24 hours' and amount>0),0) as emission_24h,
      coalesce(sum(-amount) filter(where created_at >= now()-interval '24 hours' and amount<0),0) as burned_24h,
      coalesce(sum(amount) filter(where created_at >= now()-interval '24 hours'),0) as net_24h,
      coalesce(sum(amount) filter(where created_at >= now()-interval '7 days' and amount>0),0) as emission_7d,
      coalesce(sum(-amount) filter(where created_at >= now()-interval '7 days' and amount<0),0) as burned_7d,
      coalesce(sum(amount) filter(where created_at >= now()-interval '7 days'),0) as net_7d,
      coalesce(sum(amount) filter(where created_at >= now()-interval '24 hours' and kind='rewarded_ad'),0) as ads_24h,
      coalesce(sum(amount) filter(where created_at >= now()-interval '24 hours' and kind='referral'),0) as referrals_24h,
      coalesce(sum(-amount) filter(where created_at >= now()-interval '24 hours' and kind='coin_trade_fee'),0) as coin_fees_24h
    from economy_events
    where created_at >= now()-interval '7 days'
  )
  select jsonb_build_object(
    'playerCount', p.player_count,
    'circulatingBalance', p.circulating_balance,
    'averageBalance', p.average_balance,
    'richestOnePercentShare', case when p.circulating_balance>0 then (p.richest_one_percent_balance/p.circulating_balance)*100 else 0 end,
    'emission24h', e.emission_24h,
    'burned24h', e.burned_24h,
    'net24h', e.net_24h,
    'emission7d', e.emission_7d,
    'burned7d', e.burned_7d,
    'net7d', e.net_7d,
    'ads24h', e.ads_24h,
    'referrals24h', e.referrals_24h,
    'coinFees24h', e.coin_fees_24h,
    'inflation24h', case when greatest(1,p.circulating_balance-e.net_24h)>0 then (e.net_24h/greatest(1,p.circulating_balance-e.net_24h))*100 else 0 end
  )
  from player_stats p cross join event_stats e;
$$;
revoke all on function public.admin_economy_overview_v056() from public;
grant execute on function public.admin_economy_overview_v056() to service_role;

commit;
