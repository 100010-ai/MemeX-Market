-- MemeX Market v0.65.9
-- Make conditional-order reservation and execution transitions race-safe.

create or replace function public.create_coin_conditional_order_v056(
  p_profile_id uuid,
  p_coin_id uuid,
  p_kind text,
  p_trigger_price numeric,
  p_input_amount numeric,
  p_request_key text,
  p_duration_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_coin public.coins;
  v_holding public.holdings;
  v_reserved numeric:=0;
  v_reserved_tokens numeric:=0;
  v_locked_tokens numeric:=0;
  v_order public.coin_conditional_orders_v056;
  v_max_open integer:=20;
  v_max_days integer:=30;
begin
  if p_kind not in ('limit_buy','limit_sell','take_profit','stop_loss') then raise exception 'Invalid order kind'; end if;
  if p_trigger_price is null or p_trigger_price<=0 then raise exception 'Invalid trigger price'; end if;
  if p_input_amount is null or p_input_amount<=0 then raise exception 'Invalid order amount'; end if;
  if p_request_key is null or char_length(p_request_key)<8 or char_length(p_request_key)>120 or p_request_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'Invalid request key'; end if;

  select
    case when coalesce(remote_config->>'coinOrderMaxOpen','') ~ '^[0-9]+$'
      then greatest(1,least((remote_config->>'coinOrderMaxOpen')::integer,100)) else 20 end,
    case when coalesce(remote_config->>'coinOrderMaxDays','') ~ '^[0-9]+$'
      then greatest(1,least((remote_config->>'coinOrderMaxDays')::integer,30)) else 30 end
  into v_max_open,v_max_days
  from public.runtime_config_v056
  where singleton=true;

  if p_duration_days is null or p_duration_days<1 or p_duration_days>v_max_days then
    raise exception 'Invalid order duration';
  end if;

  -- Same logical request must serialize before the idempotency lookup. Without
  -- this lock two concurrent retries can both miss the row and one later dies
  -- on the unique(profile_id, request_key) constraint.
  perform pg_advisory_xact_lock(hashtextextended(
    'mxm:coin-order-request:'||p_profile_id::text||':'||p_request_key,0
  ));

  select * into v_order
  from public.coin_conditional_orders_v056
  where profile_id=p_profile_id and request_key=p_request_key;
  if found then
    if v_order.coin_id<>p_coin_id
      or v_order.kind<>p_kind
      or v_order.trigger_price<>p_trigger_price
      or v_order.input_amount<>p_input_amount then
      raise exception 'Request key already used for another order';
    end if;
    return jsonb_build_object(
      'id',v_order.id,'status',v_order.status,'triggerPrice',v_order.trigger_price,
      'inputAmount',v_order.input_amount,'expiresAt',v_order.expires_at
    );
  end if;

  -- Profile row is the reservation mutex for both TON and token orders. It also
  -- serializes the runtime max-open check for concurrent different request keys.
  select * into v_profile
  from public.profiles
  where id=p_profile_id
  for update;
  if not found then raise exception 'Profile not found'; end if;

  if (select count(*) from public.coin_conditional_orders_v056 where profile_id=p_profile_id and status='active')>=v_max_open then
    raise exception 'Too many open orders';
  end if;

  if p_kind<>'limit_buy' then
    select * into v_holding
    from public.holdings
    where profile_id=p_profile_id and coin_id=p_coin_id
    for update;
    if not found or v_holding.quantity<=0 then raise exception 'Insufficient token balance'; end if;
  end if;

  select * into v_coin
  from public.coins
  where id=p_coin_id and status='active'
  for share;
  if not found then raise exception 'Coin is not tradeable'; end if;

  if p_kind='limit_buy' and p_trigger_price>v_coin.current_price then raise exception 'Limit buy trigger must be at or below current price'; end if;
  if p_kind in ('limit_sell','take_profit') and p_trigger_price<v_coin.current_price then raise exception 'Sell/Take Profit trigger must be at or above current price'; end if;
  if p_kind='stop_loss' and p_trigger_price>v_coin.current_price then raise exception 'Stop Loss trigger must be at or below current price'; end if;

  if p_kind='limit_buy' then
    v_reserved:=public.reserved_market_balance_v056(p_profile_id,null,null,null);
    if v_profile.balance-v_reserved<p_input_amount then raise exception 'Insufficient available balance'; end if;
  else
    v_locked_tokens:=public.coin_locked_tokens_v200(p_profile_id,p_coin_id);
    select coalesce(sum(input_amount),0)
    into v_reserved_tokens
    from public.coin_conditional_orders_v056
    where profile_id=p_profile_id
      and coin_id=p_coin_id
      and kind in ('limit_sell','take_profit','stop_loss')
      and status in ('active','executing')
      and expires_at>now();

    if v_holding.quantity-v_locked_tokens-v_reserved_tokens<p_input_amount then
      raise exception 'Insufficient unreserved token balance';
    end if;
  end if;

  insert into public.coin_conditional_orders_v056(
    profile_id,coin_id,kind,trigger_price,input_amount,request_key,expires_at
  ) values(
    p_profile_id,p_coin_id,p_kind,p_trigger_price,p_input_amount,p_request_key,
    now()+make_interval(days=>p_duration_days)
  )
  returning * into v_order;

  return jsonb_build_object(
    'id',v_order.id,'status',v_order.status,'triggerPrice',v_order.trigger_price,
    'inputAmount',v_order.input_amount,'expiresAt',v_order.expires_at
  );
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
      -- All actual coin trades take this advisory lock first. Take it before
      -- profile/holding locks too, so the worker cannot deadlock with a manual trade.
      perform pg_advisory_xact_lock(hashtextextended('mxm:coin:'||v_order.coin_id::text,0));

      -- Do not release the active reservation until the underlying balance row is
      -- locked. Otherwise a concurrent create-order request can reserve the same
      -- funds/tokens while this row temporarily says executing.
      perform 1 from public.profiles where id=v_order.profile_id for update;
      if not found then raise exception 'Profile not found'; end if;

      if v_order.kind<>'limit_buy' then
        perform 1
        from public.holdings
        where profile_id=v_order.profile_id and coin_id=v_order.coin_id
        for update;
        if not found then raise exception 'Insufficient token balance'; end if;
      end if;

      select * into v_coin
      from public.coins
      where id=v_order.coin_id and status='active';
      if not found then raise exception 'Coin is not tradeable'; end if;

      v_matches:=(v_order.kind='limit_buy' and v_coin.current_price<=v_order.trigger_price)
        or (v_order.kind in ('limit_sell','take_profit') and v_coin.current_price>=v_order.trigger_price)
        or (v_order.kind='stop_loss' and v_coin.current_price<=v_order.trigger_price);
      if not v_matches then
        continue;
      end if;

      update public.coin_conditional_orders_v056
      set status='executing',updated_at=now(),failure_reason=null
      where id=v_order.id;

      if v_order.kind='limit_buy' then
        v_min_output:=v_order.input_amount/v_order.trigger_price;
        v_result:=public.execute_coin_trade_v3(
          v_order.execution_request_id,v_order.profile_id,v_order.coin_id,
          'buy',v_order.input_amount,false,v_min_output
        );
      elsif v_order.kind in ('limit_sell','take_profit') then
        v_min_output:=v_order.input_amount*v_order.trigger_price;
        v_result:=public.execute_coin_trade_v3(
          v_order.execution_request_id,v_order.profile_id,v_order.coin_id,
          'sell',v_order.input_amount,false,v_min_output
        );
      else
        v_result:=public.execute_coin_trade_v3(
          v_order.execution_request_id,v_order.profile_id,v_order.coin_id,
          'sell',v_order.input_amount,false,0
        );
      end if;

      update public.coin_conditional_orders_v056
      set status='filled',result=v_result,executed_at=now(),updated_at=now()
      where id=v_order.id;
      v_filled:=v_filled+1;
    exception when others then
      if sqlerrm='Price moved beyond slippage limit'
         or sqlerrm='Trade would move price below active floor' then
        -- These are transient market-state failures. Keep the order active so a
        -- later price/floor state can satisfy it instead of killing it forever.
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

revoke execute on function public.create_coin_conditional_order_v056(uuid,uuid,text,numeric,numeric,text,integer) from public,anon,authenticated;
grant execute on function public.create_coin_conditional_order_v056(uuid,uuid,text,numeric,numeric,text,integer) to service_role;
revoke execute on function public.process_coin_conditional_orders_v056(integer) from public,anon,authenticated;
grant execute on function public.process_coin_conditional_orders_v056(integer) to service_role;
