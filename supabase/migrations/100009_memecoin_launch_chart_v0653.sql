-- MemeX Market v0.65.3
-- Harden launch concurrency/error attribution and expose bounded multi-timeframe candles.

create or replace function public.coin_candles_v201(
  p_coin_id uuid,
  p_bucket_seconds integer default 60,
  p_limit integer default 480
)
returns table(
  bucket_start timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer:=greatest(1,least(coalesce(p_limit,480),720));
  v_stride interval;
  v_from timestamptz;
begin
  if p_bucket_seconds not in (60,300,900,3600,14400,86400) then
    raise exception 'Unsupported candle timeframe';
  end if;
  if not exists(select 1 from public.coins where id=p_coin_id) then
    raise exception 'Coin not found';
  end if;

  v_stride:=make_interval(secs=>p_bucket_seconds);
  v_from:=now()-(v_stride*v_limit);

  return query
  with bucketed as (
    select
      date_bin(v_stride,c.bucket_start,'1970-01-01 00:00:00+00'::timestamptz) as bucket,
      c.bucket_start as source_time,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume
    from public.candles c
    where c.coin_id=p_coin_id
      and c.bucket_start>=v_from
  ), grouped as (
    select
      b.bucket,
      (array_agg(b.open order by b.source_time asc))[1] as o,
      max(b.high) as h,
      min(b.low) as l,
      (array_agg(b.close order by b.source_time desc))[1] as c,
      coalesce(sum(b.volume),0) as v
    from bucketed b
    group by b.bucket
  )
  select g.bucket,g.o,g.h,g.l,g.c,g.v
  from grouped g
  order by g.bucket asc;
end;
$$;

revoke execute on function public.coin_candles_v201(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.coin_candles_v201(uuid,integer,integer) to service_role;

create or replace function public.create_coin_v200(
  p_request_id uuid,
  p_profile_id uuid,
  p_name text,
  p_symbol text,
  p_description text,
  p_image_url text,
  p_initial_buy numeric,
  p_start_price numeric,
  p_floor_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_treasury uuid;
  v_constraint text;
  v_lock_start timestamptz:=clock_timestamp();
begin
  if p_request_id is null then raise exception 'Launch request ID is required'; end if;

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

  select treasury_profile_id into v_treasury from public.market_settings where singleton=true;
  perform 1
  from public.profiles
  where id=any(array_remove(array[p_profile_id,v_treasury]::uuid[],null))
  order by id
  for update;

  perform public.refresh_profile_energy_v200(p_profile_id);
  select * into v_profile from public.profiles where id=p_profile_id;
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
  insert into public.coins(
    creator_profile_id,name,symbol,description,image_url,total_supply,token_reserve,quote_reserve,
    current_price,market_cap,status,hidden_from_market,launch_price,floor_price,floor_expires_at,initial_buy_quote
  ) values(
    p_profile_id,trim(p_name),upper(trim(p_symbol)),left(coalesce(trim(p_description),''),180),
    nullif(trim(coalesce(p_image_url,'')),''),v_supply,v_supply,v_initial_quote,p_start_price,p_start_price*v_supply,
    'active',false,p_start_price,nullif(p_floor_price,0),v_lock_start+make_interval(days=>v_settings.creator_lock_days),p_initial_buy
  ) returning * into v_coin;

  update public.profiles
  set balance=balance-v_settings.coin_launch_fee-p_initial_buy,
      energy=energy-v_settings.coin_launch_energy_cost,
      energy_updated_at=now(),
      updated_at=now()
  where id=p_profile_id;

  v_creator_bps:=least(v_settings.coin_total_fee_bps,public.creator_fee_bps_v200(p_profile_id));
  v_fee:=round(p_initial_buy*v_settings.coin_total_fee_bps/10000.0,8);
  v_k:=v_coin.token_reserve*v_coin.quote_reserve;
  v_new_quote:=v_coin.quote_reserve+p_initial_buy-v_fee;
  v_new_token:=v_k/v_new_quote;
  v_initial_token:=v_coin.token_reserve-v_new_token;
  if v_initial_token<=0 then raise exception 'Initial buy is too small'; end if;

  insert into public.holdings(profile_id,coin_id,quantity,cost_basis)
  values(p_profile_id,v_coin.id,v_initial_token,p_initial_buy);

  update public.coins set
    token_reserve=v_new_token,
    quote_reserve=v_new_quote,
    current_price=v_new_quote/v_new_token,
    market_cap=(v_new_quote/v_new_token)*total_supply,
    initial_buy_tokens=v_initial_token,
    market_open_price=v_new_quote/v_new_token,
    updated_at=now()
  where id=v_coin.id
  returning * into v_coin;

  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl,is_launch_seed)
  values(p_profile_id,v_coin.id,'buy',p_initial_buy,v_initial_token,p_initial_buy/v_initial_token,0,true)
  returning id into v_trade_id;

  insert into public.coin_early_buyers(coin_id,profile_id,ordinal,first_trade_id)
  values(v_coin.id,p_profile_id,1,v_trade_id);

  insert into public.creator_token_locks(coin_id,profile_id,total_locked,starts_at,ends_at)
  values(v_coin.id,p_profile_id,v_initial_token*v_settings.creator_lock_bps/10000.0,
    v_lock_start,v_lock_start+make_interval(days=>v_settings.creator_lock_days));

  v_fee_result:=public.record_coin_fee_split_v200(
    v_trade_id,v_coin.id,p_profile_id,p_profile_id,'buy',p_initial_buy,v_fee,v_creator_bps,v_settings.coin_total_fee_bps
  );

  insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
  values(v_coin.id,date_trunc('minute',now()),v_coin.current_price,v_coin.current_price,v_coin.current_price,v_coin.current_price,0)
  on conflict(coin_id,bucket_start) do update set
    open=excluded.open,
    high=excluded.high,
    low=excluded.low,
    close=excluded.close,
    volume=0;

  insert into public.market_events(actor_profile_id,kind,coin_id)
  values(p_profile_id,'launch',v_coin.id);

  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'coin_launch',-v_settings.coin_launch_fee,v_coin.id,
    jsonb_build_object('symbol',v_coin.symbol,'unit','virtual_ton','initialBuy',p_initial_buy,'startPrice',p_start_price,'floorPrice',p_floor_price));

  perform public.bump_mission(p_profile_id,'create_coin',1);
  v_vip:=public.credit_vip_activity_v200(p_profile_id,'coin_launch',v_settings.coin_launch_fee+p_initial_buy,v_coin.id);

  v_result:=jsonb_build_object(
    'id',v_coin.id,
    'name',v_coin.name,
    'symbol',v_coin.symbol,
    'imageUrl',v_coin.image_url,
    'launchFee',v_settings.coin_launch_fee,
    'initialBuy',p_initial_buy,
    'initialTokens',v_initial_token,
    'energyCost',v_settings.coin_launch_energy_cost,
    'startPrice',p_start_price,
    'floorPrice',nullif(p_floor_price,0),
    'lockTokens',v_initial_token*v_settings.creator_lock_bps/10000.0,
    'lockEndsAt',v_lock_start+make_interval(days=>v_settings.creator_lock_days),
    'genesisOrdinal',1,
    'fee',v_fee_result,
    'vip',v_vip,
    'alreadyCreated',false,
    'status',v_coin.status
  );

  insert into public.coin_launch_requests(request_id,profile_id,fingerprint,coin_id,result)
  values(p_request_id,p_profile_id,v_fingerprint,v_coin.id,v_result);
  return v_result;
exception when unique_violation then
  get stacked diagnostics v_constraint=constraint_name;
  if v_constraint='coins_symbol_key' then
    raise exception 'This coin symbol already exists';
  end if;
  raise;
end;
$$;
