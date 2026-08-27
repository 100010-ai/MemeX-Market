-- Monthly league is intentionally separate from the weekly battle pass.
create table if not exists public.league_seasons (
  id uuid primary key default gen_random_uuid(),
  season_key text not null unique,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check(status in ('active','finalized')),
  created_at timestamptz not null default now(),
  check(ends_at>starts_at)
);
create table if not exists public.league_season_entries (
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  score numeric not null default 0,
  trade_volume numeric not null default 0,
  trade_count integer not null default 0,
  profit numeric not null default 0,
  gift_count integer not null default 0,
  active_days integer not null default 0,
  rank integer,
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(season_id,profile_id)
);
create index if not exists league_entries_rank_v0722_idx on public.league_season_entries(season_id,score desc,profile_id);
create table if not exists public.league_hall_of_fame (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  rank integer not null check(rank between 1 and 100),
  score numeric not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(season_id,profile_id),unique(season_id,rank)
);
alter table public.league_seasons enable row level security;
alter table public.league_season_entries enable row level security;
alter table public.league_hall_of_fame enable row level security;
revoke all on public.league_seasons,public.league_season_entries,public.league_hall_of_fame from public,anon,authenticated;
grant all on public.league_seasons,public.league_season_entries,public.league_hall_of_fame to service_role;

create or replace function public.ensure_league_season_v0722()
returns uuid language plpgsql security definer set search_path=public as $$
declare v_start timestamptz:=date_trunc('month',now()); v_end timestamptz:=v_start+interval '1 month'; v_id uuid;
begin
  insert into public.league_seasons(season_key,title,starts_at,ends_at,status)
  values('league-'||to_char(v_start,'YYYY-MM'),'MemeX League · '||to_char(v_start,'TMMonth YYYY'),v_start,v_end,'active')
  on conflict(season_key) do update set title=excluded.title
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.refresh_league_entries_v0722(p_season_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_season public.league_seasons;
begin
  select * into v_season from public.league_seasons where id=p_season_id for update;
  if not found then raise exception 'League season not found'; end if;
  insert into public.league_season_entries(season_id,profile_id,score,trade_volume,trade_count,profit,gift_count,active_days,updated_at)
  select v_season.id,p.id,
    round(
      least(6000,(coalesce(ct.volume,0)+coalesce(gt.volume,0))*0.08) +
      least(3000,(coalesce(ct.count,0)+coalesce(gt.count,0))*45) +
      greatest(-1500,least(3500,(coalesce(ct.pnl,0)+coalesce(gt.pnl,0))*12)) +
      least(1800,coalesce(gc.count,0)*90) +
      least(1500,coalesce(ad.days,0)*75)
    ,2),
    coalesce(ct.volume,0)+coalesce(gt.volume,0),coalesce(ct.count,0)+coalesce(gt.count,0),
    coalesce(ct.pnl,0)+coalesce(gt.pnl,0),coalesce(gc.count,0),coalesce(ad.days,0),now()
  from public.profiles p
  left join lateral (
    select coalesce(sum(t.quote_amount),0) volume,count(*)::integer count,coalesce(sum(t.realized_pnl),0) pnl
    from public.trades t where t.profile_id=p.id and t.created_at>=v_season.starts_at and t.created_at<v_season.ends_at and not coalesce(t.is_launch_seed,false)
  ) ct on true
  left join lateral (
    select coalesce(sum(g.price),0) volume,count(*)::integer count,coalesce(sum(case when g.seller_profile_id=p.id then g.realized_pnl else 0 end),0) pnl
    from public.gift_trades g where (g.buyer_profile_id=p.id or g.seller_profile_id=p.id) and g.created_at>=v_season.starts_at and g.created_at<v_season.ends_at
  ) gt on true
  left join lateral (
    select count(*)::integer count from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
    where vg.owner_profile_id=p.id and not coalesce(ga.is_burned,false)
  ) gc on true
  left join lateral (
    select count(distinct date_trunc('day',e.created_at))::integer days from public.market_events e
    where e.actor_profile_id=p.id and e.created_at>=v_season.starts_at and e.created_at<v_season.ends_at
  ) ad on true
  where not coalesce(p.is_system,false) and not coalesce(p.hidden_from_leaderboard,false)
    and not (coalesce(p.is_banned,false) and (p.banned_until is null or p.banned_until>now()))
  on conflict(season_id,profile_id) do update set
    score=excluded.score,trade_volume=excluded.trade_volume,trade_count=excluded.trade_count,profit=excluded.profit,
    gift_count=excluded.gift_count,active_days=excluded.active_days,updated_at=now();
  with ranked as (
    select season_id,profile_id,rank() over(order by score desc,profile_id)::integer as next_rank
    from public.league_season_entries where season_id=v_season.id
  ) update public.league_season_entries e set rank=r.next_rank
  from ranked r where e.season_id=r.season_id and e.profile_id=r.profile_id;
end;
$$;

create or replace function public.finalize_league_seasons_v0722()
returns void language plpgsql security definer set search_path=public as $$
declare s public.league_seasons; e public.league_season_entries; v_item text; v_meta jsonb;
begin
  for s in select * from public.league_seasons where status='active' and ends_at<=now() for update loop
    perform public.refresh_league_entries_v0722(s.id);
    insert into public.league_hall_of_fame(season_id,profile_id,rank,score,snapshot)
    select e.season_id,e.profile_id,e.rank,e.score,jsonb_build_object(
      'tradeVolume',e.trade_volume,'tradeCount',e.trade_count,'profit',e.profit,'giftCount',e.gift_count,'activeDays',e.active_days)
    from public.league_season_entries e where e.season_id=s.id and e.rank<=100
    on conflict(season_id,profile_id) do nothing;
    for e in select * from public.league_season_entries where season_id=s.id and rank<=25 order by rank loop
      v_item:=case when e.rank=1 then 'league_founder_frame' when e.rank<=3 then 'league_apex_frame' else 'league_challenger_frame' end;
      v_meta:=jsonb_build_object('itemKey',v_item,'duplicateMxm',case when e.rank=1 then 30000 when e.rank<=3 then 15000 else 5200 end,'label',v_item);
      perform public.grant_virtual_reward_v200(e.profile_id,'profile_item',1,v_meta,'league',s.id);
      if e.rank<=3 then perform public.grant_virtual_reward_v200(e.profile_id,'case',1,jsonb_build_object('sku','case_league','label','League Vault'),'league',s.id); end if;
    end loop;
    update public.league_seasons set status='finalized' where id=s.id;
  end loop;
end;
$$;

create or replace function public.league_snapshot_v0722(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_season_id uuid; v_me public.league_season_entries; v_next public.league_season_entries; v_season public.league_seasons;
begin
  perform public.finalize_league_seasons_v0722();
  v_season_id:=public.ensure_league_season_v0722();
  perform public.refresh_league_entries_v0722(v_season_id);
  select * into v_season from public.league_seasons where id=v_season_id;
  select * into v_me from public.league_season_entries where season_id=v_season_id and profile_id=p_profile_id;
  select * into v_next from public.league_season_entries where season_id=v_season_id and rank=greatest(1,coalesce(v_me.rank,1)-1);
  return jsonb_build_object(
    'season',jsonb_build_object('id',v_season.id,'title',v_season.title,'startsAt',v_season.starts_at,'endsAt',v_season.ends_at,'daysLeft',greatest(0,ceil(extract(epoch from(v_season.ends_at-now()))/86400.0)::integer)),
    'me',case when v_me.profile_id is null then jsonb_build_object('rank',null,'score',0,'tradeVolume',0,'tradeCount',0,'profit',0,'giftCount',0,'activeDays',0,'gapToNext',null)
      else jsonb_build_object('rank',v_me.rank,'score',v_me.score,'tradeVolume',v_me.trade_volume,'tradeCount',v_me.trade_count,'profit',v_me.profit,'giftCount',v_me.gift_count,'activeDays',v_me.active_days,
        'gapToNext',case when v_me.rank>1 then greatest(0,coalesce(v_next.score,v_me.score)-v_me.score) else 0 end) end,
    'leaders',coalesce((select jsonb_agg(jsonb_build_object('rank',e.rank,'id',p.id,'name',coalesce(nullif(p.username,''),p.first_name),'photoUrl',p.photo_url,'frame',p.equipped_profile_frame,'score',e.score,'profit',e.profit,'tradeVolume',e.trade_volume,'tradeCount',e.trade_count,'giftCount',e.gift_count,'activeDays',e.active_days) order by e.rank)
      from public.league_season_entries e join public.profiles p on p.id=e.profile_id where e.season_id=v_season_id and e.rank<=100),'[]'::jsonb),
    'rewards',jsonb_build_array(
      jsonb_build_object('rank','1','title','League Founder','itemKey','league_founder_frame'),
      jsonb_build_object('rank','2–3','title','League Apex','itemKey','league_apex_frame'),
      jsonb_build_object('rank','4–25','title','League Challenger','itemKey','league_challenger_frame')
    )
  );
end;
$$;

create or replace function public.market_radar_snapshot_v0722()
returns jsonb language sql security definer set search_path=public stable as $$
  with hot_gifts as (
    select ga.id,ga.base_name,ga.gift_number,ga.model_preview_url,ga.model_media_url,ga.telegram_resale_price_ton,
      count(gt.id)::integer trade_count,coalesce(sum(gt.price),0) volume
    from public.gift_assets ga join public.gift_trades gt on gt.asset_id=ga.id
    where gt.created_at>=now()-interval '24 hours' and not coalesce(ga.is_burned,false)
    group by ga.id order by volume desc,trade_count desc limit 6
  ), hot_coins as (
    select c.id,c.name,c.symbol,c.image_url,
      coalesce(t.volume,0) as volume_24h,coalesce(t.trade_count,0) as trade_count_24h,
      case when coalesce(old.close,0)>0 then round(100*(c.current_price-old.close)/old.close,2) else 0 end as change_24h
    from public.coins c
    left join lateral (
      select coalesce(sum(t.quote_amount),0) as volume,count(*)::integer as trade_count
      from public.trades t where t.coin_id=c.id and t.created_at>=now()-interval '24 hours'
    ) t on true
    left join lateral (
      select ca.close from public.candles ca where ca.coin_id=c.id and ca.bucket_start<=now()-interval '24 hours'
      order by ca.bucket_start desc limit 1
    ) old on true
    where c.status='active' and not coalesce(c.hidden_from_market,false)
    order by (greatest(case when coalesce(old.close,0)>0 then 100*(c.current_price-old.close)/old.close else 0 end,0)*2+ln(1+coalesce(t.volume,0))*10) desc,coalesce(t.trade_count,0) desc limit 6
  ), activity as (
    select count(*)::integer trade_count,coalesce(sum(quote_amount),0) volume from public.trades where created_at>=now()-interval '24 hours'
  )
  select jsonb_build_object(
    'gifts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',base_name||' #'||gift_number,'imageUrl',coalesce(model_preview_url,model_media_url),'volume',volume,'tradeCount',trade_count)) from hot_gifts),'[]'::jsonb),
    'coins',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'symbol',symbol,'imageUrl',image_url,'change24h',change_24h,'volume24h',volume_24h,'tradeCount24h',trade_count_24h)) from hot_coins),'[]'::jsonb),
    'activity',(select jsonb_build_object('tradeCount',trade_count,'volume',volume) from activity)
  );
$$;

create or replace function public.league_hall_of_fame_snapshot_v0722()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.finalize_league_seasons_v0722();
  return jsonb_build_object('seasons',coalesce((
    select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'startsAt',s.starts_at,'endsAt',s.ends_at,'winners',coalesce(w.winners,'[]'::jsonb)) order by s.ends_at desc)
    from public.league_seasons s left join lateral (
      select jsonb_agg(jsonb_build_object('rank',h.rank,'id',p.id,'name',coalesce(nullif(p.username,''),p.first_name),'photoUrl',p.photo_url,'score',h.score,'profit',h.snapshot->>'profit','tradeVolume',h.snapshot->>'tradeVolume') order by h.rank) winners
      from public.league_hall_of_fame h join public.profiles p on p.id=h.profile_id where h.season_id=s.id and h.rank<=10
    ) w on true where s.status='finalized'
  ),'[]'::jsonb));
end;
$$;
