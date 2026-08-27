begin;

-- MemeX Market v0.73.0
-- Memecoin gameplay layer: anti-wash discovery, persistent coin progression,
-- creator reputation, market-health telemetry and reliable Genesis/OG tracking.
-- This migration intentionally does not change the current UI theme.

create index if not exists trades_coin_profile_public_v0730_idx
  on public.trades(coin_id,profile_id,created_at desc)
  where is_launch_seed=false;

create index if not exists holdings_coin_positive_quantity_v0730_idx
  on public.holdings(coin_id,quantity desc,profile_id)
  where quantity>0;

-- ---------------------------------------------------------------------------
-- Genesis / OG Top-100
-- ---------------------------------------------------------------------------
-- coin_early_buyers existed before this migration, but normal public buys were
-- not consistently registered there. Record the first configured buyers at the
-- database boundary so API trades, conditional orders and future callers all
-- share the same semantics.
create or replace function public.record_coin_early_buyer_v0730()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_limit integer:=100;
  v_next integer;
begin
  if new.side<>'buy' or coalesce(new.is_launch_seed,false) then
    return new;
  end if;

  select greatest(1,least(1000,coalesce(early_buyer_limit,100)))
  into v_limit
  from public.economy_settings
  where singleton=true;
  v_limit:=coalesce(v_limit,100);

  perform pg_advisory_xact_lock(hashtextextended('mxm:coin-og:'||new.coin_id::text,0));

  if exists(
    select 1 from public.coin_early_buyers
    where coin_id=new.coin_id and profile_id=new.profile_id
  ) then
    return new;
  end if;

  select coalesce(max(ordinal),0)+1
  into v_next
  from public.coin_early_buyers
  where coin_id=new.coin_id;

  if v_next<=v_limit then
    insert into public.coin_early_buyers(coin_id,profile_id,ordinal,first_trade_id,first_bought_at)
    values(new.coin_id,new.profile_id,v_next,new.id,new.created_at)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.record_coin_early_buyer_v0730() from public,anon,authenticated;

drop trigger if exists coin_early_buyer_v0730 on public.trades;
create trigger coin_early_buyer_v0730
after insert on public.trades
for each row
when (new.side='buy' and new.is_launch_seed=false)
execute function public.record_coin_early_buyer_v0730();

-- Backfill historical first buyers deterministically. The launch seed is kept in
-- the ranking, so the creator remains Genesis #1 and public buyers start at #2.
with first_buys as (
  select distinct on (t.coin_id,t.profile_id)
    t.coin_id,t.profile_id,t.id as first_trade_id,t.created_at as first_bought_at
  from public.trades t
  where t.side='buy'
  order by t.coin_id,t.profile_id,t.created_at,t.id
), ranked as (
  select
    fb.*,
    row_number() over(partition by fb.coin_id order by fb.first_bought_at,fb.first_trade_id)::integer as ordinal
  from first_buys fb
), limits as (
  select greatest(1,least(1000,coalesce(early_buyer_limit,100)))::integer as early_limit
  from public.economy_settings
  where singleton=true
)
insert into public.coin_early_buyers(coin_id,profile_id,ordinal,first_trade_id,first_bought_at)
select r.coin_id,r.profile_id,r.ordinal,r.first_trade_id,r.first_bought_at
from ranked r
cross join limits l
where r.ordinal<=l.early_limit
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Creator level hardening
-- ---------------------------------------------------------------------------
-- Volume alone must never buy a better creator fee split. Only non-seed public
-- activity from other profiles counts toward creator progression.
create or replace function public.creator_level_v200(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_coins integer:=0;
  v_holders integer:=0;
  v_traders integer:=0;
  v_volume numeric:=0;
  v_level text:='Bronze';
  v_creator_bps integer:=10;
  v_next_volume numeric:=10000;
  v_next_holders integer:=3;
  v_next_traders integer:=3;
begin
  select count(*)::integer into v_coins
  from public.coins
  where creator_profile_id=p_profile_id;

  select count(distinct h.profile_id)::integer into v_holders
  from public.holdings h
  join public.coins c on c.id=h.coin_id
  where c.creator_profile_id=p_profile_id
    and h.quantity>0
    and h.profile_id<>p_profile_id;

  select count(distinct t.profile_id)::integer into v_traders
  from public.trades t
  join public.coins c on c.id=t.coin_id
  where c.creator_profile_id=p_profile_id
    and not coalesce(t.is_launch_seed,false)
    and t.profile_id<>p_profile_id;

  select coalesce(sum(t.gross_quote_amount),0) into v_volume
  from public.coin_trade_accounting_v201 t
  join public.coins c on c.id=t.coin_id
  where c.creator_profile_id=p_profile_id
    and not coalesce(t.is_launch_seed,false)
    and t.profile_id<>p_profile_id;

  if v_volume>=1000000 and v_holders>=50 and v_traders>=30 then
    v_level:='Diamond'; v_creator_bps:=25;
    v_next_volume:=null; v_next_holders:=null; v_next_traders:=null;
  elsif v_volume>=100000 and v_holders>=15 and v_traders>=10 then
    v_level:='Gold'; v_creator_bps:=20;
    v_next_volume:=1000000; v_next_holders:=50; v_next_traders:=30;
  elsif v_volume>=10000 and v_holders>=3 and v_traders>=3 then
    v_level:='Silver'; v_creator_bps:=15;
    v_next_volume:=100000; v_next_holders:=15; v_next_traders:=10;
  end if;

  return jsonb_build_object(
    'name',v_level,
    'creatorFeeBps',v_creator_bps,
    'coinCount',v_coins,
    'holderCount',v_holders,
    'traderCount',v_traders,
    'volume',v_volume,
    'nextVolume',v_next_volume,
    'nextHolders',v_next_holders,
    'nextTraders',v_next_traders,
    'antiWash',true
  );
end;
$$;

revoke all on function public.creator_level_v200(uuid) from public,anon,authenticated;
grant execute on function public.creator_level_v200(uuid) to service_role;

create or replace function public.creator_reputation_v0730(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_coins integer:=0;
  v_active integer:=0;
  v_holders integer:=0;
  v_traders integer:=0;
  v_volume numeric:=0;
  v_oldest timestamptz;
  v_age_days numeric:=0;
  v_verified boolean:=false;
  v_verification_tier text;
  v_score integer:=0;
  v_grade text:='Starter';
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then
    raise exception 'Profile not found';
  end if;

  select count(*)::integer,
         count(*) filter(where status='active')::integer,
         min(created_at)
  into v_coins,v_active,v_oldest
  from public.coins
  where creator_profile_id=p_profile_id;

  select count(distinct h.profile_id)::integer into v_holders
  from public.holdings h
  join public.coins c on c.id=h.coin_id
  where c.creator_profile_id=p_profile_id
    and h.quantity>0
    and h.profile_id<>p_profile_id;

  select count(distinct t.profile_id)::integer into v_traders
  from public.trades t
  join public.coins c on c.id=t.coin_id
  where c.creator_profile_id=p_profile_id
    and not coalesce(t.is_launch_seed,false)
    and t.profile_id<>p_profile_id;

  select coalesce(sum(t.gross_quote_amount),0) into v_volume
  from public.coin_trade_accounting_v201 t
  join public.coins c on c.id=t.coin_id
  where c.creator_profile_id=p_profile_id
    and not coalesce(t.is_launch_seed,false)
    and t.profile_id<>p_profile_id;

  select cv.tier into v_verification_tier
  from public.creator_verifications_v071 cv
  where cv.profile_id=p_profile_id and cv.revoked_at is null;

  v_verified:=v_verification_tier is not null or exists(
    select 1 from public.profile_entitlements e
    where e.profile_id=p_profile_id
      and e.entitlement_key='creator_verified'
      and (e.expires_at is null or e.expires_at>now())
  );

  if v_oldest is not null then
    v_age_days:=greatest(0,extract(epoch from (now()-v_oldest))/86400.0);
  end if;

  -- Audience and breadth dominate. Volume contributes, but cannot carry the
  -- score by itself. A verified identity is a small bonus, never a substitute
  -- for real market participation.
  v_score:=least(100,
    least(35,floor(sqrt(greatest(v_holders,0)::numeric)*7)::integer)
    +least(25,floor(sqrt(greatest(v_traders,0)::numeric)*6)::integer)
    +least(15,floor(ln(1+greatest(v_volume,0))*1.35)::integer)
    +least(15,floor(v_age_days)::integer)
    +case when v_verified then 10 else 0 end
  );

  v_grade:=case
    when v_score>=85 then 'Elite'
    when v_score>=65 then 'Trusted'
    when v_score>=45 then 'Proven'
    when v_score>=25 then 'Builder'
    else 'Starter'
  end;

  return jsonb_build_object(
    'score',v_score,
    'grade',v_grade,
    'coinCount',v_coins,
    'activeCoins',v_active,
    'externalHolders',v_holders,
    'uniqueTraders',v_traders,
    'externalVolume',v_volume,
    'marketAgeDays',round(v_age_days,1),
    'verified',v_verified,
    'verificationTier',v_verification_tier,
    'antiWash',true
  );
end;
$$;

revoke all on function public.creator_reputation_v0730(uuid) from public,anon,authenticated;
grant execute on function public.creator_reputation_v0730(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Discovery / Heat
-- ---------------------------------------------------------------------------
drop view if exists public.coin_discovery_v0730;
create view public.coin_discovery_v0730 with (security_invoker=true) as
with per_trader_24 as (
  select
    t.coin_id,
    t.profile_id,
    sum(t.gross_quote_amount) as trader_volume
  from public.coin_trade_accounting_v201 t
  where not coalesce(t.is_launch_seed,false)
    and t.created_at>=now()-interval '24 hours'
  group by t.coin_id,t.profile_id
), activity_24 as (
  select
    p.coin_id,
    count(*)::bigint as unique_traders_24h,
    coalesce(max(p.trader_volume),0) as top_trader_volume_24h
  from per_trader_24 p
  group by p.coin_id
), lifetime as (
  select
    t.coin_id,
    count(distinct t.profile_id)::bigint as unique_traders_all,
    max(t.created_at) as last_public_trade_at
  from public.coin_trade_accounting_v201 t
  where not coalesce(t.is_launch_seed,false)
  group by t.coin_id
), base as (
  select
    m.*,
    coalesce(a.unique_traders_24h,0)::bigint as unique_traders_24h,
    coalesce(l.unique_traders_all,0)::bigint as unique_traders_all,
    l.last_public_trade_at,
    case when m.volume_24h>0 then
      least(10000,greatest(0,round(10000*a.top_trader_volume_24h/nullif(m.volume_24h,0))))::integer
    else 0 end as top_trader_share_bps
  from public.market_overview m
  left join activity_24 a on a.coin_id=m.id
  left join lifetime l on l.coin_id=m.id
), scored as (
  select
    b.*,
    greatest(0,least(100,
      least(30,floor(12*ln(1+least(10::numeric,b.volume_24h/greatest(b.liquidity,0.01))))::integer)
      +least(25,(b.unique_traders_24h*4)::integer)
      +least(20,floor(8*ln(1+greatest(b.holder_count,0)::numeric))::integer)
      +case
        when b.last_public_trade_at>=now()-interval '5 minutes' then 15
        when b.last_public_trade_at>=now()-interval '1 hour' then 12
        when b.last_public_trade_at>=now()-interval '6 hours' then 8
        when b.last_public_trade_at>=now()-interval '24 hours' then 4
        else 0
      end
      +least(10,b.trade_count_24h::integer)
      -case
        when b.top_trader_share_bps>=8000 then 25
        when b.top_trader_share_bps>=6000 then 15
        when b.top_trader_share_bps>=4000 then 8
        else 0
      end
    ))::integer as heat_score,
    case
      when b.holder_count>=100 and b.unique_traders_all>=75 and b.all_time_volume>=10000 then 5
      when b.holder_count>=25 and b.unique_traders_all>=20 and b.all_time_volume>=1000 then 4
      when b.holder_count>=10 and b.unique_traders_all>=8 and b.all_time_volume>=100 then 3
      when b.holder_count>=3 and b.unique_traders_all>=3 and b.all_time_volume>=10 then 2
      else 1
    end::integer as coin_level
  from base b
)
select
  s.*,
  case
    when s.heat_score>=80 then 'viral'
    when s.heat_score>=60 then 'hot'
    when s.heat_score>=40 then 'trending'
    when s.heat_score>=20 then 'moving'
    else 'quiet'
  end as heat_tier,
  case s.coin_level
    when 5 then 'legend'
    when 4 then 'viral'
    when 3 then 'trending'
    when 2 then 'established'
    else 'launch'
  end as coin_level_key
from scored s;

revoke all on public.coin_discovery_v0730 from public,anon,authenticated;
grant select on public.coin_discovery_v0730 to service_role;

-- ---------------------------------------------------------------------------
-- Per-coin gameplay snapshot
-- ---------------------------------------------------------------------------
create or replace function public.coin_pulse_snapshot_v0730(p_coin_id uuid,p_profile_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_market record;
  v_total_held numeric:=0;
  v_top1 numeric:=0;
  v_top3 numeric:=0;
  v_creator_qty numeric:=0;
  v_creator_locked numeric:=0;
  v_top1_bps integer:=0;
  v_top3_bps integer:=0;
  v_creator_bps integer:=0;
  v_creator_locked_bps integer:=0;
  v_og_count integer:=0;
  v_og_limit integer:=100;
  v_user_og integer;
  v_coin_tier text;
  v_creator_tier text;
  v_coin_verified boolean:=false;
  v_creator_verified boolean:=false;
  v_creator_reputation jsonb:='{}'::jsonb;
  v_health integer:=100;
  v_flags text[]:=array[]::text[];
  v_age_hours numeric:=0;
  v_target_holders integer;
  v_target_traders integer;
  v_target_volume numeric;
  v_progress integer:=100;
  v_buy_share_bps integer:=0;
begin
  select * into v_market
  from public.coin_discovery_v0730
  where id=p_coin_id and status='active';
  if not found then raise exception 'Coin not found'; end if;

  select coalesce(sum(h.quantity),0),coalesce(max(h.quantity),0)
  into v_total_held,v_top1
  from public.holdings h
  where h.coin_id=p_coin_id and h.quantity>0;

  select coalesce(sum(x.quantity),0) into v_top3
  from (
    select h.quantity
    from public.holdings h
    where h.coin_id=p_coin_id and h.quantity>0
    order by h.quantity desc
    limit 3
  ) x;

  if v_market.creator_profile_id is not null then
    select coalesce(h.quantity,0) into v_creator_qty
    from public.holdings h
    where h.coin_id=p_coin_id and h.profile_id=v_market.creator_profile_id;
    if not found then v_creator_qty:=0; end if;
    v_creator_locked:=public.coin_locked_tokens_v200(v_market.creator_profile_id,p_coin_id);
    v_creator_reputation:=public.creator_reputation_v0730(v_market.creator_profile_id);
  end if;

  if v_total_held>0 then
    v_top1_bps:=least(10000,greatest(0,round(10000*v_top1/v_total_held)))::integer;
    v_top3_bps:=least(10000,greatest(0,round(10000*v_top3/v_total_held)))::integer;
    v_creator_bps:=least(10000,greatest(0,round(10000*v_creator_qty/v_total_held)))::integer;
  end if;
  if v_creator_qty>0 then
    v_creator_locked_bps:=least(10000,greatest(0,round(10000*v_creator_locked/v_creator_qty)))::integer;
  end if;

  select count(*)::integer into v_og_count
  from public.coin_early_buyers
  where coin_id=p_coin_id;
  select greatest(1,least(1000,coalesce(early_buyer_limit,100)))::integer
  into v_og_limit
  from public.economy_settings where singleton=true;
  v_og_limit:=coalesce(v_og_limit,100);

  if p_profile_id is not null then
    select ordinal into v_user_og
    from public.coin_early_buyers
    where coin_id=p_coin_id and profile_id=p_profile_id;
  end if;

  select tier into v_coin_tier
  from public.coin_verifications_v071
  where coin_id=p_coin_id and revoked_at is null;
  v_coin_verified:=v_coin_tier is not null;

  if v_market.creator_profile_id is not null then
    select tier into v_creator_tier
    from public.creator_verifications_v071
    where profile_id=v_market.creator_profile_id and revoked_at is null;
    v_creator_verified:=v_creator_tier is not null or exists(
      select 1 from public.profile_entitlements e
      where e.profile_id=v_market.creator_profile_id
        and e.entitlement_key='creator_verified'
        and (e.expires_at is null or e.expires_at>now())
    );
  end if;

  v_age_hours:=greatest(0,extract(epoch from (now()-v_market.created_at))/3600.0);
  if v_market.volume_24h>0 then
    v_buy_share_bps:=least(10000,greatest(0,round(10000*v_market.buy_volume_24h/v_market.volume_24h)))::integer;
  end if;

  if v_market.holder_count<3 then
    v_health:=v_health-15;
    v_flags:=array_append(v_flags,'low_holder_count');
  end if;
  if v_top1_bps>=8000 then
    v_health:=v_health-25;
    v_flags:=array_append(v_flags,'holder_concentration');
  elsif v_top1_bps>=6000 then
    v_health:=v_health-15;
    v_flags:=array_append(v_flags,'holder_concentration');
  end if;
  if v_market.volume_24h>0 and v_market.top_trader_share_bps>=8000 then
    v_health:=v_health-20;
    v_flags:=array_append(v_flags,'single_trader_activity');
  elsif v_market.volume_24h>0 and v_market.top_trader_share_bps>=6000 then
    v_health:=v_health-10;
    v_flags:=array_append(v_flags,'single_trader_activity');
  end if;
  if v_creator_bps>=6000 and v_creator_locked_bps<5000 then
    v_health:=v_health-15;
    v_flags:=array_append(v_flags,'creator_concentration');
  end if;
  if v_market.liquidity<10 then
    v_health:=v_health-20;
    v_flags:=array_append(v_flags,'thin_liquidity');
  elsif v_market.liquidity<50 then
    v_health:=v_health-10;
    v_flags:=array_append(v_flags,'thin_liquidity');
  end if;
  if v_market.unique_traders_all<3 then
    v_health:=v_health-10;
    v_flags:=array_append(v_flags,'low_participation');
  end if;
  if v_age_hours<6 then
    v_health:=v_health-5;
    v_flags:=array_append(v_flags,'new_market');
  end if;
  v_health:=greatest(0,least(100,v_health));

  case v_market.coin_level
    when 1 then v_target_holders:=3; v_target_traders:=3; v_target_volume:=10;
    when 2 then v_target_holders:=10; v_target_traders:=8; v_target_volume:=100;
    when 3 then v_target_holders:=25; v_target_traders:=20; v_target_volume:=1000;
    when 4 then v_target_holders:=100; v_target_traders:=75; v_target_volume:=10000;
    else v_target_holders:=null; v_target_traders:=null; v_target_volume:=null;
  end case;

  if v_target_holders is not null then
    v_progress:=round(100*(
      least(1::numeric,v_market.holder_count::numeric/v_target_holders)
      +least(1::numeric,v_market.unique_traders_all::numeric/v_target_traders)
      +least(1::numeric,v_market.all_time_volume/v_target_volume)
    )/3.0)::integer;
  end if;

  return jsonb_build_object(
    'heat',jsonb_build_object(
      'score',v_market.heat_score,
      'tier',v_market.heat_tier,
      'uniqueTraders24h',v_market.unique_traders_24h,
      'topTraderShareBps',v_market.top_trader_share_bps,
      'buyShareBps',v_buy_share_bps,
      'lastTradeAt',v_market.last_public_trade_at
    ),
    'level',jsonb_build_object(
      'number',v_market.coin_level,
      'key',v_market.coin_level_key,
      'progressPct',v_progress,
      'targets',case when v_target_holders is null then null else jsonb_build_object(
        'holders',jsonb_build_object('current',v_market.holder_count,'target',v_target_holders),
        'traders',jsonb_build_object('current',v_market.unique_traders_all,'target',v_target_traders),
        'volume',jsonb_build_object('current',v_market.all_time_volume,'target',v_target_volume)
      ) end
    ),
    'og',jsonb_build_object(
      'count',v_og_count,
      'limit',v_og_limit,
      'remaining',greatest(0,v_og_limit-v_og_count),
      'userOrdinal',v_user_og
    ),
    'distribution',jsonb_build_object(
      'topHolderShareBps',v_top1_bps,
      'top3ShareBps',v_top3_bps,
      'creatorShareBps',v_creator_bps,
      'creatorLockedShareBps',v_creator_locked_bps
    ),
    'health',jsonb_build_object(
      'score',v_health,
      'grade',case
        when v_health>=80 then 'strong'
        when v_health>=60 then 'balanced'
        when v_health>=40 then 'watch'
        else 'fragile'
      end,
      'flags',to_jsonb(v_flags)
    ),
    'verification',jsonb_build_object(
      'coinVerified',v_coin_verified,
      'coinTier',v_coin_tier,
      'creatorVerified',v_creator_verified,
      'creatorTier',v_creator_tier
    ),
    'creatorReputation',v_creator_reputation,
    'ageHours',round(v_age_hours,1)
  );
end;
$$;

revoke all on function public.coin_pulse_snapshot_v0730(uuid,uuid) from public,anon,authenticated;
grant execute on function public.coin_pulse_snapshot_v0730(uuid,uuid) to service_role;

commit;
