begin;

alter table public.economy_settings add column if not exists coin_launch_delay_seconds integer not null default 45;
alter table public.economy_settings add column if not exists coin_graduation_holders integer not null default 10;
alter table public.economy_settings add column if not exists coin_graduation_traders integer not null default 8;
alter table public.economy_settings add column if not exists coin_graduation_volume numeric not null default 100;
alter table public.economy_settings add column if not exists coin_whale_min_quote numeric not null default 5;
alter table public.economy_settings add column if not exists coin_whale_liquidity_bps integer not null default 300;

alter table public.coins add column if not exists launch_opens_at timestamptz;
alter table public.coins add column if not exists graduated_at timestamptz;
update public.coins set launch_opens_at=coalesce(launch_opens_at,created_at) where launch_opens_at is null;

create table if not exists public.coin_milestones_v078 (
  id uuid primary key default gen_random_uuid(),
  coin_id uuid not null references public.coins(id) on delete cascade,
  milestone_key text not null,
  kind text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  trade_id uuid references public.trades(id) on delete set null,
  amount numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(coin_id,milestone_key),
  constraint coin_milestones_v078_kind_check check (kind in ('coin_whale_buy','coin_whale_sell','coin_ath','coin_graduated','coin_holder_milestone','coin_volume_milestone'))
);
create index if not exists coin_milestones_v078_coin_created_idx on public.coin_milestones_v078(coin_id,created_at desc);
create index if not exists coin_milestones_v078_actor_idx on public.coin_milestones_v078(actor_profile_id) where actor_profile_id is not null;
alter table public.coin_milestones_v078 enable row level security;
revoke all on table public.coin_milestones_v078 from public,anon,authenticated;
grant select,insert,update,delete on table public.coin_milestones_v078 to service_role;

create or replace function public.prepare_coin_launch_v078()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_delay integer:=45;
begin
  select greatest(0,least(300,coalesce(coin_launch_delay_seconds,45))) into v_delay from public.economy_settings where singleton=true;
  if new.launch_opens_at is null then new.launch_opens_at:=clock_timestamp()+make_interval(secs=>v_delay); end if;
  return new;
end;$$;
revoke all on function public.prepare_coin_launch_v078() from public,anon,authenticated;

drop trigger if exists prepare_coin_launch_v078 on public.coins;
create trigger prepare_coin_launch_v078 before insert on public.coins for each row execute function public.prepare_coin_launch_v078();

alter table public.coins alter column launch_opens_at set not null;

create or replace function public.guard_coin_trade_window_v078()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_opens timestamptz; v_status text; v_seconds integer;
begin
  if coalesce(new.is_launch_seed,false) then return new; end if;
  select launch_opens_at,status into v_opens,v_status from public.coins where id=new.coin_id;
  if v_status is distinct from 'active' then raise exception 'Мемкоин недоступен для торговли'; end if;
  if v_opens is not null and clock_timestamp()<v_opens then
    v_seconds:=greatest(1,ceil(extract(epoch from (v_opens-clock_timestamp())))::integer);
    raise exception 'Торги откроются через % сек.',v_seconds;
  end if;
  return new;
end;$$;
revoke all on function public.guard_coin_trade_window_v078() from public,anon,authenticated;

drop trigger if exists guard_coin_trade_window_v078 on public.trades;
create trigger guard_coin_trade_window_v078 before insert on public.trades for each row execute function public.guard_coin_trade_window_v078();

create or replace function public.record_coin_milestone_v078(
  p_coin_id uuid,p_key text,p_kind text,p_actor uuid default null,p_trade uuid default null,p_amount numeric default null,p_metadata jsonb default '{}'::jsonb,p_importance integer default 60
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  insert into public.coin_milestones_v078(coin_id,milestone_key,kind,actor_profile_id,trade_id,amount,metadata)
  values(p_coin_id,left(p_key,160),p_kind,p_actor,p_trade,p_amount,coalesce(p_metadata,'{}'::jsonb))
  on conflict(coin_id,milestone_key) do nothing returning id into v_id;
  if v_id is null then return false; end if;
  perform public.emit_activity_event_v074(
    'coin-v078:'||p_coin_id::text||':'||left(p_key,120),p_actor,p_kind,greatest(0,least(100,coalesce(p_importance,60))),'public',null,p_coin_id,null,p_amount,coalesce(p_metadata,'{}'::jsonb),now()
  );
  return true;
end;$$;
revoke all on function public.record_coin_milestone_v078(uuid,text,text,uuid,uuid,numeric,jsonb,integer) from public,anon,authenticated;
grant execute on function public.record_coin_milestone_v078(uuid,text,text,uuid,uuid,numeric,jsonb,integer) to service_role;

create or replace function public.process_coin_trade_gameplay_v078()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_liquidity numeric:=0; v_whale_min numeric:=5; v_whale_bps integer:=300; v_whale_threshold numeric:=5;
  v_prev_ath numeric; v_holders integer:=0; v_traders integer:=0; v_volume numeric:=0;
  v_grad_holders integer:=10; v_grad_traders integer:=8; v_grad_volume numeric:=100; v_graduated timestamptz;
  v_threshold integer; v_vol_threshold numeric;
begin
  if coalesce(new.is_launch_seed,false) then return new; end if;
  select greatest(0,c.quote_reserve*2) into v_liquidity from public.coins c where c.id=new.coin_id;
  select greatest(0,coalesce(coin_whale_min_quote,5)),greatest(1,least(5000,coalesce(coin_whale_liquidity_bps,300))),
         greatest(1,coalesce(coin_graduation_holders,10)),greatest(1,coalesce(coin_graduation_traders,8)),greatest(0.01,coalesce(coin_graduation_volume,100))
  into v_whale_min,v_whale_bps,v_grad_holders,v_grad_traders,v_grad_volume
  from public.economy_settings where singleton=true;
  v_whale_threshold:=greatest(v_whale_min,v_liquidity*v_whale_bps/10000.0);

  if coalesce(new.quote_amount,0)>=v_whale_threshold then
    perform public.record_coin_milestone_v078(new.coin_id,'whale:'||new.id::text,case when new.side='sell' then 'coin_whale_sell' else 'coin_whale_buy' end,new.profile_id,new.id,new.quote_amount,jsonb_build_object('threshold',v_whale_threshold,'side',new.side,'price',new.price),82);
  end if;

  select max(t.price) into v_prev_ath from public.trades t where t.coin_id=new.coin_id and not coalesce(t.is_launch_seed,false) and t.id<>new.id;
  if v_prev_ath is null or new.price>v_prev_ath*1.001 then
    perform public.record_coin_milestone_v078(new.coin_id,'ath:'||new.id::text,'coin_ath',new.profile_id,new.id,new.price,jsonb_build_object('previousAth',v_prev_ath,'price',new.price),76);
  end if;

  select count(*)::integer into v_holders from public.holdings h where h.coin_id=new.coin_id and h.quantity>0;
  select count(distinct t.profile_id)::integer,coalesce(sum(t.gross_quote_amount),0) into v_traders,v_volume
  from public.coin_trade_accounting_v201 t where t.coin_id=new.coin_id and not coalesce(t.is_launch_seed,false);

  foreach v_threshold in array array[3,10,25,100] loop
    if v_holders>=v_threshold then
      perform public.record_coin_milestone_v078(new.coin_id,'holders:'||v_threshold::text,'coin_holder_milestone',new.profile_id,new.id,v_threshold,jsonb_build_object('holders',v_holders,'target',v_threshold),58);
    end if;
  end loop;
  foreach v_vol_threshold in array array[10::numeric,100::numeric,1000::numeric,10000::numeric] loop
    if v_volume>=v_vol_threshold then
      perform public.record_coin_milestone_v078(new.coin_id,'volume:'||v_vol_threshold::text,'coin_volume_milestone',new.profile_id,new.id,v_vol_threshold,jsonb_build_object('volume',v_volume,'target',v_vol_threshold),55);
    end if;
  end loop;

  if v_holders>=v_grad_holders and v_traders>=v_grad_traders and v_volume>=v_grad_volume then
    update public.coins set graduated_at=coalesce(graduated_at,new.created_at),updated_at=now() where id=new.coin_id and graduated_at is null returning graduated_at into v_graduated;
    if v_graduated is not null then
      perform public.record_coin_milestone_v078(new.coin_id,'graduated','coin_graduated',new.profile_id,new.id,v_volume,jsonb_build_object('holders',v_holders,'traders',v_traders,'volume',v_volume),96);
    end if;
  end if;
  return new;
end;$$;
revoke all on function public.process_coin_trade_gameplay_v078() from public,anon,authenticated;

drop trigger if exists process_coin_trade_gameplay_v078 on public.trades;
create trigger process_coin_trade_gameplay_v078 after insert on public.trades for each row execute function public.process_coin_trade_gameplay_v078();

create or replace function public.coin_pulse_snapshot_v0780(p_coin_id uuid,p_profile_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_base jsonb; v_coin public.coins; v_market record; v_settings public.economy_settings;
  v_holders integer:=0; v_traders integer:=0; v_volume numeric:=0; v_progress integer:=0;
  v_stage text:='launch'; v_trade_open boolean:=true; v_risk integer:=0; v_risk_grade text:='low';
  v_drawdown_bps integer:=0; v_creator_sell numeric:=0; v_creator_sell_bps integer:=0;
  v_whale_threshold numeric:=5; v_whales24 integer:=0; v_last_whale timestamptz; v_buyers24 integer:=0; v_sellers24 integer:=0;
  v_trend integer:=0; v_health integer:=0; v_age_hours numeric:=0; v_flags text[]:=array[]::text[];
begin
  v_base:=public.coin_pulse_snapshot_v0730(p_coin_id,p_profile_id);
  select * into v_coin from public.coins where id=p_coin_id;
  if not found then raise exception 'Coin not found'; end if;
  select * into v_market from public.coin_discovery_v0730 where id=p_coin_id;
  if not found then raise exception 'Coin not found'; end if;
  select * into v_settings from public.economy_settings where singleton=true;

  v_holders:=coalesce(v_market.holder_count,0)::integer;
  v_traders:=coalesce(v_market.unique_traders_all,0)::integer;
  v_volume:=coalesce(v_market.all_time_volume,0);
  v_trade_open:=clock_timestamp()>=v_coin.launch_opens_at;
  v_age_hours:=greatest(0,extract(epoch from (clock_timestamp()-v_coin.created_at))/3600.0);
  v_progress:=least(100,greatest(0,floor(100*least(
    least(1::numeric,v_holders::numeric/greatest(1,v_settings.coin_graduation_holders)),
    least(1::numeric,v_traders::numeric/greatest(1,v_settings.coin_graduation_traders)),
    least(1::numeric,v_volume/greatest(0.01,v_settings.coin_graduation_volume))
  )))::integer);

  v_stage:=case
    when not v_trade_open then 'prelaunch'
    when v_market.coin_level>=5 then 'legendary'
    when v_market.coin_level>=4 then 'elite'
    when v_coin.graduated_at is not null or (v_holders>=v_settings.coin_graduation_holders and v_traders>=v_settings.coin_graduation_traders and v_volume>=v_settings.coin_graduation_volume) then 'graduated'
    when v_market.coin_level>=2 then 'growth'
    else 'launch'
  end;

  v_health:=coalesce((v_base->'health'->>'score')::integer,0);
  v_risk:=greatest(0,100-v_health);
  if coalesce(v_market.ath_price,0)>0 and v_coin.current_price<v_market.ath_price then
    v_drawdown_bps:=least(10000,greatest(0,round(10000*(1-v_coin.current_price/v_market.ath_price)))::integer);
  end if;
  select coalesce(sum(t.gross_quote_amount),0) into v_creator_sell
  from public.coin_trade_accounting_v201 t where t.coin_id=p_coin_id and t.profile_id=v_coin.creator_profile_id and t.side='sell' and not coalesce(t.is_launch_seed,false) and t.created_at>=now()-interval '24 hours';
  if coalesce(v_market.volume_24h,0)>0 then v_creator_sell_bps:=least(10000,greatest(0,round(10000*v_creator_sell/v_market.volume_24h))::integer); end if;
  if v_creator_sell_bps>=3000 then v_risk:=v_risk+18; v_flags:=array_append(v_flags,'creator_selling'); elsif v_creator_sell_bps>=1500 then v_risk:=v_risk+8; v_flags:=array_append(v_flags,'creator_selling'); end if;
  if v_drawdown_bps>=7000 then v_risk:=v_risk+14; v_flags:=array_append(v_flags,'deep_drawdown'); elsif v_drawdown_bps>=4000 then v_risk:=v_risk+6; v_flags:=array_append(v_flags,'deep_drawdown'); end if;
  v_risk:=least(100,greatest(0,v_risk));
  v_risk_grade:=case when v_risk>=75 then 'critical' when v_risk>=50 then 'high' when v_risk>=25 then 'medium' else 'low' end;

  v_whale_threshold:=greatest(coalesce(v_settings.coin_whale_min_quote,5),greatest(0,v_market.liquidity)*coalesce(v_settings.coin_whale_liquidity_bps,300)/10000.0);
  select count(*)::integer,max(m.created_at) into v_whales24,v_last_whale from public.coin_milestones_v078 m where m.coin_id=p_coin_id and m.kind in ('coin_whale_buy','coin_whale_sell') and m.created_at>=now()-interval '24 hours';
  select count(distinct t.profile_id) filter(where t.side='buy')::integer,count(distinct t.profile_id) filter(where t.side='sell')::integer into v_buyers24,v_sellers24
  from public.trades t where t.coin_id=p_coin_id and not coalesce(t.is_launch_seed,false) and t.created_at>=now()-interval '24 hours';

  v_trend:=least(100,greatest(0,coalesce(v_market.heat_score,0)
    +least(12,greatest(0,floor(coalesce(v_market.change_24h,0)/5))::integer)
    -case when v_risk>=75 then 18 when v_risk>=50 then 8 else 0 end
    +case when v_coin.graduated_at is not null then 5 else 0 end));

  return v_base || jsonb_build_object(
    'lifecycle',jsonb_build_object(
      'key',v_stage,'tradingOpen',v_trade_open,'opensAt',v_coin.launch_opens_at,'graduatedAt',v_coin.graduated_at,
      'graduationProgressPct',v_progress,
      'targets',jsonb_build_object(
        'holders',jsonb_build_object('current',v_holders,'target',v_settings.coin_graduation_holders),
        'traders',jsonb_build_object('current',v_traders,'target',v_settings.coin_graduation_traders),
        'volume',jsonb_build_object('current',v_volume,'target',v_settings.coin_graduation_volume)
      )
    ),
    'risk',jsonb_build_object('score',v_risk,'grade',v_risk_grade,'flags',to_jsonb(v_flags),'drawdownBps',v_drawdown_bps,'creatorSellShareBps',v_creator_sell_bps),
    'signals',jsonb_build_object('trendScore',v_trend,'whaleThreshold',v_whale_threshold,'whaleTrades24h',v_whales24,'lastWhaleAt',v_last_whale,'uniqueBuyers24h',coalesce(v_buyers24,0),'uniqueSellers24h',coalesce(v_sellers24,0)),
    'ageHours',round(v_age_hours,1)
  );
end;$$;
revoke all on function public.coin_pulse_snapshot_v0780(uuid,uuid) from public,anon,authenticated;
grant execute on function public.coin_pulse_snapshot_v0780(uuid,uuid) to service_role;

-- Existing coins keep their historical trading state. Backfill only lifecycle state,
-- never synthetic historical events.
update public.coins c set graduated_at=coalesce(c.graduated_at,now())
from public.coin_discovery_v0730 d, public.economy_settings s
where c.id=d.id and s.singleton=true and c.graduated_at is null
  and d.holder_count>=s.coin_graduation_holders and d.unique_traders_all>=s.coin_graduation_traders and d.all_time_volume>=s.coin_graduation_volume;

commit;
