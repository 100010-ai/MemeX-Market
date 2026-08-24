-- MemeX Market v0.65.0
-- Keep memecoin quotes, execution, reservations, creator locks and fee accounting aligned.

create or replace function public.coin_available_sell_tokens_v201(
  p_profile_id uuid,
  p_coin_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    coalesce((
      select h.quantity
      from public.holdings h
      where h.profile_id=p_profile_id and h.coin_id=p_coin_id
    ),0)
    - public.coin_locked_tokens_v200(p_profile_id,p_coin_id)
    - coalesce((
      select sum(o.input_amount)
      from public.coin_conditional_orders_v056 o
      where o.profile_id=p_profile_id
        and o.coin_id=p_coin_id
        and o.kind in ('limit_sell','take_profit','stop_loss')
        and o.status='active'
        and o.expires_at>now()
    ),0)
  );
$$;

revoke execute on function public.coin_available_sell_tokens_v201(uuid,uuid) from public, anon, authenticated;
grant execute on function public.coin_available_sell_tokens_v201(uuid,uuid) to service_role;

create or replace function public.coin_economy_snapshot_v200(p_profile_id uuid, p_coin_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_coin public.coins;
  v_lock public.creator_token_locks;
  v_locked numeric:=0;
  v_holding numeric:=0;
  v_available numeric:=0;
  v_reserved_sell numeric:=0;
  v_ordinal integer;
  v_creator_bps integer:=0;
  v_total_bps integer:=50;
  v_creator_verified boolean:=false;
begin
  select * into v_coin from public.coins where id=p_coin_id;
  if not found then raise exception 'Coin not found'; end if;

  select * into v_lock
  from public.creator_token_locks
  where coin_id=p_coin_id and profile_id=p_profile_id;
  if found then v_locked:=public.coin_locked_tokens_v200(p_profile_id,p_coin_id); end if;

  select coalesce(quantity,0) into v_holding
  from public.holdings
  where profile_id=p_profile_id and coin_id=p_coin_id;
  if not found then v_holding:=0; end if;

  select coalesce(sum(input_amount),0) into v_reserved_sell
  from public.coin_conditional_orders_v056
  where profile_id=p_profile_id
    and coin_id=p_coin_id
    and kind in ('limit_sell','take_profit','stop_loss')
    and status='active'
    and expires_at>now();

  v_available:=greatest(0,v_holding-v_locked-v_reserved_sell);

  select ordinal into v_ordinal
  from public.coin_early_buyers
  where coin_id=p_coin_id and profile_id=p_profile_id;

  select coin_total_fee_bps into v_total_bps
  from public.economy_settings
  where singleton=true;

  if v_coin.creator_profile_id is not null then
    v_creator_bps:=least(v_total_bps,public.creator_fee_bps_v200(v_coin.creator_profile_id));
  end if;

  select exists(
    select 1
    from public.profile_entitlements
    where profile_id=v_coin.creator_profile_id
      and entitlement_key='creator_verified'
      and (expires_at is null or expires_at>now())
  ) into v_creator_verified;

  return jsonb_build_object(
    'startPrice',v_coin.launch_price,
    'marketOpenPrice',coalesce(v_coin.market_open_price,v_coin.current_price),
    'publicTradeCount',(select count(*)::integer from public.trades t where t.coin_id=p_coin_id and not coalesce(t.is_launch_seed,false)),
    'floorPrice',v_coin.floor_price,
    'floorActive',v_coin.floor_price is not null and v_coin.floor_expires_at>now(),
    'floorExpiresAt',v_coin.floor_expires_at,
    'initialBuy',v_coin.initial_buy_quote,
    'initialTokens',v_coin.initial_buy_tokens,
    'totalFeeBps',v_total_bps,
    'creatorFeeBps',v_creator_bps,
    'platformFeeBps',v_total_bps-v_creator_bps,
    'creatorVerified',v_creator_verified,
    'lockedQuantity',v_locked,
    'reservedSellQuantity',v_reserved_sell,
    'lock',case when v_lock.coin_id is null then null else jsonb_build_object(
      'total',v_lock.total_locked,
      'remaining',v_locked,
      'startsAt',v_lock.starts_at,
      'endsAt',v_lock.ends_at,
      'availableQuantity',v_available
    ) end,
    'availableQuantity',v_available,
    'genesisBadge',case when v_ordinal is null then null else jsonb_build_object('ordinal',v_ordinal,'label','Genesis #'||v_ordinal::text) end
  );
end;
$$;

create or replace function public.buy_coin_v2(
  p_profile_id uuid,
  p_coin_id uuid,
  p_quote_amount numeric,
  p_min_token_out numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_coin public.coins;
  v_settings public.economy_settings;
  v_creator_id uuid;
  v_treasury_id uuid;
  v_quote_net numeric;
  v_k numeric;
  v_new_quote numeric;
  v_new_token numeric;
  v_token_out numeric;
  v_exec_price numeric;
  v_reserved numeric;
  v_fee numeric;
  v_creator_bps integer:=0;
  v_trade_id uuid;
  v_fee_result jsonb;
begin
  if p_quote_amount is null or p_quote_amount < 0.01 then raise exception 'Minimum buy is 0.01 virtual TON'; end if;
  if p_min_token_out is null or p_min_token_out < 0 then raise exception 'Invalid slippage floor'; end if;

  select * into v_settings from public.economy_settings where singleton=true;
  if not found or v_settings.coin_total_fee_bps<0 or v_settings.coin_total_fee_bps>=10000 then
    raise exception 'Coin fee settings are invalid';
  end if;

  select creator_profile_id into v_creator_id
  from public.coins
  where id=p_coin_id and status='active';
  if not found then raise exception 'Coin is not tradeable'; end if;

  select treasury_profile_id into v_treasury_id
  from public.market_settings
  where singleton=true;

  perform 1
  from public.profiles
  where id = any(array_remove(array[p_profile_id,v_creator_id,v_treasury_id]::uuid[],null))
  order by id
  for update;

  select * into v_profile from public.profiles where id=p_profile_id;
  if not found then raise exception 'Profile not found'; end if;

  v_reserved:=public.reserved_market_balance_v056(p_profile_id,null,null,null);
  if v_profile.balance-v_reserved < p_quote_amount then raise exception 'Insufficient available balance'; end if;

  select * into v_coin from public.coins where id=p_coin_id and status='active' for update;
  if not found then raise exception 'Coin is not tradeable'; end if;
  if v_coin.token_reserve<=0 or v_coin.quote_reserve<=0 then raise exception 'Coin reserves are invalid'; end if;

  v_fee:=round(p_quote_amount*v_settings.coin_total_fee_bps/10000.0,8);
  v_quote_net:=p_quote_amount-v_fee;
  if v_quote_net<=0 then raise exception 'Trade too small'; end if;

  v_k:=v_coin.token_reserve*v_coin.quote_reserve;
  v_new_quote:=v_coin.quote_reserve+v_quote_net;
  v_new_token:=v_k/v_new_quote;
  v_token_out:=v_coin.token_reserve-v_new_token;
  if v_token_out<=0 then raise exception 'Trade too small'; end if;
  if p_min_token_out>0 and v_token_out<p_min_token_out then raise exception 'Price moved beyond slippage limit'; end if;
  v_exec_price:=p_quote_amount/v_token_out;

  update public.profiles
  set balance=balance-p_quote_amount,updated_at=now()
  where id=p_profile_id;

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
  where id=p_coin_id
  returning * into v_coin;

  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl)
  values(p_profile_id,p_coin_id,'buy',p_quote_amount,v_token_out,v_exec_price,0)
  returning id into v_trade_id;

  v_creator_bps:=case when v_coin.creator_profile_id is null then 0 else least(v_settings.coin_total_fee_bps,public.creator_fee_bps_v200(v_coin.creator_profile_id)) end;
  v_fee_result:=public.record_coin_fee_split_v200(
    v_trade_id,v_coin.id,p_profile_id,v_coin.creator_profile_id,'buy',p_quote_amount,v_fee,v_creator_bps,v_settings.coin_total_fee_bps
  );

  perform public.record_candle(p_coin_id,v_coin.current_price,p_quote_amount);
  perform public.bump_mission(p_profile_id,'coin_trade',1);

  return jsonb_build_object(
    'side','buy',
    'quoteAmount',p_quote_amount,
    'tokenAmount',v_token_out,
    'executionPrice',v_exec_price,
    'newPrice',v_coin.current_price,
    'tokenReserve',v_coin.token_reserve,
    'quoteReserve',v_coin.quote_reserve,
    'fee',v_fee_result
  );
end;
$$;

create or replace function public.sell_coin_v2(
  p_profile_id uuid,
  p_coin_id uuid,
  p_token_amount numeric,
  p_min_quote_out numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coin public.coins;
  v_holding public.holdings;
  v_settings public.economy_settings;
  v_creator_id uuid;
  v_treasury_id uuid;
  v_k numeric;
  v_new_token numeric;
  v_new_quote numeric;
  v_quote_gross numeric;
  v_quote_out numeric;
  v_exec_price numeric;
  v_cost_reduction numeric;
  v_realized numeric;
  v_sell_amount numeric;
  v_locked numeric:=0;
  v_reserved_tokens numeric:=0;
  v_available numeric:=0;
  v_fee numeric:=0;
  v_creator_bps integer:=0;
  v_trade_id uuid;
  v_fee_result jsonb;
begin
  if p_token_amount is null or p_token_amount<=0 then raise exception 'Invalid sell amount'; end if;
  if p_min_quote_out is null or p_min_quote_out<0 then raise exception 'Invalid slippage floor'; end if;

  select * into v_settings from public.economy_settings where singleton=true;
  if not found or v_settings.coin_total_fee_bps<0 or v_settings.coin_total_fee_bps>=10000 then
    raise exception 'Coin fee settings are invalid';
  end if;

  select creator_profile_id into v_creator_id
  from public.coins
  where id=p_coin_id and status='active';
  if not found then raise exception 'Coin is not tradeable'; end if;

  select treasury_profile_id into v_treasury_id
  from public.market_settings
  where singleton=true;

  perform 1
  from public.profiles
  where id = any(array_remove(array[p_profile_id,v_creator_id,v_treasury_id]::uuid[],null))
  order by id
  for update;

  select * into v_holding
  from public.holdings
  where profile_id=p_profile_id and coin_id=p_coin_id
  for update;
  if not found or v_holding.quantity<=0 then raise exception 'Недостаточно токенов'; end if;

  select * into v_coin from public.coins where id=p_coin_id and status='active' for update;
  if not found then raise exception 'Coin is not tradeable'; end if;
  if v_coin.token_reserve<=0 or v_coin.quote_reserve<=0 then raise exception 'Coin reserves are invalid'; end if;

  v_locked:=public.coin_locked_tokens_v200(p_profile_id,p_coin_id);
  select coalesce(sum(input_amount),0) into v_reserved_tokens
  from public.coin_conditional_orders_v056
  where profile_id=p_profile_id
    and coin_id=p_coin_id
    and kind in ('limit_sell','take_profit','stop_loss')
    and status='active'
    and expires_at>now();
  v_available:=greatest(0,v_holding.quantity-v_locked-v_reserved_tokens);

  v_sell_amount:=p_token_amount;
  if v_sell_amount>v_available then
    if v_sell_amount-v_available<=greatest(0.00000001,v_available*0.000000000001) then
      v_sell_amount:=v_available;
    else
      raise exception 'Insufficient unreserved token balance';
    end if;
  elsif v_available-v_sell_amount<=greatest(0.00000001,v_available*0.000000000001) then
    v_sell_amount:=v_available;
  end if;
  if v_sell_amount<=0 then raise exception 'No unlocked tokens available'; end if;

  v_k:=v_coin.token_reserve*v_coin.quote_reserve;
  v_new_token:=v_coin.token_reserve+v_sell_amount;
  v_new_quote:=v_k/v_new_token;

  if v_coin.floor_price is not null and v_coin.floor_expires_at>now()
     and (v_new_quote/v_new_token)<v_coin.floor_price then
    raise exception 'Trade would move price below active floor';
  end if;

  v_quote_gross:=v_coin.quote_reserve-v_new_quote;
  v_fee:=round(v_quote_gross*v_settings.coin_total_fee_bps/10000.0,8);
  v_quote_out:=v_quote_gross-v_fee;
  if v_quote_out<0.000001 then raise exception 'Trade too small'; end if;
  if p_min_quote_out>0 and v_quote_out<p_min_quote_out then raise exception 'Price moved beyond slippage limit'; end if;

  v_exec_price:=v_quote_out/v_sell_amount;
  v_cost_reduction:=case when v_sell_amount>=v_holding.quantity then v_holding.cost_basis else v_holding.cost_basis*(v_sell_amount/v_holding.quantity) end;
  v_realized:=v_quote_out-v_cost_reduction;

  update public.profiles
  set balance=balance+v_quote_out,updated_at=now()
  where id=p_profile_id;

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
  where id=p_coin_id
  returning * into v_coin;

  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl)
  values(p_profile_id,p_coin_id,'sell',v_quote_out,v_sell_amount,v_exec_price,v_realized)
  returning id into v_trade_id;

  v_creator_bps:=case when v_coin.creator_profile_id is null then 0 else least(v_settings.coin_total_fee_bps,public.creator_fee_bps_v200(v_coin.creator_profile_id)) end;
  v_fee_result:=public.record_coin_fee_split_v200(
    v_trade_id,v_coin.id,p_profile_id,v_coin.creator_profile_id,'sell',v_quote_gross,v_fee,v_creator_bps,v_settings.coin_total_fee_bps
  );

  perform public.record_candle(p_coin_id,v_coin.current_price,v_quote_gross);
  perform public.bump_mission(p_profile_id,'coin_trade',1);
  if v_realized>0 then perform public.bump_mission(p_profile_id,'profitable_trade',1); end if;

  return jsonb_build_object(
    'side','sell',
    'quoteAmount',v_quote_out,
    'tokenAmount',v_sell_amount,
    'executionPrice',v_exec_price,
    'newPrice',v_coin.current_price,
    'realizedPnl',v_realized,
    'tokenReserve',v_coin.token_reserve,
    'quoteReserve',v_coin.quote_reserve,
    'fee',v_fee_result
  );
end;
$$;

create or replace function public.sell_coin_all_v2(
  p_profile_id uuid,
  p_coin_id uuid,
  p_min_quote_out numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity numeric;
begin
  v_quantity:=public.coin_available_sell_tokens_v201(p_profile_id,p_coin_id);
  if v_quantity is null or v_quantity<=0 then raise exception 'Нет доступных токенов для продажи'; end if;
  return public.sell_coin_v2(p_profile_id,p_coin_id,v_quantity,p_min_quote_out);
end;
$$;

create or replace function public.process_coin_conditional_orders_v056(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.coin_conditional_orders_v056;
  v_coin public.coins;
  v_result jsonb;
  v_processed integer:=0;
  v_filled integer:=0;
  v_failed integer:=0;
  v_matches boolean;
  v_min_output numeric:=0;
begin
  update public.coin_conditional_orders_v056
  set status='expired',updated_at=now()
  where status='active' and expires_at<=now();

  for v_order in
    select o.*
    from public.coin_conditional_orders_v056 o
    join public.coins c on c.id=o.coin_id
    where o.status='active'
      and o.expires_at>now()
      and c.status='active'
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
      update public.coin_conditional_orders_v056
      set status='executing',updated_at=now(),failure_reason=null
      where id=v_order.id;

      perform 1 from public.profiles where id=v_order.profile_id for update;
      if v_order.kind<>'limit_buy' then
        perform 1
        from public.holdings
        where profile_id=v_order.profile_id and coin_id=v_order.coin_id
        for update;
      end if;

      select * into v_coin
      from public.coins
      where id=v_order.coin_id and status='active'
      for update;
      if not found then raise exception 'Coin is not tradeable'; end if;

      v_matches := (v_order.kind='limit_buy' and v_coin.current_price<=v_order.trigger_price)
        or (v_order.kind in ('limit_sell','take_profit') and v_coin.current_price>=v_order.trigger_price)
        or (v_order.kind='stop_loss' and v_coin.current_price<=v_order.trigger_price);
      if not v_matches then
        update public.coin_conditional_orders_v056
        set status='active',updated_at=now()
        where id=v_order.id;
        continue;
      end if;

      if v_order.kind='limit_buy' then
        v_min_output:=v_order.input_amount/v_order.trigger_price;
        v_result:=public.execute_coin_trade_v3(
          v_order.execution_request_id,v_order.profile_id,v_order.coin_id,'buy',v_order.input_amount,false,v_min_output
        );
      elsif v_order.kind in ('limit_sell','take_profit') then
        v_min_output:=v_order.input_amount*v_order.trigger_price;
        v_result:=public.execute_coin_trade_v3(
          v_order.execution_request_id,v_order.profile_id,v_order.coin_id,'sell',v_order.input_amount,false,v_min_output
        );
      else
        v_result:=public.execute_coin_trade_v3(
          v_order.execution_request_id,v_order.profile_id,v_order.coin_id,'sell',v_order.input_amount,false,0
        );
      end if;

      update public.coin_conditional_orders_v056
      set status='filled',result=v_result,executed_at=now(),updated_at=now()
      where id=v_order.id;
      v_filled:=v_filled+1;
    exception when others then
      if sqlerrm='Price moved beyond slippage limit' then
        update public.coin_conditional_orders_v056
        set status='active',failure_reason=null,updated_at=now()
        where id=v_order.id;
      else
        update public.coin_conditional_orders_v056
        set status='failed',failure_reason=left(sqlerrm,240),updated_at=now()
        where id=v_order.id;
        v_failed:=v_failed+1;
      end if;
    end;
  end loop;

  return jsonb_build_object('processed',v_processed,'filled',v_filled,'failed',v_failed);
end;
$$;
