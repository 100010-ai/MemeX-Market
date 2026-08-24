-- MemeX Market v0.65.8
-- Keep quote math and trade execution on one database source of truth.

create or replace function public.quote_coin_trade_v202(
  p_profile_id uuid,
  p_coin_id uuid,
  p_side text,
  p_amount numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_coin public.coins;
  v_settings public.economy_settings;
  v_profile public.profiles;
  v_fee numeric:=0;
  v_fee_rate numeric:=0;
  v_k numeric;
  v_new_quote numeric;
  v_new_token numeric;
  v_quote_net numeric;
  v_quote_gross numeric;
  v_output numeric;
  v_exec_price numeric;
  v_projected_price numeric;
  v_price_impact numeric;
  v_reserved numeric:=0;
  v_available numeric:=0;
begin
  if p_profile_id is null or p_coin_id is null then
    raise exception 'Profile and coin are required';
  end if;
  if p_side not in ('buy','sell') then
    raise exception 'Invalid trade side';
  end if;
  if p_amount is null or p_amount<=0 then
    raise exception 'Invalid trade amount';
  end if;

  select * into v_settings
  from public.economy_settings
  where singleton=true;
  if not found or v_settings.coin_total_fee_bps<0 or v_settings.coin_total_fee_bps>=10000 then
    raise exception 'Coin fee settings are invalid';
  end if;

  select * into v_coin
  from public.coins
  where id=p_coin_id and status='active';
  if not found then raise exception 'Coin is not tradeable'; end if;
  if v_coin.token_reserve<=0 or v_coin.quote_reserve<=0 or v_coin.current_price<=0 then
    raise exception 'Coin reserves are invalid';
  end if;

  select * into v_profile
  from public.profiles
  where id=p_profile_id;
  if not found then raise exception 'Profile not found'; end if;

  v_fee_rate:=v_settings.coin_total_fee_bps/10000.0;
  v_k:=v_coin.token_reserve*v_coin.quote_reserve;

  if p_side='buy' then
    if p_amount<0.01 then raise exception 'Minimum buy is 0.01 virtual TON'; end if;

    v_reserved:=public.reserved_market_balance_v056(p_profile_id,null,null,null);
    v_available:=greatest(0,v_profile.balance-v_reserved);
    if v_available<p_amount then raise exception 'Insufficient available balance'; end if;

    v_fee:=round(p_amount*v_settings.coin_total_fee_bps/10000.0,8);
    v_quote_net:=p_amount-v_fee;
    if v_quote_net<=0 then raise exception 'Trade too small'; end if;

    v_new_quote:=v_coin.quote_reserve+v_quote_net;
    v_new_token:=v_k/v_new_quote;
    v_output:=v_coin.token_reserve-v_new_token;
    if v_output<=0 then raise exception 'Trade too small'; end if;

    v_exec_price:=p_amount/v_output;
    v_projected_price:=v_new_quote/v_new_token;
    v_price_impact:=greatest(0,(v_exec_price/v_coin.current_price-1)*100);
  else
    v_available:=public.coin_available_sell_tokens_v201(p_profile_id,p_coin_id);
    if v_available<=0 then raise exception 'No unlocked tokens available'; end if;
    if p_amount>v_available then
      if p_amount-v_available<=greatest(0.00000001,v_available*0.000000000001) then
        p_amount:=v_available;
      else
        raise exception 'Insufficient unreserved token balance';
      end if;
    elsif v_available-p_amount<=greatest(0.00000001,v_available*0.000000000001) then
      p_amount:=v_available;
    end if;

    v_new_token:=v_coin.token_reserve+p_amount;
    v_new_quote:=v_k/v_new_token;
    v_projected_price:=v_new_quote/v_new_token;

    if v_coin.floor_price is not null and v_coin.floor_expires_at>now()
       and v_projected_price<v_coin.floor_price then
      raise exception 'Trade would move price below active floor';
    end if;

    v_quote_gross:=v_coin.quote_reserve-v_new_quote;
    v_fee:=round(v_quote_gross*v_settings.coin_total_fee_bps/10000.0,8);
    v_output:=v_quote_gross-v_fee;
    if v_output<0.000001 then raise exception 'Trade too small'; end if;

    v_exec_price:=v_output/p_amount;
    v_price_impact:=greatest(0,(1-v_exec_price/v_coin.current_price)*100);
  end if;

  return jsonb_build_object(
    'side',p_side,
    'inputAmount',p_amount,
    'outputAmount',v_output,
    'executionPrice',v_exec_price,
    'currentPrice',v_coin.current_price,
    'priceImpact',v_price_impact,
    'feeAmount',v_fee,
    'projectedPrice',v_projected_price
  );
end;
$$;

revoke execute on function public.quote_coin_trade_v202(uuid,uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.quote_coin_trade_v202(uuid,uuid,text,numeric) to service_role;
