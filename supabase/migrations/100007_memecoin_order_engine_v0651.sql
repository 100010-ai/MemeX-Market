-- MemeX Market v0.65.1
-- Serialize per-coin mutations and run conditional orders inside Supabase.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.execute_coin_trade_v3(
  p_request_id uuid,
  p_profile_id uuid,
  p_coin_id uuid,
  p_side text,
  p_amount numeric,
  p_sell_all boolean default false,
  p_min_output numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.coin_trade_requests;
  v_result jsonb;
begin
  if p_request_id is null then raise exception 'Trade request ID is required'; end if;
  if p_side not in ('buy','sell') then raise exception 'Invalid trade side'; end if;
  if p_min_output is null or p_min_output<0 then raise exception 'Invalid slippage floor'; end if;

  -- Request-key lock protects idempotency. A separate per-coin lock serializes
  -- AMM reserve mutations and lets conditional-order trigger checks remain
  -- valid until execution starts.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_existing
  from public.coin_trade_requests
  where request_id=p_request_id;
  if found then
    if v_existing.profile_id<>p_profile_id
       or v_existing.coin_id<>p_coin_id
       or v_existing.side<>p_side
       or v_existing.input_amount is distinct from p_amount
       or v_existing.sell_all is distinct from p_sell_all
       or v_existing.min_output is distinct from p_min_output then
      raise exception 'Trade request ID was already used for another operation';
    end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mxm:coin:'||p_coin_id::text,0));

  if p_side='buy' then
    if p_sell_all then raise exception 'sell_all is invalid for buy'; end if;
    v_result:=public.buy_coin_v2(p_profile_id,p_coin_id,p_amount,p_min_output);
  elsif p_sell_all then
    v_result:=public.sell_coin_all_v2(p_profile_id,p_coin_id,p_min_output);
  else
    v_result:=public.sell_coin_v2(p_profile_id,p_coin_id,p_amount,p_min_output);
  end if;

  insert into public.coin_trade_requests(request_id,profile_id,coin_id,side,input_amount,sell_all,min_output,result)
  values(p_request_id,p_profile_id,p_coin_id,p_side,p_amount,p_sell_all,p_min_output,v_result);
  return v_result;
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

      -- The same lock is acquired by every execute_coin_trade_v3 call. Once it
      -- is held, the trigger check below cannot become stale before settlement.
      perform pg_advisory_xact_lock(hashtextextended('mxm:coin:'||v_order.coin_id::text,0));

      select * into v_coin
      from public.coins
      where id=v_order.coin_id and status='active';
      if not found then raise exception 'Coin is not tradeable'; end if;

      v_matches:=(v_order.kind='limit_buy' and v_coin.current_price<=v_order.trigger_price)
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

-- Replace this named job idempotently so branch/release replays cannot create
-- duplicate matchers. Ten seconds keeps orders responsive without involving a
-- paid Vercel cron tier or an HTTP round-trip.
do $$
begin
  if exists(select 1 from cron.job where jobname='mxm-coin-orders-v0651') then
    perform cron.unschedule('mxm-coin-orders-v0651');
  end if;
end $$;

select cron.schedule(
  'mxm-coin-orders-v0651',
  '10 seconds',
  $cron$select public.process_coin_conditional_orders_v056(100);$cron$
);
