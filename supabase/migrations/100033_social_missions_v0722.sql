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
