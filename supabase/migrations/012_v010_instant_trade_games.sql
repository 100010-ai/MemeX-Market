begin;

-- MXM v0.10 — instant trading UX, hardened coin launches, games and market visibility.

-- Compatibility guards for databases that skipped one of the optional UI/admin migrations.
alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.coins add column if not exists image_url text;
alter table public.coins add column if not exists hidden_from_market boolean not null default false;
alter table public.missions add column if not exists updated_at timestamptz not null default now();

update public.coins set hidden_from_market=false where hidden_from_market is null;

-- Rebuild the coin market view with AMM reserves so the client can render an
-- immediate quote without an extra HTTP request. Server RPCs remain authoritative.
drop view if exists public.market_overview;
create or replace view public.market_overview with (security_invoker=true) as
with trade_stats as (
  select
    coin_id,
    coalesce(sum(quote_amount),0) as all_time_volume,
    coalesce(sum(quote_amount) filter (where created_at>=now()-interval '24 hours'),0) as volume_24h,
    coalesce(sum(quote_amount) filter (where side='buy' and created_at>=now()-interval '24 hours'),0) as buy_volume_24h,
    coalesce(sum(quote_amount) filter (where side='sell' and created_at>=now()-interval '24 hours'),0) as sell_volume_24h,
    count(*) filter (where created_at>=now()-interval '24 hours')::bigint as trade_count_24h
  from public.trades
  group by coin_id
), holding_stats as (
  select coin_id,count(*) filter (where quantity>0)::bigint as holder_count
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
  case when f.open is null or f.open=0 then 0 else ((c.current_price/f.open)-1)*100 end as change_24h,
  coalesce(hs.holder_count,0) as holder_count,
  coalesce(ts.trade_count_24h,0) as trade_count_24h,
  coalesce(nullif(p.username,''),p.first_name) as creator_name,
  c.quote_reserve * 2 as liquidity,
  coalesce(ts.all_time_volume,0) as all_time_volume,
  coalesce(cs.ath_price,c.current_price) as ath_price,
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

-- Harden normal user coin launches. God Mode keeps using admin_create_coin and
-- is intentionally exempt from these public economy rules.
create or replace function public.create_coin_with_image(
  p_profile_id uuid,p_name text,p_symbol text,p_description text,p_image_url text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_coin public.coins;
  v_launch_fee numeric := 250;
  v_reserved numeric;
  v_active_count integer;
  v_last_launch timestamptz;
begin
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_banned and (v_profile.banned_until is null or v_profile.banned_until>now()) then raise exception 'Account is banned'; end if;

  select count(*)::integer,max(created_at) into v_active_count,v_last_launch
  from public.coins
  where creator_profile_id=p_profile_id and status='active';
  if v_active_count>=3 then raise exception 'Максимум 3 активных мемкоина на одного создателя'; end if;
  if v_last_launch is not null and v_last_launch>now()-interval '12 hours' then
    raise exception 'Новый мемкоин можно запускать раз в 12 часов';
  end if;

  v_reserved := public.pending_gift_offer_total(p_profile_id,null);
  if v_profile.balance-v_reserved<v_launch_fee then raise exception 'Для запуска нужно 250 виртуальных TON'; end if;
  if char_length(trim(p_name))<2 or char_length(trim(p_name))>32 then raise exception 'Invalid coin name'; end if;
  if upper(trim(p_symbol)) !~ '^[A-Z0-9]{2,8}$' then raise exception 'Invalid ticker'; end if;
  if char_length(coalesce(p_description,''))>180 then raise exception 'Description is too long'; end if;

  update public.profiles set balance=balance-v_launch_fee,updated_at=now() where id=p_profile_id;
  insert into public.coins(creator_profile_id,name,symbol,description,image_url,status,hidden_from_market)
  values(p_profile_id,trim(p_name),upper(trim(p_symbol)),left(coalesce(trim(p_description),''),180),nullif(trim(coalesce(p_image_url,'')),''),'active',false)
  returning * into v_coin;

  insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
  values(v_coin.id,date_trunc('minute',now()),v_coin.current_price,v_coin.current_price,v_coin.current_price,v_coin.current_price,0);
  insert into public.market_events(actor_profile_id,kind,coin_id) values(p_profile_id,'launch',v_coin.id);
  perform public.bump_mission(p_profile_id,'create_coin',1);

  return jsonb_build_object(
    'id',v_coin.id,'name',v_coin.name,'symbol',v_coin.symbol,'imageUrl',v_coin.image_url,
    'launchFee',v_launch_fee,'status',v_coin.status
  );
exception when unique_violation then raise exception 'Ticker already exists';
end;
$$;
revoke execute on function public.create_coin_with_image(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_coin_with_image(uuid,text,text,text,text) to service_role;

-- Keep the legacy no-image RPC consistent with the same fee/limits.
create or replace function public.create_coin(p_profile_id uuid,p_name text,p_symbol text,p_description text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.create_coin_with_image(p_profile_id,p_name,p_symbol,p_description,null);
end;
$$;
revoke execute on function public.create_coin(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_coin(uuid,text,text,text) to service_role;

-- Robust sell implementation: tiny numeric/JS rounding differences no longer
-- reject MAX sells. The exact-all RPC never sends a rounded token amount.
create or replace function public.sell_coin(p_profile_id uuid,p_coin_id uuid,p_token_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_coin public.coins; v_holding public.holdings; v_fee_rate numeric := 0.005;
  v_k numeric; v_new_token numeric; v_new_quote numeric; v_quote_gross numeric;
  v_quote_out numeric; v_exec_price numeric; v_cost_reduction numeric; v_realized numeric;
  v_sell_amount numeric;
begin
  if p_token_amount is null or p_token_amount<=0 then raise exception 'Invalid sell amount'; end if;
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

  v_k := v_coin.token_reserve*v_coin.quote_reserve;
  v_new_token := v_coin.token_reserve+v_sell_amount;
  v_new_quote := v_k/v_new_token;
  v_quote_gross := v_coin.quote_reserve-v_new_quote;
  v_quote_out := v_quote_gross*(1-v_fee_rate);
  if v_quote_out<0.000001 then raise exception 'Trade too small'; end if;
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
    token_reserve=v_new_token,quote_reserve=v_new_quote,current_price=v_new_quote/v_new_token,
    market_cap=(v_new_quote/v_new_token)*total_supply,updated_at=now()
  where id=p_coin_id returning * into v_coin;

  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl)
  values(p_profile_id,p_coin_id,'sell',v_quote_out,v_sell_amount,v_exec_price,v_realized);
  perform public.record_candle(p_coin_id,v_coin.current_price,v_quote_out);
  perform public.bump_mission(p_profile_id,'coin_trade',1);
  if v_realized>0 then perform public.bump_mission(p_profile_id,'profitable_trade',1); end if;

  return jsonb_build_object('side','sell','quoteAmount',v_quote_out,'tokenAmount',v_sell_amount,'executionPrice',v_exec_price,'newPrice',v_coin.current_price,'realizedPnl',v_realized);
end;
$$;
revoke execute on function public.sell_coin(uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.sell_coin(uuid,uuid,numeric) to service_role;

create or replace function public.sell_coin_all(p_profile_id uuid,p_coin_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_quantity numeric;
begin
  -- Keep the same lock order as sell_coin (profile -> holding) to avoid a
  -- deadlock when MAX and a regular sell arrive at the same time.
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select quantity into v_quantity from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id for update;
  if v_quantity is null or v_quantity<=0 then raise exception 'Недостаточно токенов'; end if;
  return public.sell_coin(p_profile_id,p_coin_id,v_quantity);
end;
$$;
revoke execute on function public.sell_coin_all(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sell_coin_all(uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Virtual-only games. No deposit, withdrawal or redemption exists in MXM.
-- ---------------------------------------------------------------------------
create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game text not null check (game in ('coinflip','dice','wheel')),
  bet numeric(24,8) not null check (bet>0),
  choice text,
  outcome jsonb not null,
  multiplier numeric(12,4) not null check (multiplier>=0),
  payout numeric(24,8) not null check (payout>=0),
  balance_after numeric(24,8) not null check (balance_after>=0),
  created_at timestamptz not null default now()
);
create index if not exists game_rounds_profile_created_idx on public.game_rounds(profile_id,created_at desc);
alter table public.game_rounds enable row level security;
revoke all on public.game_rounds from anon,authenticated;
grant select,insert on public.game_rounds to service_role;

create or replace function public.play_virtual_game(p_profile_id uuid,p_game text,p_bet numeric,p_choice text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_reserved numeric;
  v_bytes bytea;
  v_u32 numeric;
  v_roll numeric;
  v_multiplier numeric := 0;
  v_result text;
  v_number integer;
  v_payout numeric;
  v_balance numeric;
  v_round_id uuid;
begin
  if p_game is null or p_game not in ('coinflip','dice','wheel') then raise exception 'Неизвестная игра'; end if;
  if p_bet is null or p_bet<0.1 or p_bet>100 then raise exception 'Ставка должна быть от 0.1 до 100 виртуальных TON'; end if;

  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_banned and (v_profile.banned_until is null or v_profile.banned_until>now()) then raise exception 'Account is banned'; end if;
  v_reserved := public.pending_gift_offer_total(p_profile_id,null);
  if v_profile.balance-v_reserved<p_bet then raise exception 'Недостаточно доступного виртуального TON'; end if;

  v_bytes := gen_random_bytes(4);
  v_u32 := get_byte(v_bytes,0)::numeric*16777216 + get_byte(v_bytes,1)::numeric*65536 + get_byte(v_bytes,2)::numeric*256 + get_byte(v_bytes,3)::numeric;
  v_roll := v_u32/4294967296::numeric;

  if p_game='coinflip' then
    if p_choice is null or p_choice not in ('heads','tails') then raise exception 'Выбери сторону монеты'; end if;
    v_result := case when v_roll<0.5 then 'heads' else 'tails' end;
    v_multiplier := case when v_result=p_choice then 1.92 else 0 end;
  elsif p_game='dice' then
    if p_choice is null or p_choice not in ('low','high') then raise exception 'Выбери диапазон'; end if;
    v_number := floor(v_roll*100)::integer+1;
    v_result := v_number::text;
    if (p_choice='low' and v_number<=49) or (p_choice='high' and v_number>=52) then v_multiplier:=1.96; else v_multiplier:=0; end if;
  else
    if v_roll<0.50 then v_multiplier:=0;
    elsif v_roll<0.75 then v_multiplier:=1.20;
    elsif v_roll<0.90 then v_multiplier:=1.80;
    elsif v_roll<0.98 then v_multiplier:=3.00;
    else v_multiplier:=8.00;
    end if;
    v_result := trim(to_char(v_multiplier,'FM999990.00'))||'x';
  end if;

  v_payout := round(p_bet*v_multiplier,8);
  update public.profiles set balance=balance-p_bet+v_payout,updated_at=now() where id=p_profile_id returning balance into v_balance;

  insert into public.game_rounds(profile_id,game,bet,choice,outcome,multiplier,payout,balance_after)
  values(p_profile_id,p_game,p_bet,p_choice,jsonb_build_object('result',v_result,'number',v_number),v_multiplier,v_payout,v_balance)
  returning id into v_round_id;

  perform public.bump_mission(p_profile_id,'game_play',1);
  return jsonb_build_object('id',v_round_id,'game',p_game,'bet',p_bet,'choice',p_choice,'result',v_result,'number',v_number,'multiplier',v_multiplier,'payout',v_payout,'balance',v_balance,'won',v_multiplier>0);
end;
$$;
revoke execute on function public.play_virtual_game(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.play_virtual_game(uuid,text,numeric,text) to service_role;

insert into public.missions(key,period,title,description,reward,target,action_type,sort_order,active)
values('daily_game_3','daily','Игровая разминка','Сыграй 3 раунда в Игровом хабе.',4,3,'game_play',75,true)
on conflict(key) do update set title=excluded.title,description=excluded.description,reward=excluded.reward,target=excluded.target,action_type=excluded.action_type,sort_order=excluded.sort_order,active=true,updated_at=now();

commit;
