-- MemeX Market v0.65.2
-- Use gross trade notional consistently for market and creator analytics.

create or replace view public.coin_trade_accounting_v201
with (security_invoker=true)
as
select
  t.id,
  t.profile_id,
  t.coin_id,
  t.side,
  t.quote_amount,
  t.token_amount,
  t.price,
  t.created_at,
  t.realized_pnl,
  t.is_launch_seed,
  coalesce(f.fee_base,t.quote_amount) as gross_quote_amount,
  coalesce(f.total_fee,0) as fee_amount
from public.trades t
left join public.coin_fee_ledger f on f.trade_id=t.id;

revoke all on public.coin_trade_accounting_v201 from public, anon, authenticated;
grant select on public.coin_trade_accounting_v201 to service_role;

create or replace view public.market_overview
with (security_invoker=true)
as
with trade_stats as (
  select
    t.coin_id,
    coalesce(sum(t.gross_quote_amount) filter(where not coalesce(t.is_launch_seed,false)),0) as all_time_volume,
    coalesce(sum(t.gross_quote_amount) filter(where not coalesce(t.is_launch_seed,false) and t.created_at>=now()-interval '24 hours'),0) as volume_24h,
    coalesce(sum(t.gross_quote_amount) filter(where not coalesce(t.is_launch_seed,false) and t.side='buy' and t.created_at>=now()-interval '24 hours'),0) as buy_volume_24h,
    coalesce(sum(t.gross_quote_amount) filter(where not coalesce(t.is_launch_seed,false) and t.side='sell' and t.created_at>=now()-interval '24 hours'),0) as sell_volume_24h,
    count(*) filter(where not coalesce(t.is_launch_seed,false) and t.created_at>=now()-interval '24 hours') as trade_count_24h
  from public.coin_trade_accounting_v201 t
  group by t.coin_id
), holding_stats as (
  select h.coin_id,count(*) filter(where h.quantity>0) as holder_count
  from public.holdings h
  group by h.coin_id
), candle_stats as (
  select ca.coin_id,max(ca.high) as ath_price
  from public.candles ca
  group by ca.coin_id
), first_24 as (
  select distinct on (ca.coin_id) ca.coin_id,ca.open
  from public.candles ca
  where ca.bucket_start>=now()-interval '24 hours'
  order by ca.coin_id,ca.bucket_start
)
select
  c.id,
  c.creator_profile_id,
  c.name,
  c.symbol,
  c.description,
  c.current_price,
  c.market_cap,
  c.status,
  c.created_at,
  c.total_supply,
  c.token_reserve,
  c.quote_reserve,
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

create or replace function public.creator_level_v200(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_coins integer:=0;
  v_holders integer:=0;
  v_volume numeric:=0;
  v_level text;
  v_creator_bps integer;
  v_next_volume numeric;
begin
  select count(*)::integer into v_coins
  from public.coins
  where creator_profile_id=p_profile_id;

  select count(distinct h.profile_id)::integer into v_holders
  from public.holdings h
  join public.coins c on c.id=h.coin_id
  where c.creator_profile_id=p_profile_id and h.quantity>0;

  select coalesce(sum(t.gross_quote_amount),0) into v_volume
  from public.coin_trade_accounting_v201 t
  join public.coins c on c.id=t.coin_id
  where c.creator_profile_id=p_profile_id
    and not coalesce(t.is_launch_seed,false);

  if v_volume>=1000000 or v_holders>=500 then
    v_level:='Diamond'; v_creator_bps:=25; v_next_volume:=null;
  elsif v_volume>=100000 or v_holders>=100 then
    v_level:='Gold'; v_creator_bps:=20; v_next_volume:=1000000;
  elsif v_volume>=10000 or v_holders>=25 then
    v_level:='Silver'; v_creator_bps:=15; v_next_volume:=100000;
  else
    v_level:='Bronze'; v_creator_bps:=10; v_next_volume:=10000;
  end if;

  return jsonb_build_object(
    'name',v_level,
    'creatorFeeBps',v_creator_bps,
    'coinCount',v_coins,
    'holderCount',v_holders,
    'volume',v_volume,
    'nextVolume',v_next_volume
  );
end;
$$;

create or replace function public.creator_dashboard_v200(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_level jsonb;
  v_total_bps integer:=50;
  v_verified boolean:=false;
  v_analytics boolean:=false;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  v_level:=public.creator_level_v200(p_profile_id);
  select coin_total_fee_bps into v_total_bps from public.economy_settings where singleton=true;
  select
    exists(select 1 from public.profile_entitlements where profile_id=p_profile_id and entitlement_key='creator_verified' and (expires_at is null or expires_at>now())),
    exists(select 1 from public.profile_entitlements where profile_id=p_profile_id and entitlement_key='creator_analytics' and (expires_at is null or expires_at>now()))
  into v_verified,v_analytics;

  return jsonb_build_object(
    'verified',v_verified,
    'analyticsUnlocked',v_analytics,
    'level',v_level||jsonb_build_object(
      'platformFeeBps',v_total_bps-(v_level->>'creatorFeeBps')::integer,
      'verified',v_verified,
      'trustLabel',case when v_verified then 'Проверенный автор' else 'Автор сообщества' end
    ),
    'totals',jsonb_build_object(
      'coins',coalesce((v_level->>'coinCount')::integer,0),
      'holders',coalesce((v_level->>'holderCount')::integer,0),
      'volume',coalesce((v_level->>'volume')::numeric,0),
      'creatorFees',coalesce((select sum(creator_fee) from public.coin_fee_ledger where creator_profile_id=p_profile_id),0)
    ),
    'entitlements',coalesce((
      select jsonb_agg(jsonb_build_object('key',entitlement_key,'expiresAt',expires_at) order by entitlement_key)
      from public.profile_entitlements
      where profile_id=p_profile_id
        and entitlement_key like 'creator_%'
        and (expires_at is null or expires_at>now())
    ),'[]'::jsonb),
    'coins',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,
        'name',c.name,
        'symbol',c.symbol,
        'imageUrl',c.image_url,
        'status',c.status,
        'currentPrice',c.current_price,
        'marketCap',c.market_cap,
        'floorPrice',c.floor_price,
        'floorActive',c.floor_price is not null and c.floor_expires_at>now(),
        'holders',(select count(*) from public.holdings h where h.coin_id=c.id and h.quantity>0),
        'volume',(select coalesce(sum(t.gross_quote_amount),0) from public.coin_trade_accounting_v201 t where t.coin_id=c.id and not coalesce(t.is_launch_seed,false)),
        'creatorFees',(select coalesce(sum(f.creator_fee),0) from public.coin_fee_ledger f where f.coin_id=c.id),
        'uniqueBuyers',case when v_analytics then (select count(distinct t.profile_id) from public.trades t where t.coin_id=c.id and t.side='buy' and not coalesce(t.is_launch_seed,false)) else null end,
        'buyerRetentionPct',case when v_analytics then coalesce((
          select round(100.0*count(distinct h.profile_id)/nullif(count(distinct t.profile_id),0),2)
          from public.trades t
          left join public.holdings h on h.coin_id=t.coin_id and h.profile_id=t.profile_id and h.quantity>0
          where t.coin_id=c.id and t.side='buy' and not coalesce(t.is_launch_seed,false)
        ),0) else null end,
        'buySellRatio',case when v_analytics then coalesce((
          select round(
            sum(t.gross_quote_amount) filter(where t.side='buy')/
            nullif(sum(t.gross_quote_amount) filter(where t.side='sell'),0),3
          )
          from public.coin_trade_accounting_v201 t
          where t.coin_id=c.id and not coalesce(t.is_launch_seed,false)
        ),0) else null end,
        'boostedUntil',(select max(b.ends_at) from public.coin_boosts b where b.coin_id=c.id and b.ends_at>now()),
        'createdAt',c.created_at
      ) order by c.created_at desc)
      from public.coins c
      where c.creator_profile_id=p_profile_id
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.public_profile_stats_v056(p_profile_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'giftCount',(select count(*)::int from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id where vg.owner_profile_id=p_profile_id and coalesce(ga.is_burned,false)=false),
    'giftSales',(select count(*)::int from public.gift_trades where seller_profile_id=p_profile_id),
    'giftTradeVolume',coalesce((select sum(price) from public.gift_trades where buyer_profile_id=p_profile_id or seller_profile_id=p_profile_id),0),
    'coinTradeCount',(select count(*)::int from public.trades where profile_id=p_profile_id and not coalesce(is_launch_seed,false)),
    'coinTradeVolume',coalesce((select sum(gross_quote_amount) from public.coin_trade_accounting_v201 where profile_id=p_profile_id and not coalesce(is_launch_seed,false)),0),
    'createdCoinCount',(select count(*)::int from public.coins where creator_profile_id=p_profile_id)
  );
$$;
