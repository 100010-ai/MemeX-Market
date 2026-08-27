begin;

-- MemeX v0.72.2: social market loop.  The trading balance remains virtual TON;
-- missions and cosmetics only credit MXM, XP, cases and profile items.

alter table public.missions add column if not exists xp_reward integer not null default 8;
alter table public.missions add column if not exists reward_kind text not null default 'mxm_coins';
alter table public.missions add column if not exists reward_metadata jsonb not null default '{}'::jsonb;
alter table public.missions drop constraint if exists missions_xp_reward_v0722_check;
alter table public.missions add constraint missions_xp_reward_v0722_check check (xp_reward between 0 and 10000) not valid;
alter table public.missions drop constraint if exists missions_reward_kind_v0722_check;
alter table public.missions add constraint missions_reward_kind_v0722_check check (reward_kind in ('mxm_coins','case','profile_item','energy')) not valid;

-- Retire passive and unrelated missions. Existing claimed history remains intact.
update public.missions set active=false, updated_at=now()
where key in ('open_app','daily_game_3');

-- Existing market missions now award game currency, never virtual TON.
update public.missions
set reward_kind='mxm_coins', reward_metadata='{}'::jsonb,
    xp_reward=case
      when period='daily' then 12
      when period='weekly' then 40
      else 24
    end,
    updated_at=now()
where active=true;

insert into public.profile_items(item_key,item_type,title,rarity,metadata,active) values
  ('league_challenger_frame','frame','League Challenger','epic','{"source":"league","asset":"/assets/league/frame-challenger.png","motion":"pulse","exclusive":true}'::jsonb,true),
  ('league_apex_frame','frame','League Apex','legendary','{"source":"league","asset":"/assets/league/frame-apex.png","motion":"scan","exclusive":true}'::jsonb,true),
  ('league_founder_frame','frame','League Founder','legendary','{"source":"league","asset":"/assets/league/frame-founder.png","motion":"drift","exclusive":true}'::jsonb,true),
  ('mission_pathfinder_badge','badge','Market Pathfinder','epic','{"source":"missions","exclusive":true}'::jsonb,true),
  ('mission_early_bird_badge','badge','Early Investor','epic','{"source":"missions","exclusive":true}'::jsonb,true)
on conflict(item_key) do update set
  item_type=excluded.item_type,title=excluded.title,rarity=excluded.rarity,
  metadata=excluded.metadata,active=excluded.active;

-- These are server-side evaluated from existing trade and gift tables, so an
-- action can never be fabricated by the client.
insert into public.missions(key,period,title,description,reward,target,action_type,sort_order,active,xp_reward,reward_kind,reward_metadata) values
  ('gift_collector_weekly','weekly','Gift Collector','Купите 5 разных Telegram Gifts за неделю.',650,5,'gift_collector',145,true,55,'mxm_coins','{}'::jsonb),
  ('active_trader_weekly','weekly','Active Trader','Совершите 20 рыночных сделок за неделю.',900,20,'active_trader',146,true,80,'mxm_coins','{}'::jsonb),
  ('early_investor_weekly','weekly','Early Investor','Купите мемкоин в первые 24 часа после запуска.',1,1,'early_investor',147,true,90,'profile_item','{"itemKey":"mission_early_bird_badge","duplicateMxm":900,"label":"Значок Early Investor"}'::jsonb),
  ('market_pathfinder_weekly','weekly','Market Pathfinder','Соберите 3 сделки с разными коллекциями Gifts.',1,3,'market_pathfinder',148,true,70,'profile_item','{"itemKey":"mission_pathfinder_badge","duplicateMxm":650,"label":"Значок Market Pathfinder"}'::jsonb)
on conflict(key) do update set
  period=excluded.period,title=excluded.title,description=excluded.description,reward=excluded.reward,
  target=excluded.target,action_type=excluded.action_type,sort_order=excluded.sort_order,active=excluded.active,
  xp_reward=excluded.xp_reward,reward_kind=excluded.reward_kind,reward_metadata=excluded.reward_metadata,updated_at=now();

create or replace function public.refresh_market_mission_progress_v0722(p_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_mission public.missions;
  v_period_key text;
  v_start timestamptz;
  v_progress integer;
begin
  for v_mission in
    select * from public.missions
    where active=true and key in ('gift_collector_weekly','active_trader_weekly','early_investor_weekly','market_pathfinder_weekly')
  loop
    v_period_key:=public.mission_period_key(v_mission.period);
    v_start:=case v_mission.period
      when 'daily' then date_trunc('day',now())
      when 'weekly' then date_trunc('week',now())
      else '-infinity'::timestamptz
    end;
    v_progress:=case v_mission.key
      when 'gift_collector_weekly' then (
        select count(distinct ga.base_name)::integer
        from public.gift_trades gt join public.gift_assets ga on ga.id=gt.asset_id
        where gt.buyer_profile_id=p_profile_id and gt.created_at>=v_start
      )
      when 'active_trader_weekly' then (
        (select count(*)::integer from public.trades t where t.profile_id=p_profile_id and t.created_at>=v_start and not coalesce(t.is_launch_seed,false)) +
        (select count(*)::integer from public.gift_trades gt where (gt.buyer_profile_id=p_profile_id or gt.seller_profile_id=p_profile_id) and gt.created_at>=v_start)
      )
      when 'early_investor_weekly' then (
        select count(*)::integer from public.trades t join public.coins c on c.id=t.coin_id
        where t.profile_id=p_profile_id and t.side='buy' and t.created_at>=v_start and t.created_at<c.created_at+interval '24 hours'
      )
      when 'market_pathfinder_weekly' then (
        select count(distinct ga.base_name)::integer
        from public.gift_trades gt join public.gift_assets ga on ga.id=gt.asset_id
        where (gt.buyer_profile_id=p_profile_id or gt.seller_profile_id=p_profile_id) and gt.created_at>=v_start
      )
      else 0
    end;
    update public.user_missions um
    set progress=least(v_mission.target,greatest(0,coalesce(v_progress,0))),updated_at=now()
    where um.profile_id=p_profile_id and um.mission_id=v_mission.id and um.period_key=v_period_key and um.claimed_at is null;
  end loop;
end;
$$;

create or replace function public.ensure_user_missions(p_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.user_missions(profile_id,mission_id,period_key,progress)
  select p_profile_id,m.id,public.mission_period_key(m.period),0
  from public.missions m where m.active=true
  on conflict(profile_id,mission_id,period_key) do nothing;
  perform public.refresh_market_mission_progress_v0722(p_profile_id);
end;
$$;

create or replace function public.xp_from_mission_claim_v06()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_xp integer:=8;
begin
  if old.claimed_at is null and new.claimed_at is not null then
    select xp_reward into v_xp from public.missions where id=new.mission_id;
    perform public.award_profile_xp(new.profile_id,'mission:'||new.mission_id::text||':'||new.period_key,greatest(0,coalesce(v_xp,8)));
  end if;
  return new;
end;
$$;

create or replace function public.claim_mission(p_profile_id uuid,p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_um public.user_missions;
  v_mission public.missions;
  v_key text;
  v_channel public.telegram_channel_task_state_v700;
  v_reward jsonb;
  v_mxm bigint:=0;
begin
  perform public.ensure_user_missions(p_profile_id);
  select * into v_mission from public.missions where id=p_mission_id and active=true;
  if not found then raise exception 'Задание недоступно'; end if;
  v_key:=public.mission_period_key(v_mission.period);
  select * into v_um from public.user_missions
  where profile_id=p_profile_id and mission_id=p_mission_id and period_key=v_key for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if v_um.claimed_at is not null then raise exception 'Награда уже получена'; end if;
  if v_um.progress<v_mission.target then raise exception 'Задание ещё не выполнено'; end if;
  if v_mission.key='join_main_channel' then
    select * into v_channel from public.telegram_channel_task_state_v700 where profile_id=p_profile_id for update;
    if not found or v_channel.currently_member is distinct from true or v_channel.last_verified_at is null
      or v_channel.last_verified_at<now()-interval '2 minutes' or v_channel.revoked_at is not null then
      raise exception 'Сначала подтвердите подписку на @Meme_X_Market';
    end if;
  end if;
  update public.user_missions set claimed_at=now(),updated_at=now()
  where profile_id=p_profile_id and mission_id=p_mission_id and period_key=v_key;
  v_reward:=public.grant_virtual_reward_v200(p_profile_id,v_mission.reward_kind,greatest(1,v_mission.reward::integer),
    coalesce(v_mission.reward_metadata,'{}'::jsonb)||jsonb_build_object('label',v_mission.title),'mission',v_mission.id);
  select mxm_coins into v_mxm from public.profiles where id=p_profile_id;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'mission',case when v_reward->>'kind'='mxm_coins' then coalesce((v_reward->>'amount')::numeric,0) else 0 end,p_mission_id,
    jsonb_build_object('key',v_mission.key,'period',v_mission.period,'unit','mxm','reward',v_reward,'xp',v_mission.xp_reward));
  if v_mission.key='join_main_channel' then
    update public.telegram_channel_task_state_v700 set rewarded_at=now(),reward_amount=0,recovered_amount=0,clawback_due=0,updated_at=now()
    where profile_id=p_profile_id;
  end if;
  return jsonb_build_object('reward',v_reward,'mxmCoins',coalesce(v_mxm,0),'xpAwarded',v_mission.xp_reward);
end;
$$;

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

-- More MXM-only cases. The shop purchases these through mxm_sink_products;
-- Telegram Stars remain limited to currency top-ups.
insert into public.store_products(sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata,active) values
  ('case_nebula','cases','Nebula Cache','Кейс за MXM с шансом на космическую рамку.',5,'1 кейс Nebula Cache','Новый',351,'{"caseTier":"rare","purchaseCurrency":"mxm","asset":"/assets/cases/nebula-cache.png"}'::jsonb,true),
  ('case_prism','cases','Prism Circuit','Коллекционный кейс за MXM с редкой визуальной серией.',5,'1 кейс Prism Circuit','Лимит',352,'{"caseTier":"epic","purchaseCurrency":"mxm","asset":"/assets/cases/prism-circuit.png"}'::jsonb,true),
  ('case_league','cases','League Vault','Сезонный наградной кейс. В магазине не продаётся.',5,'League Vault','League',353,'{"caseTier":"legendary","purchaseCurrency":"none","asset":"/assets/cases/league-vault.png"}'::jsonb,true)
on conflict(sku) do update set category=excluded.category,title=excluded.title,description=excluded.description,stars_price=excluded.stars_price,reward_label=excluded.reward_label,badge=excluded.badge,sort_order=excluded.sort_order,metadata=excluded.metadata,active=true,updated_at=now();

insert into public.case_definitions(sku,title,tier,description,remaining_supply,active,rare_pity,epic_pity,legendary_pity) values
  ('case_nebula','Nebula Cache','rare','Космическая серия с редкими рамками и косметикой.',24000,true,5,12,30),
  ('case_prism','Prism Circuit','rare','Лимитированная серия с яркими коллекционными предметами.',12000,true,4,9,20),
  ('case_league','League Vault','legendary','Наградной кейс MemeX League, доступен только через сезонные награды.',null,true,null,4,10)
on conflict(sku) do update set title=excluded.title,tier=excluded.tier,description=excluded.description,active=true,
  rare_pity=excluded.rare_pity,epic_pity=excluded.epic_pity,legendary_pity=excluded.legendary_pity;

insert into public.mxm_sink_products(sku,mxm_price,sort_order,active) values
  ('case_nebula',7200,351,true),('case_prism',12800,352,true)
on conflict(sku) do update set mxm_price=excluded.mxm_price,sort_order=excluded.sort_order,active=true;

delete from public.case_loot_definitions where case_sku in ('case_nebula','case_prism','case_league');
insert into public.case_loot_definitions(case_sku,reward_key,reward_kind,reward_label,amount,weight,rarity,metadata,active) values
  ('case_nebula','mxm_1000','mxm_coins','1 000 MXM',1000,3600,'common','{}',true),
  ('case_nebula','energy_75','energy','75 энергии',75,2100,'rare','{}',true),
  ('case_nebula','mxm_3200','mxm_coins','3 200 MXM',3200,3000,'rare','{}',true),
  ('case_nebula','challenger_frame','profile_item','Рамка League Challenger',1,1100,'epic','{"itemKey":"league_challenger_frame","duplicateMxm":5200}',true),
  ('case_nebula','mxm_12000','mxm_coins','12 000 MXM',12000,200,'legendary','{}',true),
  ('case_prism','mxm_2600','mxm_coins','2 600 MXM',2600,2600,'rare','{}',true),
  ('case_prism','energy_120','energy','120 энергии',120,1600,'rare','{}',true),
  ('case_prism','mxm_8500','mxm_coins','8 500 MXM',8500,3300,'epic','{}',true),
  ('case_prism','apex_frame','profile_item','Рамка League Apex',1,1800,'legendary','{"itemKey":"league_apex_frame","duplicateMxm":15000}',true),
  ('case_prism','mxm_24000','mxm_coins','24 000 MXM',24000,700,'legendary','{}',true),
  ('case_league','challenger_frame','profile_item','Рамка League Challenger',1,6500,'epic','{"itemKey":"league_challenger_frame","duplicateMxm":5200}',true),
  ('case_league','apex_frame','profile_item','Рамка League Apex',1,2800,'legendary','{"itemKey":"league_apex_frame","duplicateMxm":15000}',true),
  ('case_league','founder_frame','profile_item','Рамка League Founder',1,700,'legendary','{"itemKey":"league_founder_frame","duplicateMxm":30000}',true);

revoke execute on function public.refresh_market_mission_progress_v0722(uuid),public.ensure_league_season_v0722(),
  public.refresh_league_entries_v0722(uuid),public.finalize_league_seasons_v0722(),public.league_snapshot_v0722(uuid),
  public.market_radar_snapshot_v0722(),public.league_hall_of_fame_snapshot_v0722() from public,anon,authenticated;
grant execute on function public.refresh_market_mission_progress_v0722(uuid),public.ensure_league_season_v0722(),
  public.refresh_league_entries_v0722(uuid),public.finalize_league_seasons_v0722(),public.league_snapshot_v0722(uuid),
  public.market_radar_snapshot_v0722(),public.league_hall_of_fame_snapshot_v0722() to service_role;
notify pgrst,'reload schema';
commit;
