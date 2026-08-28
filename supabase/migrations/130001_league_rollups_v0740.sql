begin;

-- MemeX Market v0.74.0
-- League scoring is now event-driven. Reads rank compact daily rollups instead
-- of rescanning every historical trade for every profile.

create table if not exists public.league_daily_stats_v074 (
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  coin_volume numeric not null default 0 check(coin_volume>=0),
  gift_volume numeric not null default 0 check(gift_volume>=0),
  coin_trades integer not null default 0 check(coin_trades>=0),
  gift_trades integer not null default 0 check(gift_trades>=0),
  realized_pnl numeric not null default 0,
  gift_delta integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(season_id,profile_id,activity_date)
);
create index if not exists league_daily_profile_v074_idx on public.league_daily_stats_v074(profile_id,activity_date desc);
create index if not exists league_daily_season_v074_idx on public.league_daily_stats_v074(season_id,activity_date,profile_id);

create table if not exists public.league_daily_entities_v074 (
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  entity_key text not null,
  created_at timestamptz not null default now(),
  primary key(season_id,profile_id,activity_date,entity_key),
  check(char_length(entity_key) between 3 and 96)
);
create index if not exists league_daily_entities_season_v074_idx on public.league_daily_entities_v074(season_id,profile_id,activity_date);

alter table public.league_daily_stats_v074 enable row level security;
alter table public.league_daily_entities_v074 enable row level security;
revoke all on public.league_daily_stats_v074,public.league_daily_entities_v074 from public,anon,authenticated;
grant select,insert,update,delete on public.league_daily_stats_v074,public.league_daily_entities_v074 to service_role;

create or replace function public.league_record_daily_v074(
  p_profile_id uuid,
  p_created_at timestamptz,
  p_coin_volume numeric default 0,
  p_gift_volume numeric default 0,
  p_coin_trades integer default 0,
  p_gift_trades integer default 0,
  p_realized_pnl numeric default 0,
  p_gift_delta integer default 0,
  p_entity_key text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_season_id uuid; v_date date; v_time timestamptz:=coalesce(p_created_at,now());
begin
  select id into v_season_id from public.league_seasons
  where v_time>=starts_at and v_time<ends_at order by starts_at desc limit 1;
  if v_season_id is null and v_time>=date_trunc('month',now()) and v_time<date_trunc('month',now())+interval '1 month' then
    v_season_id:=public.ensure_league_season_v0722();
  end if;
  if v_season_id is null then return; end if;
  v_date:=(v_time at time zone 'UTC')::date;
  insert into public.league_daily_stats_v074(season_id,profile_id,activity_date,coin_volume,gift_volume,coin_trades,gift_trades,realized_pnl,gift_delta,updated_at)
  values(v_season_id,p_profile_id,v_date,greatest(0,coalesce(p_coin_volume,0)),greatest(0,coalesce(p_gift_volume,0)),greatest(0,coalesce(p_coin_trades,0)),greatest(0,coalesce(p_gift_trades,0)),coalesce(p_realized_pnl,0),coalesce(p_gift_delta,0),now())
  on conflict(season_id,profile_id,activity_date) do update set
    coin_volume=public.league_daily_stats_v074.coin_volume+excluded.coin_volume,
    gift_volume=public.league_daily_stats_v074.gift_volume+excluded.gift_volume,
    coin_trades=public.league_daily_stats_v074.coin_trades+excluded.coin_trades,
    gift_trades=public.league_daily_stats_v074.gift_trades+excluded.gift_trades,
    realized_pnl=public.league_daily_stats_v074.realized_pnl+excluded.realized_pnl,
    gift_delta=public.league_daily_stats_v074.gift_delta+excluded.gift_delta,
    updated_at=now();
  if p_entity_key is not null and length(trim(p_entity_key))>=3 then
    insert into public.league_daily_entities_v074(season_id,profile_id,activity_date,entity_key)
    values(v_season_id,p_profile_id,v_date,left(trim(p_entity_key),96)) on conflict do nothing;
  end if;
end;$$;

create or replace function public.league_trade_rollup_v074() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(new.is_launch_seed,false) then return new; end if;
  perform public.league_record_daily_v074(new.profile_id,new.created_at,new.quote_amount,0,1,0,coalesce(new.realized_pnl,0),0,'coin:'||new.coin_id);
  return new;
end;$$;
drop trigger if exists league_trade_rollup_v074 on public.trades;
create trigger league_trade_rollup_v074 after insert on public.trades for each row execute function public.league_trade_rollup_v074();

create or replace function public.league_gift_trade_rollup_v074() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.league_record_daily_v074(new.buyer_profile_id,new.created_at,0,new.price,0,1,0,1,'gift:'||new.virtual_gift_id);
  if new.seller_profile_id is not null and new.seller_profile_id<>new.buyer_profile_id then
    perform public.league_record_daily_v074(new.seller_profile_id,new.created_at,0,new.price,0,1,coalesce(new.realized_pnl,0),-1,'gift:'||new.virtual_gift_id);
  end if;
  return new;
end;$$;
drop trigger if exists league_gift_trade_rollup_v074 on public.gift_trades;
create trigger league_gift_trade_rollup_v074 after insert on public.gift_trades for each row execute function public.league_gift_trade_rollup_v074();

-- Current-season backfill. New activity is maintained by triggers above.
with s as (
  select id,starts_at,ends_at from public.league_seasons where status='active' and now()>=starts_at and now()<ends_at order by starts_at desc limit 1
), rows as (
  select s.id season_id,t.profile_id,(t.created_at at time zone 'UTC')::date activity_date,
    sum(t.quote_amount) coin_volume,0::numeric gift_volume,count(*)::integer coin_trades,0::integer gift_trades,sum(coalesce(t.realized_pnl,0)) realized_pnl,0::integer gift_delta
  from s join public.trades t on t.created_at>=s.starts_at and t.created_at<s.ends_at and not coalesce(t.is_launch_seed,false)
  group by s.id,t.profile_id,(t.created_at at time zone 'UTC')::date
  union all
  select s.id,g.buyer_profile_id,(g.created_at at time zone 'UTC')::date,0,sum(g.price),0,count(*)::integer,0,count(*)::integer
  from s join public.gift_trades g on g.created_at>=s.starts_at and g.created_at<s.ends_at
  group by s.id,g.buyer_profile_id,(g.created_at at time zone 'UTC')::date
  union all
  select s.id,g.seller_profile_id,(g.created_at at time zone 'UTC')::date,0,sum(g.price),0,count(*)::integer,sum(coalesce(g.realized_pnl,0)),-count(*)::integer
  from s join public.gift_trades g on g.created_at>=s.starts_at and g.created_at<s.ends_at
  where g.seller_profile_id is not null and g.seller_profile_id<>g.buyer_profile_id
  group by s.id,g.seller_profile_id,(g.created_at at time zone 'UTC')::date
), agg as (
  select season_id,profile_id,activity_date,sum(coin_volume) coin_volume,sum(gift_volume) gift_volume,sum(coin_trades)::integer coin_trades,sum(gift_trades)::integer gift_trades,sum(realized_pnl) realized_pnl,sum(gift_delta)::integer gift_delta
  from rows group by season_id,profile_id,activity_date
)
insert into public.league_daily_stats_v074(season_id,profile_id,activity_date,coin_volume,gift_volume,coin_trades,gift_trades,realized_pnl,gift_delta)
select season_id,profile_id,activity_date,coin_volume,gift_volume,coin_trades,gift_trades,realized_pnl,gift_delta from agg
on conflict(season_id,profile_id,activity_date) do update set coin_volume=excluded.coin_volume,gift_volume=excluded.gift_volume,coin_trades=excluded.coin_trades,gift_trades=excluded.gift_trades,realized_pnl=excluded.realized_pnl,gift_delta=excluded.gift_delta,updated_at=now();

with s as (
  select id,starts_at,ends_at from public.league_seasons where status='active' and now()>=starts_at and now()<ends_at order by starts_at desc limit 1
)
insert into public.league_daily_entities_v074(season_id,profile_id,activity_date,entity_key)
select distinct s.id,t.profile_id,(t.created_at at time zone 'UTC')::date,'coin:'||t.coin_id
from s join public.trades t on t.created_at>=s.starts_at and t.created_at<s.ends_at and not coalesce(t.is_launch_seed,false)
on conflict do nothing;
with s as (
  select id,starts_at,ends_at from public.league_seasons where status='active' and now()>=starts_at and now()<ends_at order by starts_at desc limit 1
)
insert into public.league_daily_entities_v074(season_id,profile_id,activity_date,entity_key)
select distinct s.id,x.profile_id,(x.created_at at time zone 'UTC')::date,'gift:'||x.virtual_gift_id
from s join (
  select buyer_profile_id profile_id,created_at,virtual_gift_id from public.gift_trades
  union all
  select seller_profile_id,created_at,virtual_gift_id from public.gift_trades where seller_profile_id is not null and seller_profile_id<>buyer_profile_id
) x on x.created_at>=s.starts_at and x.created_at<s.ends_at
on conflict do nothing;

create or replace function public.refresh_league_entries_v0722(p_season_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_season public.league_seasons;
begin
  select * into v_season from public.league_seasons where id=p_season_id for update;
  if not found then raise exception 'League season not found'; end if;
  with entity_counts as (
    select season_id,profile_id,activity_date,count(*)::integer entities
    from public.league_daily_entities_v074 where season_id=v_season.id group by season_id,profile_id,activity_date
  ), scored_days as (
    select d.profile_id,d.coin_volume+d.gift_volume volume,d.coin_trades+d.gift_trades trades,d.realized_pnl,
      1 active_day,coalesce(ec.entities,0) entities,
      greatest(-100,least(150,d.realized_pnl*4))
      + least(120,ln(1+d.coin_volume+d.gift_volume)*18)
      + least(100,(d.coin_trades+d.gift_trades)*6)
      + least(80,coalesce(ec.entities,0)*10)
      + 40 as day_score
    from public.league_daily_stats_v074 d
    left join entity_counts ec on ec.season_id=d.season_id and ec.profile_id=d.profile_id and ec.activity_date=d.activity_date
    where d.season_id=v_season.id
  ), gifts as (
    select vg.owner_profile_id profile_id,count(*)::integer gift_count
    from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
    where not coalesce(ga.is_burned,false) group by vg.owner_profile_id
  ), totals as (
    select sd.profile_id,round(sum(sd.day_score)+least(300,coalesce(g.gift_count,0)*10),2) score,
      sum(sd.volume) trade_volume,sum(sd.trades)::integer trade_count,sum(sd.realized_pnl) profit,
      coalesce(g.gift_count,0) gift_count,sum(sd.active_day)::integer active_days
    from scored_days sd left join gifts g on g.profile_id=sd.profile_id group by sd.profile_id,g.gift_count
  )
  insert into public.league_season_entries(season_id,profile_id,score,trade_volume,trade_count,profit,gift_count,active_days,updated_at)
  select v_season.id,t.profile_id,t.score,t.trade_volume,t.trade_count,t.profit,t.gift_count,t.active_days,now()
  from totals t join public.profiles p on p.id=t.profile_id
  where not coalesce(p.is_system,false) and not coalesce(p.hidden_from_leaderboard,false)
    and not (coalesce(p.is_banned,false) and (p.banned_until is null or p.banned_until>now()))
  on conflict(season_id,profile_id) do update set score=excluded.score,trade_volume=excluded.trade_volume,trade_count=excluded.trade_count,profit=excluded.profit,gift_count=excluded.gift_count,active_days=excluded.active_days,updated_at=now();

  delete from public.league_season_entries e where e.season_id=v_season.id and not exists(
    select 1 from public.league_daily_stats_v074 d where d.season_id=v_season.id and d.profile_id=e.profile_id
  );
  with ranked as (
    select season_id,profile_id,rank() over(order by score desc,active_days desc,profit desc,profile_id)::integer next_rank
    from public.league_season_entries where season_id=v_season.id
  ) update public.league_season_entries e set rank=r.next_rank from ranked r where e.season_id=r.season_id and e.profile_id=r.profile_id;
end;$$;

create or replace function public.league_division_v074(p_score numeric)
returns jsonb language sql immutable as $$
  select case
    when coalesce(p_score,0)>=7500 then jsonb_build_object('key','apex','label','Apex','floor',7500,'nextScore',null)
    when coalesce(p_score,0)>=4000 then jsonb_build_object('key','diamond','label','Diamond','floor',4000,'nextScore',7500)
    when coalesce(p_score,0)>=1800 then jsonb_build_object('key','gold','label','Gold','floor',1800,'nextScore',4000)
    when coalesce(p_score,0)>=600 then jsonb_build_object('key','silver','label','Silver','floor',600,'nextScore',1800)
    else jsonb_build_object('key','bronze','label','Bronze','floor',0,'nextScore',600) end;
$$;

create or replace function public.league_snapshot_v0722(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_season_id uuid; v_season public.league_seasons; v_me public.league_season_entries; v_next public.league_season_entries; v_division jsonb;
begin
  perform public.finalize_league_seasons_v0722();
  v_season_id:=public.ensure_league_season_v0722();
  -- Compact rollups only. This no longer scans trades/gift_trades per profile.
  perform public.refresh_league_entries_v0722(v_season_id);
  select * into v_season from public.league_seasons where id=v_season_id;
  select * into v_me from public.league_season_entries where season_id=v_season_id and profile_id=p_profile_id;
  if v_me.profile_id is not null and v_me.rank>1 then
    select * into v_next from public.league_season_entries where season_id=v_season_id and rank<v_me.rank order by rank desc limit 1;
  end if;
  v_division:=public.league_division_v074(coalesce(v_me.score,0));
  return jsonb_build_object(
    'season',jsonb_build_object('id',v_season.id,'title',v_season.title,'startsAt',v_season.starts_at,'endsAt',v_season.ends_at,'daysLeft',greatest(0,ceil(extract(epoch from(v_season.ends_at-now()))/86400.0)::integer)),
    'me',case when v_me.profile_id is null then jsonb_build_object('rank',null,'score',0,'tradeVolume',0,'tradeCount',0,'profit',0,'giftCount',0,'activeDays',0,'gapToNext',null,'division',v_division,'nextDivisionScore',600,'divisionProgress',0)
      else jsonb_build_object('rank',v_me.rank,'score',v_me.score,'tradeVolume',v_me.trade_volume,'tradeCount',v_me.trade_count,'profit',v_me.profit,'giftCount',v_me.gift_count,'activeDays',v_me.active_days,
        'gapToNext',case when v_me.rank>1 then greatest(0,coalesce(v_next.score,v_me.score)-v_me.score) else 0 end,'division',v_division,
        'nextDivisionScore',v_division->'nextScore','divisionProgress',case when (v_division->>'nextScore') is null then 100 else round(100*greatest(0,v_me.score-(v_division->>'floor')::numeric)/greatest(1,(v_division->>'nextScore')::numeric-(v_division->>'floor')::numeric),1) end) end,
    'leaders',coalesce((select jsonb_agg(jsonb_build_object('rank',e.rank,'id',p.id,'name',coalesce(nullif(p.username,''),p.first_name),'photoUrl',p.photo_url,'frame',p.equipped_profile_frame,'score',e.score,'profit',e.profit,'tradeVolume',e.trade_volume,'tradeCount',e.trade_count,'giftCount',e.gift_count,'activeDays',e.active_days,'division',public.league_division_v074(e.score)) order by e.rank)
      from public.league_season_entries e join public.profiles p on p.id=e.profile_id where e.season_id=v_season_id and e.rank<=100),'[]'::jsonb),
    'rewards',jsonb_build_array(jsonb_build_object('rank','1','title','League Founder','itemKey','league_founder_frame'),jsonb_build_object('rank','2–3','title','League Apex','itemKey','league_apex_frame'),jsonb_build_object('rank','4–25','title','League Challenger','itemKey','league_challenger_frame')),
    'scoring',jsonb_build_object('model','daily-capped-v074','dailyVolumeCapScore',120,'dailyTradeCapScore',100,'dailyDiversityCapScore',80,'activeDayScore',40)
  );
end;$$;

revoke execute on function public.league_record_daily_v074(uuid,timestamptz,numeric,numeric,integer,integer,numeric,integer,text) from public,anon,authenticated;
revoke execute on function public.league_division_v074(numeric) from public,anon,authenticated;
grant execute on function public.league_record_daily_v074(uuid,timestamptz,numeric,numeric,integer,integer,numeric,integer,text),public.league_division_v074(numeric) to service_role;

commit;
