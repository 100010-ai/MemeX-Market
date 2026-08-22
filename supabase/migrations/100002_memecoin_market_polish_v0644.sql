begin;

-- MemeX Market v0.64.4
-- Treat the creator's launch bootstrap as pool seeding, not public trading history.
-- This removes fake launch volume/change/trade count while keeping AMM reserves,
-- creator holdings, fee accounting and lock semantics intact.

alter table public.trades
  add column if not exists is_launch_seed boolean not null default false;

alter table public.coins
  add column if not exists market_open_price numeric(30,16);

create index if not exists trades_coin_public_created_idx
  on public.trades(coin_id,created_at desc)
  where is_launch_seed=false;

update public.economy_settings set schema_version=greatest(coalesce(schema_version,0),201) where singleton=true;

-- Mark historical v200 launch bootstrap trades conservatively. The row must be
-- the creator's Genesis #1 trade and match the launch amounts recorded on coin.
update public.trades t
set is_launch_seed=true
from public.coins c, public.coin_early_buyers eb
where t.coin_id=c.id
  and eb.coin_id=c.id
  and eb.profile_id=c.creator_profile_id
  and eb.ordinal=1
  and eb.first_trade_id=t.id
  and t.profile_id=c.creator_profile_id
  and coalesce(c.initial_buy_quote,0)>0
  and coalesce(c.initial_buy_tokens,0)>0
  and abs(t.quote_amount-c.initial_buy_quote)<=0.000001
  and abs(t.token_amount-c.initial_buy_tokens)<=greatest(0.000001,c.initial_buy_tokens*0.00000001)
  and t.created_at>=c.created_at-interval '5 seconds'
  and t.created_at<=c.created_at+interval '5 minutes';

-- Reconstruct the actual post-bootstrap opening price. v200 launches started with
-- token reserve = total_supply and quote reserve = total_supply * launch_price.
update public.coins c
set market_open_price=case
  when coalesce(c.initial_buy_tokens,0)>0
    and c.total_supply>c.initial_buy_tokens
    and c.launch_price>0
  then (c.total_supply*c.total_supply*c.launch_price)
       / ((c.total_supply-c.initial_buy_tokens)*(c.total_supply-c.initial_buy_tokens))
  else coalesce(c.launch_price,c.current_price)
end
where c.market_open_price is null or c.market_open_price<=0;

-- Repair the launch-minute candle so the creator bootstrap no longer appears as
-- a giant public candle. Any real trades in the same minute remain represented.
with launch_buckets as (
  select
    c.id as coin_id,
    date_trunc('minute',c.created_at) as bucket_start,
    c.market_open_price,
    count(t.id) filter(where not coalesce(t.is_launch_seed,false))::integer as public_count,
    coalesce(sum(t.quote_amount) filter(where not coalesce(t.is_launch_seed,false)),0) as public_volume,
    min(t.price) filter(where not coalesce(t.is_launch_seed,false)) as public_low,
    max(t.price) filter(where not coalesce(t.is_launch_seed,false)) as public_high
  from public.coins c
  left join public.trades t
    on t.coin_id=c.id
   and t.created_at>=date_trunc('minute',c.created_at)
   and t.created_at<date_trunc('minute',c.created_at)+interval '1 minute'
  where coalesce(c.initial_buy_quote,0)>0
    and c.market_open_price>0
  group by c.id,c.created_at,c.market_open_price
)
update public.candles ca
set
  open=lb.market_open_price,
  high=case when lb.public_count=0 then lb.market_open_price
    else greatest(lb.market_open_price,coalesce(lb.public_high,lb.market_open_price),ca.close) end,
  low=case when lb.public_count=0 then lb.market_open_price
    else least(lb.market_open_price,coalesce(lb.public_low,lb.market_open_price),ca.close) end,
  close=case when lb.public_count=0 then lb.market_open_price else ca.close end,
  volume=lb.public_volume
from launch_buckets lb
where ca.coin_id=lb.coin_id and ca.bucket_start=lb.bucket_start;

insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
select c.id,date_trunc('minute',c.created_at),c.market_open_price,c.market_open_price,c.market_open_price,c.market_open_price,0
from public.coins c
where coalesce(c.initial_buy_quote,0)>0
  and c.market_open_price>0
  and not exists(
    select 1 from public.candles ca
    where ca.coin_id=c.id and ca.bucket_start=date_trunc('minute',c.created_at)
  )
on conflict(coin_id,bucket_start) do nothing;

-- Public market statistics exclude creator launch seeding.
drop view if exists public.market_overview;
create or replace view public.market_overview with (security_invoker=true) as
with trade_stats as (
  select
    coin_id,
    coalesce(sum(quote_amount) filter(where not coalesce(is_launch_seed,false)),0) as all_time_volume,
    coalesce(sum(quote_amount) filter(where not coalesce(is_launch_seed,false) and created_at>=now()-interval '24 hours'),0) as volume_24h,
    coalesce(sum(quote_amount) filter(where not coalesce(is_launch_seed,false) and side='buy' and created_at>=now()-interval '24 hours'),0) as buy_volume_24h,
    coalesce(sum(quote_amount) filter(where not coalesce(is_launch_seed,false) and side='sell' and created_at>=now()-interval '24 hours'),0) as sell_volume_24h,
    count(*) filter(where not coalesce(is_launch_seed,false) and created_at>=now()-interval '24 hours')::bigint as trade_count_24h
  from public.trades
  group by coin_id
), holding_stats as (
  select coin_id,count(*) filter(where quantity>0)::bigint as holder_count
  from public.holdings
  group by coin_id
), candle_stats as (
  select coin_id,max(high) as ath_price
  from public.candles
  group by coin_id
), first_24 as (
  select distinct on (coin_id) coin_id,open
  from public.candles
  where bucket_start>=now()-interval '24 hours'
  order by coin_id,bucket_start asc
)
select
  c.id,c.creator_profile_id,c.name,c.symbol,c.description,c.current_price,c.market_cap,c.status,c.created_at,
  c.total_supply,c.token_reserve,c.quote_reserve,
  coalesce(ts.volume_24h,0) as volume_24h,
  case
    when coalesce(ts.trade_count_24h,0)=0 then 0
    when f.open is null or f.open=0 then 0
    else ((c.current_price/f.open)-1)*100
  end as change_24h,
  coalesce(hs.holder_count,0) as holder_count,
  coalesce(ts.trade_count_24h,0) as trade_count_24h,
  coalesce(nullif(p.username,''),p.first_name) as creator_name,
  c.quote_reserve*2 as liquidity,
  coalesce(ts.all_time_volume,0) as all_time_volume,
  coalesce(cs.ath_price,coalesce(c.market_open_price,c.current_price)) as ath_price,
  coalesce(ts.buy_volume_24h,0) as buy_volume_24h,
  coalesce(ts.sell_volume_24h,0) as sell_volume_24h,
  c.image_url
from public.coins c
left join public.profiles p on p.id=c.creator_profile_id
left join trade_stats ts on ts.coin_id=c.id
left join holding_stats hs on hs.coin_id=c.id
left join candle_stats cs on cs.coin_id=c.id
left join first_24 f on f.coin_id=c.id
where coalesce(c.hidden_from_market,false)=false;

grant select on public.market_overview to service_role;

create or replace function public.create_coin_v200(
  p_request_id uuid,p_profile_id uuid,p_name text,p_symbol text,p_description text,p_image_url text,
  p_initial_buy numeric,p_start_price numeric,p_floor_price numeric
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_existing public.coin_launch_requests;
  v_fingerprint text;
  v_profile public.profiles;
  v_coin public.coins;
  v_settings public.economy_settings;
  v_reserved numeric;
  v_active_count integer;
  v_last_launch timestamptz;
  v_supply numeric:=1000000000;
  v_initial_quote numeric;
  v_initial_token numeric;
  v_k numeric;
  v_new_quote numeric;
  v_new_token numeric;
  v_fee numeric;
  v_creator_bps integer;
  v_trade_id uuid;
  v_fee_result jsonb;
  v_vip jsonb;
  v_result jsonb;
  v_lock_start timestamptz:=clock_timestamp();
begin
  if p_request_id is null then raise exception 'Launch request ID is required'; end if;
  -- The image URL is intentionally excluded: an HTTP retry may re-upload the
  -- same bytes to a new storage path, while the economic request is identical.
  v_fingerprint:=md5(concat_ws('|',p_profile_id::text,trim(p_name),upper(trim(p_symbol)),coalesce(trim(p_description),''),
    p_initial_buy::text,p_start_price::text,p_floor_price::text));
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_existing from public.coin_launch_requests where request_id=p_request_id;
  if found then
    if v_existing.profile_id<>p_profile_id or v_existing.fingerprint<>v_fingerprint then
      raise exception 'Launch request ID was already used';
    end if;
    return v_existing.result||jsonb_build_object('alreadyCreated',true);
  end if;
  select * into v_settings from public.economy_settings where singleton=true;
  if not found or v_settings.schema_version<200 then raise exception 'Market Economy 2.0 is not ready'; end if;
  if p_initial_buy is null or p_initial_buy<v_settings.coin_initial_buy_min or p_initial_buy>v_settings.coin_initial_buy_max then
    raise exception 'Initial buy is outside allowed bounds';
  end if;
  if p_start_price is null or p_start_price<v_settings.coin_start_price_min or p_start_price>v_settings.coin_start_price_max then
    raise exception 'Start price is outside allowed bounds';
  end if;
  if p_floor_price is null or p_floor_price<0 or p_floor_price>p_start_price*v_settings.coin_floor_max_bps/10000.0 then
    raise exception 'Floor price is outside allowed bounds';
  end if;
  if char_length(trim(p_name))<2 or char_length(trim(p_name))>32 then raise exception 'Invalid coin name'; end if;
  if upper(trim(p_symbol)) !~ '^[A-Z0-9]{2,8}$' then raise exception 'Invalid coin symbol'; end if;
  if char_length(coalesce(p_description,''))>180 then raise exception 'Coin description is too long'; end if;

  perform public.refresh_profile_energy_v200(p_profile_id);
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_banned and (v_profile.banned_until is null or v_profile.banned_until>now()) then raise exception 'Account is blocked'; end if;
  select count(*)::integer,max(created_at) into v_active_count,v_last_launch
  from public.coins where creator_profile_id=p_profile_id and status='active';
  if v_active_count>=v_settings.coin_max_active then raise exception 'Active coin limit reached'; end if;
  if v_last_launch is not null and v_last_launch>now()-make_interval(hours=>v_settings.coin_launch_cooldown_hours) then
    raise exception 'Coin launch is on cooldown';
  end if;
  v_reserved:=public.reserved_market_balance_v056(p_profile_id,null,null,null);
  if v_profile.balance-v_reserved<v_settings.coin_launch_fee+p_initial_buy then
    raise exception 'Insufficient available virtual TON for launch and initial buy';
  end if;
  if v_profile.energy<v_settings.coin_launch_energy_cost then
    raise exception 'Insufficient Energy for coin launch';
  end if;

  v_initial_quote:=v_supply*p_start_price;
  insert into public.coins(creator_profile_id,name,symbol,description,image_url,total_supply,token_reserve,quote_reserve,
    current_price,market_cap,status,hidden_from_market,launch_price,floor_price,floor_expires_at,initial_buy_quote)
  values(p_profile_id,trim(p_name),upper(trim(p_symbol)),left(coalesce(trim(p_description),''),180),
    nullif(trim(coalesce(p_image_url,'')),''),v_supply,v_supply,v_initial_quote,p_start_price,p_start_price*v_supply,
    'active',false,p_start_price,nullif(p_floor_price,0),v_lock_start+make_interval(days=>v_settings.creator_lock_days),p_initial_buy)
  returning * into v_coin;

  update public.profiles set balance=balance-v_settings.coin_launch_fee-p_initial_buy,
    energy=energy-v_settings.coin_launch_energy_cost,energy_updated_at=now(),updated_at=now() where id=p_profile_id;
  v_creator_bps:=least(v_settings.coin_total_fee_bps,public.creator_fee_bps_v200(p_profile_id));
  v_fee:=round(p_initial_buy*v_settings.coin_total_fee_bps/10000.0,8);
  v_k:=v_coin.token_reserve*v_coin.quote_reserve;
  v_new_quote:=v_coin.quote_reserve+p_initial_buy-v_fee;
  v_new_token:=v_k/v_new_quote;
  v_initial_token:=v_coin.token_reserve-v_new_token;
  if v_initial_token<=0 then raise exception 'Initial buy is too small'; end if;
  insert into public.holdings(profile_id,coin_id,quantity,cost_basis)
  values(p_profile_id,v_coin.id,v_initial_token,p_initial_buy);
  update public.coins set token_reserve=v_new_token,quote_reserve=v_new_quote,
    current_price=v_new_quote/v_new_token,market_cap=(v_new_quote/v_new_token)*total_supply,
    initial_buy_tokens=v_initial_token,market_open_price=v_new_quote/v_new_token,updated_at=now()
    where id=v_coin.id returning * into v_coin;
  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl,is_launch_seed)
  values(p_profile_id,v_coin.id,'buy',p_initial_buy,v_initial_token,p_initial_buy/v_initial_token,0,true) returning id into v_trade_id;
  insert into public.coin_early_buyers(coin_id,profile_id,ordinal,first_trade_id)
  values(v_coin.id,p_profile_id,1,v_trade_id);
  insert into public.creator_token_locks(coin_id,profile_id,total_locked,starts_at,ends_at)
  values(v_coin.id,p_profile_id,v_initial_token*v_settings.creator_lock_bps/10000.0,
    v_lock_start,v_lock_start+make_interval(days=>v_settings.creator_lock_days));
  v_fee_result:=public.record_coin_fee_split_v200(v_trade_id,v_coin.id,p_profile_id,p_profile_id,'buy',
    p_initial_buy,v_fee,v_creator_bps,v_settings.coin_total_fee_bps);
  -- The creator bootstrap is liquidity seeding, not public market history.
  -- Start a flat zero-volume candle at the actual post-seed market opening price.
  insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
  values(v_coin.id,date_trunc('minute',now()),v_coin.current_price,v_coin.current_price,
    v_coin.current_price,v_coin.current_price,0)
  on conflict(coin_id,bucket_start) do update set open=excluded.open,high=excluded.high,
    low=excluded.low,close=excluded.close,volume=0;
  insert into public.market_events(actor_profile_id,kind,coin_id) values(p_profile_id,'launch',v_coin.id);
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'coin_launch',-v_settings.coin_launch_fee,v_coin.id,
    jsonb_build_object('symbol',v_coin.symbol,'unit','virtual_ton','initialBuy',p_initial_buy,'startPrice',p_start_price,'floorPrice',p_floor_price));
  perform public.bump_mission(p_profile_id,'create_coin',1);
  v_vip:=public.credit_vip_activity_v200(p_profile_id,'coin_launch',
    v_settings.coin_launch_fee+p_initial_buy,v_coin.id);

  v_result:=jsonb_build_object('id',v_coin.id,'name',v_coin.name,'symbol',v_coin.symbol,'imageUrl',v_coin.image_url,
    'launchFee',v_settings.coin_launch_fee,'initialBuy',p_initial_buy,'initialTokens',v_initial_token,
    'energyCost',v_settings.coin_launch_energy_cost,
    'startPrice',p_start_price,'floorPrice',nullif(p_floor_price,0),'lockTokens',v_initial_token*v_settings.creator_lock_bps/10000.0,
    'lockEndsAt',v_lock_start+make_interval(days=>v_settings.creator_lock_days),'genesisOrdinal',1,'fee',v_fee_result,'vip',v_vip,
    'alreadyCreated',false,'status',v_coin.status);
  insert into public.coin_launch_requests(request_id,profile_id,fingerprint,coin_id,result)
  values(p_request_id,p_profile_id,v_fingerprint,v_coin.id,v_result);
  return v_result;
exception when unique_violation then
  raise exception 'This coin symbol already exists';
end;
$$;

-- Compatibility callers also enter the same bounded v2.00 launch path.
create or replace function public.create_coin_with_image(
  p_profile_id uuid,p_name text,p_symbol text,p_description text,p_image_url text
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.create_coin_v200(gen_random_uuid(),p_profile_id,p_name,p_symbol,p_description,p_image_url,1,0.0000001,0);
end;
$$;

create or replace function public.coin_economy_snapshot_v200(p_profile_id uuid,p_coin_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_coin public.coins;
  v_lock public.creator_token_locks;
  v_locked numeric:=0;
  v_holding numeric:=0;
  v_ordinal integer;
  v_creator_bps integer:=0;
  v_total_bps integer:=50;
  v_creator_verified boolean:=false;
begin
  select * into v_coin from public.coins where id=p_coin_id;
  if not found then raise exception 'Coin not found'; end if;
  select * into v_lock from public.creator_token_locks where coin_id=p_coin_id and profile_id=p_profile_id;
  if found then v_locked:=public.coin_locked_tokens_v200(p_profile_id,p_coin_id); end if;
  select coalesce(quantity,0) into v_holding from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id;
  if not found then v_holding:=0; end if;
  select ordinal into v_ordinal from public.coin_early_buyers where coin_id=p_coin_id and profile_id=p_profile_id;
  select coin_total_fee_bps into v_total_bps from public.economy_settings where singleton=true;
  if v_coin.creator_profile_id is not null then v_creator_bps:=least(v_total_bps,public.creator_fee_bps_v200(v_coin.creator_profile_id)); end if;
  select exists(select 1 from public.profile_entitlements where profile_id=v_coin.creator_profile_id
    and entitlement_key='creator_verified' and (expires_at is null or expires_at>now())) into v_creator_verified;
  return jsonb_build_object(
    'startPrice',v_coin.launch_price,'marketOpenPrice',coalesce(v_coin.market_open_price,v_coin.current_price),
    'publicTradeCount',(select count(*)::integer from public.trades t where t.coin_id=p_coin_id and not coalesce(t.is_launch_seed,false)),
    'floorPrice',v_coin.floor_price,
    'floorActive',v_coin.floor_price is not null and v_coin.floor_expires_at>now(),
    'floorExpiresAt',v_coin.floor_expires_at,'initialBuy',v_coin.initial_buy_quote,
    'initialTokens',v_coin.initial_buy_tokens,'totalFeeBps',v_total_bps,
    'creatorFeeBps',v_creator_bps,'platformFeeBps',v_total_bps-v_creator_bps,
    'creatorVerified',v_creator_verified,
    'lock',case when v_lock.coin_id is null then null else jsonb_build_object(
      'total',v_lock.total_locked,'remaining',v_locked,'startsAt',v_lock.starts_at,'endsAt',v_lock.ends_at,
      'availableQuantity',greatest(0,v_holding-v_locked)) end,
    'availableQuantity',greatest(0,v_holding-v_locked),
    'genesisBadge',case when v_ordinal is null then null else jsonb_build_object('ordinal',v_ordinal,'label','Genesis #'||v_ordinal::text) end
  );
end;
$$;


-- Downstream progression/profile/creator statistics must use the same public-trade semantics.
create or replace function public.creator_level_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_coins integer:=0;
  v_holders integer:=0;
  v_volume numeric:=0;
  v_level text;
  v_creator_bps integer;
  v_next_volume numeric;
begin
  select count(*)::integer into v_coins from public.coins where creator_profile_id=p_profile_id;
  select count(distinct h.profile_id)::integer into v_holders
  from public.holdings h join public.coins c on c.id=h.coin_id
  where c.creator_profile_id=p_profile_id and h.quantity>0;
  select coalesce(sum(t.quote_amount),0) into v_volume
  from public.trades t join public.coins c on c.id=t.coin_id where c.creator_profile_id=p_profile_id and not coalesce(t.is_launch_seed,false);

  if v_volume>=1000000 or v_holders>=500 then
    v_level:='Diamond'; v_creator_bps:=25; v_next_volume:=null;
  elsif v_volume>=100000 or v_holders>=100 then
    v_level:='Gold'; v_creator_bps:=20; v_next_volume:=1000000;
  elsif v_volume>=10000 or v_holders>=25 then
    v_level:='Silver'; v_creator_bps:=15; v_next_volume:=100000;
  else
    v_level:='Bronze'; v_creator_bps:=10; v_next_volume:=10000;
  end if;
  return jsonb_build_object('name',v_level,'creatorFeeBps',v_creator_bps,'coinCount',v_coins,
    'holderCount',v_holders,'volume',v_volume,'nextVolume',v_next_volume);
end;
$$;

create or replace function public.creator_dashboard_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare v_level jsonb; v_total_bps integer:=50; v_verified boolean:=false; v_analytics boolean:=false;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  v_level:=public.creator_level_v200(p_profile_id);
  select coin_total_fee_bps into v_total_bps from public.economy_settings where singleton=true;
  select exists(select 1 from public.profile_entitlements where profile_id=p_profile_id and entitlement_key='creator_verified'
      and (expires_at is null or expires_at>now())),
    exists(select 1 from public.profile_entitlements where profile_id=p_profile_id and entitlement_key='creator_analytics'
      and (expires_at is null or expires_at>now())) into v_verified,v_analytics;
  return jsonb_build_object(
    'verified',v_verified,'analyticsUnlocked',v_analytics,
    'level',v_level||jsonb_build_object('platformFeeBps',v_total_bps-(v_level->>'creatorFeeBps')::integer,
      'verified',v_verified,'trustLabel',case when v_verified then 'Проверенный автор' else 'Автор сообщества' end),
    'totals',jsonb_build_object(
      'coins',coalesce((v_level->>'coinCount')::integer,0),
      'holders',coalesce((v_level->>'holderCount')::integer,0),
      'volume',coalesce((v_level->>'volume')::numeric,0),
      'creatorFees',coalesce((select sum(creator_fee) from public.coin_fee_ledger where creator_profile_id=p_profile_id),0)
    ),
    'entitlements',coalesce((select jsonb_agg(jsonb_build_object('key',entitlement_key,'expiresAt',expires_at) order by entitlement_key)
      from public.profile_entitlements where profile_id=p_profile_id and entitlement_key like 'creator_%'
        and (expires_at is null or expires_at>now())),'[]'::jsonb),
    'coins',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'symbol',c.symbol,'imageUrl',c.image_url,'status',c.status,
      'currentPrice',c.current_price,'marketCap',c.market_cap,'floorPrice',c.floor_price,
      'floorActive',c.floor_price is not null and c.floor_expires_at>now(),
      'holders',(select count(*) from public.holdings h where h.coin_id=c.id and h.quantity>0),
      'volume',(select coalesce(sum(t.quote_amount),0) from public.trades t where t.coin_id=c.id and not coalesce(t.is_launch_seed,false)),
      'creatorFees',(select coalesce(sum(f.creator_fee),0) from public.coin_fee_ledger f where f.coin_id=c.id),
      'uniqueBuyers',case when v_analytics then (select count(distinct t.profile_id) from public.trades t where t.coin_id=c.id and t.side='buy' and not coalesce(t.is_launch_seed,false)) else null end,
      'buyerRetentionPct',case when v_analytics then coalesce((select round(100.0*count(distinct h.profile_id)/nullif(count(distinct t.profile_id),0),2)
        from public.trades t left join public.holdings h on h.coin_id=t.coin_id and h.profile_id=t.profile_id and h.quantity>0
        where t.coin_id=c.id and t.side='buy' and not coalesce(t.is_launch_seed,false)),0) else null end,
      'buySellRatio',case when v_analytics then coalesce((select round(sum(quote_amount) filter(where side='buy')/
        nullif(sum(quote_amount) filter(where side='sell'),0),3) from public.trades where coin_id=c.id and not coalesce(is_launch_seed,false)),0) else null end,
      'boostedUntil',(select max(b.ends_at) from public.coin_boosts b where b.coin_id=c.id and b.ends_at>now()),
      'createdAt',c.created_at
    ) order by c.created_at desc) from public.coins c where c.creator_profile_id=p_profile_id),'[]'::jsonb)
  );
end;
$$;

create or replace function public.refresh_achievements_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_created timestamptz;
  v_coin_trades integer:=0; v_gift_trades integer:=0; v_sales integer:=0;
  v_volume numeric:=0; v_gifts integer:=0; v_coins integer:=0; v_cases integer:=0; v_legendaries integer:=0;
  v_collections integer:=0; v_streak integer:=0; v_season integer:=0; v_level integer:=1;
  v_row public.achievements;
  v_value numeric:=0;
  v_inserted integer:=0;
  v_unlocked integer:=0;
begin
  select created_at into v_created from public.profiles where id=p_profile_id;
  if v_created is null then raise exception 'Profile not found'; end if;
  select count(*)::integer,coalesce(sum(quote_amount),0) into v_coin_trades,v_volume from public.trades where profile_id=p_profile_id and not coalesce(is_launch_seed,false);
  select count(*)::integer into v_gift_trades from public.gift_trades where buyer_profile_id=p_profile_id or seller_profile_id=p_profile_id;
  select count(*)::integer into v_sales from public.gift_trades where seller_profile_id=p_profile_id;
  select v_sales + coalesce((select count(*) from public.trades where profile_id=p_profile_id and side='sell' and not coalesce(is_launch_seed,false)),0)::integer into v_sales;
  select v_volume + coalesce(sum(price),0) into v_volume from public.gift_trades where buyer_profile_id=p_profile_id or seller_profile_id=p_profile_id;
  select count(*)::integer into v_gifts from public.virtual_gifts where owner_profile_id=p_profile_id;
  select count(*)::integer into v_coins from public.coins where creator_profile_id=p_profile_id;
  select count(*)::integer,count(*) filter(where rarity='legendary')::integer into v_cases,v_legendaries from public.case_openings where profile_id=p_profile_id;
  select count(distinct lower(trim(base_name)))::integer into v_collections from public.collection_milestone_claims where profile_id=p_profile_id and milestone=100;
  select coalesce(best_streak,0) into v_streak from public.daily_streak_state where profile_id=p_profile_id;
  v_streak:=coalesce(v_streak,0);
  select count(*)::integer into v_season from public.season_claims where profile_id=p_profile_id;
  select public.account_level_v064(xp) into v_level from public.profiles where id=p_profile_id;

  for v_row in select * from public.achievements where active=true and metric_key is not null order by sort_order,key loop
    v_value:=case v_row.metric_key
      when 'trades' then v_coin_trades+v_gift_trades
      when 'sales' then v_sales
      when 'volume' then v_volume
      when 'gifts_owned' then v_gifts
      when 'coins_created' then v_coins
      when 'cases_opened' then v_cases
      when 'legendary_drops' then v_legendaries
      when 'collections_completed' then v_collections
      when 'streak_best' then v_streak
      when 'season_claims' then v_season
      when 'account_level' then v_level
      when 'early_user' then case when v_created<'2026-09-01'::timestamptz then 1 else 0 end
      else 0 end;
    if v_value>=v_row.target then
      insert into public.user_achievements(profile_id,achievement_key,metadata)
      values(p_profile_id,v_row.key,jsonb_build_object('metric',v_row.metric_key,'value',v_value,'target',v_row.target))
      on conflict(profile_id,achievement_key) do nothing;
      get diagnostics v_inserted=row_count;
      if v_inserted=1 then
        v_unlocked:=v_unlocked+1;
        if v_row.xp_reward>0 then perform public.award_profile_xp(p_profile_id,'achievement:'||v_row.key,v_row.xp_reward); end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('newlyUnlocked',v_unlocked,'metrics',jsonb_build_object(
    'trades',v_coin_trades+v_gift_trades,'sales',v_sales,'volume',v_volume,'giftsOwned',v_gifts,'coinsCreated',v_coins,
    'casesOpened',v_cases,'legendaryDrops',v_legendaries,'collectionsCompleted',v_collections,'streakBest',v_streak,
    'seasonClaims',v_season,'accountLevel',v_level));
end;
$$;

create or replace view public.profile_financial_overview with (security_invoker=true) as
with holding_value as (
  select
    h.profile_id,
    coalesce(sum(h.quantity * c.current_price), 0)::numeric as coin_value
  from public.holdings h
  join public.coins c on c.id = h.coin_id
  where h.quantity > 0
  group by h.profile_id
),
gift_value as (
  select
    vg.owner_profile_id as profile_id,
    coalesce(sum(
      coalesce(
        case
          when ga.telegram_resale_price_ton is not null
            and ga.telegram_resale_price_ton > 0
            and (ga.resale_seen_at is null or ga.resale_seen_at >= now() - interval '24 hours')
          then ga.telegram_resale_price_ton
        end,
        vg.last_sale_price,
        vg.acquired_price,
        0
      )
    ), 0)::numeric as gift_value
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id = vg.asset_id
  where coalesce(ga.is_burned, false) = false
  group by vg.owner_profile_id
),
coin_stats as (
  select
    t.profile_id,
    coalesce(sum(t.realized_pnl), 0)::numeric as coin_realized_pnl,
    count(*)::bigint as coin_trade_count
  from public.trades t
  where not coalesce(t.is_launch_seed,false)
  group by t.profile_id
),
gift_sell_stats as (
  select
    gt.seller_profile_id as profile_id,
    coalesce(sum(gt.realized_pnl), 0)::numeric as gift_realized_pnl
  from public.gift_trades gt
  where gt.seller_profile_id is not null
  group by gt.seller_profile_id
),
gift_trade_people as (
  select gt.buyer_profile_id as profile_id
  from public.gift_trades gt
  union all
  select gt.seller_profile_id as profile_id
  from public.gift_trades gt
  where gt.seller_profile_id is not null
),
gift_trade_stats as (
  select profile_id, count(*)::bigint as gift_trade_count
  from gift_trade_people
  group by profile_id
),
gift_counts as (
  select
    vg.owner_profile_id as profile_id,
    count(*)::bigint as gift_count
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id = vg.asset_id
  where coalesce(ga.is_burned, false) = false
  group by vg.owner_profile_id
),
creator_caps as (
  select
    c.creator_profile_id as profile_id,
    coalesce(sum(c.market_cap), 0)::numeric as created_coin_market_cap
  from public.coins c
  where c.creator_profile_id is not null
    and c.status = 'active'
  group by c.creator_profile_id
)
select
  p.id,
  p.telegram_id,
  p.username,
  p.first_name,
  p.photo_url,
  p.balance,
  coalesce(h.coin_value, 0)::numeric as coin_value,
  coalesce(g.gift_value, 0)::numeric as gift_value,
  (p.balance + coalesce(h.coin_value, 0) + coalesce(g.gift_value, 0))::numeric as net_worth,
  coalesce(cs.coin_realized_pnl, 0)::numeric as coin_realized_pnl,
  coalesce(gs.gift_realized_pnl, 0)::numeric as gift_realized_pnl,
  (coalesce(cs.coin_realized_pnl, 0) + coalesce(gs.gift_realized_pnl, 0))::numeric as realized_pnl,
  coalesce(cs.coin_trade_count, 0)::bigint as coin_trade_count,
  coalesce(gt.gift_trade_count, 0)::bigint as gift_trade_count,
  coalesce(gc.gift_count, 0)::bigint as gift_count,
  coalesce(cc.created_coin_market_cap, 0)::numeric as created_coin_market_cap
from public.profiles p
left join holding_value h on h.profile_id = p.id
left join gift_value g on g.profile_id = p.id
left join coin_stats cs on cs.profile_id = p.id
left join gift_sell_stats gs on gs.profile_id = p.id
left join gift_trade_stats gt on gt.profile_id = p.id
left join gift_counts gc on gc.profile_id = p.id
left join creator_caps cc on cc.profile_id = p.id;

grant select on public.profile_financial_overview to service_role;

-- Keep critical market RPCs private to the trusted server role.
revoke execute on function public.create_coin_v200(uuid,uuid,text,text,text,text,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.create_coin_v200(uuid,uuid,text,text,text,text,numeric,numeric,numeric) to service_role;
revoke execute on function public.coin_economy_snapshot_v200(uuid,uuid) from public,anon,authenticated;
grant execute on function public.coin_economy_snapshot_v200(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
