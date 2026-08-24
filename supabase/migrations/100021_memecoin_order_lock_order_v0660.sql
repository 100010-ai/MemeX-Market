-- MemeX Market v0.66.0
-- Corrective lock-order hardening for the conditional-order worker.

create or replace function public.process_coin_conditional_orders_v056(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.coin_conditional_orders_v056;
  v_coin public.coins;
  v_creator_id uuid;
  v_treasury_id uuid;
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
      -- Every actual trade serializes by coin first.
      perform pg_advisory_xact_lock(hashtextextended('mxm:coin:'||v_order.coin_id::text,0));

      select creator_profile_id into v_creator_id
      from public.coins
      where id=v_order.coin_id and status='active';
      if not found then raise exception 'Coin is not tradeable'; end if;

      select treasury_profile_id into v_treasury_id
      from public.market_settings
      where singleton=true;

      -- Match buy_coin_v2/sell_coin_v2 exactly: trader, creator and treasury are
      -- locked together in UUID order. Locking only the trader before entering the
      -- trade function can deadlock against a trade on another coin sharing one of
      -- the fee recipients.
      perform 1
      from public.profiles
      where id=any(array_remove(array[v_order.profile_id,v_creator_id,v_treasury_id]::uuid[],null))
      order by id
      for update;

      if not exists(select 1 from public.profiles where id=v_order.profile_id) then
        raise exception 'Profile not found';
      end if;

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

      -- Reservation remains active until every underlying balance row is locked.
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

revoke execute on function public.process_coin_conditional_orders_v056(integer) from public,anon,authenticated;
grant execute on function public.process_coin_conditional_orders_v056(integer) to service_role;
