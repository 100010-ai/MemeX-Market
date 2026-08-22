begin;

-- MXM v0.64 — Progression Update.
-- Adds long-term account progression, daily streaks, achievement progress,
-- Collection Book milestones, case pity guarantees and season prestige.
-- All reward decisions remain database-authoritative and service-role only.

-- Keep the terminal no-ad ledger policy while registering v0.64 progression events.
alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events drop constraint if exists economy_events_kind_v028_check;
alter table public.economy_events drop constraint if exists economy_events_kind_v064_check;
alter table public.economy_events add constraint economy_events_kind_v064_check check(kind in (
  'coin_launch','coin_trade_fee','coin_creator_fee','coin_platform_fee','mission',
  'admin','system','stars','store','case','season','premium','referral',
  'promo_code','collection_bonus','account_level','collection_book','season_prestige'
)) not valid;

-- ---------------------------------------------------------------------------
-- 1. Account levels 1..100 + long-term milestone rewards.
-- ---------------------------------------------------------------------------

insert into public.profile_items(item_key,item_type,title,rarity,metadata,active) values
  ('account_vanguard_frame','frame','Vanguard 100','legendary','{"source":"account_level","level":100}'::jsonb,true),
  ('season_prestige_frame','frame','Prestige Orbit','legendary','{"source":"season_prestige","prestigeLevel":10}'::jsonb,true),
  ('level_25_badge','badge','Уровень 25','rare','{"source":"account_level","level":25}'::jsonb,true),
  ('level_50_badge','badge','Уровень 50','epic','{"source":"account_level","level":50}'::jsonb,true),
  ('level_75_badge','badge','Уровень 75','epic','{"source":"account_level","level":75}'::jsonb,true),
  ('level_100_badge','badge','Уровень 100','legendary','{"source":"account_level","level":100}'::jsonb,true)
on conflict(item_key) do update set
  item_type=excluded.item_type,title=excluded.title,rarity=excluded.rarity,metadata=excluded.metadata,active=true;

create table if not exists public.account_level_rewards (
  level integer primary key check(level between 2 and 100),
  reward_kind text not null check(reward_kind in ('mxm_coins','energy','case','profile_item')),
  reward_label text not null,
  amount integer not null check(amount between 1 and 1000000),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true
);

insert into public.account_level_rewards(level,reward_kind,reward_label,amount,metadata,active) values
  (5,'mxm_coins','300 MXM',300,'{}'::jsonb,true),
  (10,'case','Стартовый кейс',1,'{"sku":"case_starter"}'::jsonb,true),
  (20,'mxm_coins','1 000 MXM',1000,'{}'::jsonb,true),
  (25,'profile_item','Значок «Уровень 25»',1,'{"itemKey":"level_25_badge","duplicateMxm":800}'::jsonb,true),
  (30,'case','Market Drop',1,'{"sku":"case_market"}'::jsonb,true),
  (40,'mxm_coins','2 500 MXM',2500,'{}'::jsonb,true),
  (50,'profile_item','Значок «Уровень 50»',1,'{"itemKey":"level_50_badge","duplicateMxm":1800}'::jsonb,true),
  (60,'case','Редкий кейс',1,'{"sku":"case_rare"}'::jsonb,true),
  (75,'profile_item','Значок «Уровень 75»',1,'{"itemKey":"level_75_badge","duplicateMxm":3000}'::jsonb,true),
  (90,'case','Легендарный кейс',1,'{"sku":"case_legendary"}'::jsonb,true),
  (100,'profile_item','Рамка Vanguard 100',1,'{"itemKey":"account_vanguard_frame","duplicateMxm":12000}'::jsonb,true)
on conflict(level) do update set reward_kind=excluded.reward_kind,reward_label=excluded.reward_label,
  amount=excluded.amount,metadata=excluded.metadata,active=excluded.active;

create table if not exists public.profile_level_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  level integer not null references public.account_level_rewards(level) on delete restrict,
  reward jsonb not null default '{}'::jsonb,
  claimed_at timestamptz not null default now(),
  primary key(profile_id,level)
);
create index if not exists profile_level_claims_profile_v064_idx on public.profile_level_claims(profile_id,claimed_at desc);

alter table public.account_level_rewards enable row level security;
alter table public.profile_level_claims enable row level security;
revoke all on public.account_level_rewards from public,anon,authenticated;
revoke all on public.profile_level_claims from public,anon,authenticated;
grant all on public.account_level_rewards to service_role;
grant all on public.profile_level_claims to service_role;

create or replace function public.account_level_v064(p_xp bigint)
returns integer language sql immutable parallel safe as $$
  select least(100,greatest(1,floor(sqrt(greatest(coalesce(p_xp,0),0)::numeric/10.0))::integer+1));
$$;

create or replace function public.account_progression_snapshot_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_xp bigint:=0;
  v_level integer:=1;
  v_start bigint:=0;
  v_next bigint:=10;
  v_progress numeric:=0;
  v_prestige integer:=0;
  v_rewards jsonb:='[]'::jsonb;
begin
  select xp into v_xp from public.profiles where id=p_profile_id;
  if not found then raise exception 'Profile not found'; end if;
  v_xp:=greatest(coalesce(v_xp,0),0);
  v_level:=public.account_level_v064(v_xp);
  if v_level<100 then
    v_start:=10*(v_level-1)*(v_level-1);
    v_next:=10*v_level*v_level;
    v_progress:=least(1,greatest(0,(v_xp-v_start)::numeric/greatest(1,v_next-v_start)));
  elsif v_xp<100000 then
    v_start:=98010;
    v_next:=100000;
    v_progress:=least(1,greatest(0,(v_xp-v_start)::numeric/greatest(1,v_next-v_start)));
  else
    v_start:=100000 + floor((v_xp-100000)::numeric/25000)*25000;
    v_next:=v_start+25000;
    v_progress:=least(1,greatest(0,(v_xp-v_start)::numeric/25000));
    v_prestige:=floor((v_xp-100000)::numeric/25000)::integer;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'level',r.level,'kind',r.reward_kind,'label',r.reward_label,'amount',r.amount,
    'unlocked',r.level<=v_level,'claimed',c.profile_id is not null
  ) order by r.level),'[]'::jsonb) into v_rewards
  from public.account_level_rewards r
  left join public.profile_level_claims c on c.profile_id=p_profile_id and c.level=r.level
  where r.active=true;

  return jsonb_build_object(
    'xp',v_xp,'level',v_level,'levelProgress',v_progress,
    'levelStartXp',v_start,'nextLevelXp',v_next,'xpForNext',greatest(0,v_next-v_xp),
    'prestigeLevel',v_prestige,'rewards',v_rewards
  );
end;
$$;

create or replace function public.claim_account_level_reward_v064(p_profile_id uuid,p_level integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_reward public.account_level_rewards;
  v_level integer;
  v_existing public.profile_level_claims;
  v_grant jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('account-level:'||p_profile_id::text||':'||coalesce(p_level,0)::text,0));
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into v_existing from public.profile_level_claims where profile_id=p_profile_id and level=p_level;
  if found then return jsonb_build_object('status','claimed','alreadyClaimed',true,'level',p_level,'reward',v_existing.reward); end if;
  select * into v_reward from public.account_level_rewards where level=p_level and active=true;
  if not found then raise exception 'Level reward not found'; end if;
  v_level:=public.account_level_v064(v_profile.xp);
  if v_level<p_level then raise exception 'Account level reward is locked'; end if;
  v_grant:=public.grant_virtual_reward_v200(p_profile_id,v_reward.reward_kind,v_reward.amount,
    v_reward.metadata||jsonb_build_object('label',v_reward.reward_label),'account_level',p_profile_id);
  insert into public.profile_level_claims(profile_id,level,reward) values(p_profile_id,p_level,v_grant);
  insert into public.economy_events(profile_id,kind,amount,metadata)
  values(p_profile_id,'account_level',case when v_reward.reward_kind='mxm_coins' then v_reward.amount else 0 end,
    jsonb_build_object('unit',v_reward.reward_kind,'level',p_level,'reward',v_grant));
  return jsonb_build_object('status','claimed','alreadyClaimed',false,'level',p_level,'reward',v_grant);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Daily streak. Reset is UTC and every day is idempotent.
-- ---------------------------------------------------------------------------

create table if not exists public.daily_streak_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  current_streak integer not null default 0 check(current_streak>=0),
  best_streak integer not null default 0 check(best_streak>=0),
  last_claim_date date,
  total_claims integer not null default 0 check(total_claims>=0),
  updated_at timestamptz not null default now()
);
create table if not exists public.daily_streak_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  claim_date date not null,
  streak integer not null check(streak>0),
  cycle_day integer not null check(cycle_day between 1 and 7),
  reward jsonb not null,
  claimed_at timestamptz not null default now(),
  primary key(profile_id,claim_date)
);
create index if not exists daily_streak_claims_profile_v064_idx on public.daily_streak_claims(profile_id,claimed_at desc);
alter table public.daily_streak_state enable row level security;
alter table public.daily_streak_claims enable row level security;
revoke all on public.daily_streak_state from public,anon,authenticated;
revoke all on public.daily_streak_claims from public,anon,authenticated;
grant all on public.daily_streak_state to service_role;
grant all on public.daily_streak_claims to service_role;

create or replace function public.daily_streak_reward_v064(p_cycle_day integer)
returns jsonb language sql immutable parallel safe as $$
  select case p_cycle_day
    when 1 then jsonb_build_object('kind','mxm_coins','amount',75,'label','75 MXM','metadata','{}'::jsonb)
    when 2 then jsonb_build_object('kind','energy','amount',25,'label','25 энергии','metadata','{}'::jsonb)
    when 3 then jsonb_build_object('kind','mxm_coins','amount',150,'label','150 MXM','metadata','{}'::jsonb)
    when 4 then jsonb_build_object('kind','case','amount',1,'label','Стартовый кейс','metadata','{"sku":"case_starter"}'::jsonb)
    when 5 then jsonb_build_object('kind','mxm_coins','amount',300,'label','300 MXM','metadata','{}'::jsonb)
    when 6 then jsonb_build_object('kind','energy','amount',60,'label','60 энергии','metadata','{}'::jsonb)
    else jsonb_build_object('kind','case','amount',1,'label','Редкий кейс','metadata','{"sku":"case_rare"}'::jsonb)
  end;
$$;

create or replace function public.daily_streak_snapshot_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_state public.daily_streak_state;
  v_today date:=timezone('UTC',now())::date;
  v_effective integer:=0;
  v_next_day integer:=1;
  v_claimed_today boolean:=false;
  v_calendar jsonb:='[]'::jsonb;
  i integer;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  select * into v_state from public.daily_streak_state where profile_id=p_profile_id;
  if found then
    v_claimed_today:=v_state.last_claim_date=v_today;
    if v_state.last_claim_date=v_today or v_state.last_claim_date=v_today-1 then v_effective:=v_state.current_streak; else v_effective:=0; end if;
  end if;
  v_next_day:=(greatest(v_effective,0)%7)+1;
  for i in 1..7 loop
    v_calendar:=v_calendar||jsonb_build_array(public.daily_streak_reward_v064(i)||jsonb_build_object('day',i));
  end loop;
  return jsonb_build_object(
    'currentStreak',v_effective,'bestStreak',coalesce(v_state.best_streak,0),'totalClaims',coalesce(v_state.total_claims,0),
    'claimedToday',v_claimed_today,'canClaim',not v_claimed_today,'nextDay',v_next_day,
    'nextReward',public.daily_streak_reward_v064(v_next_day),'calendar',v_calendar,'resetTimezone','UTC'
  );
end;
$$;

create or replace function public.claim_daily_streak_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_state public.daily_streak_state;
  v_existing public.daily_streak_claims;
  v_today date:=timezone('UTC',now())::date;
  v_streak integer:=1;
  v_day integer:=1;
  v_spec jsonb;
  v_reward jsonb;
  v_reference uuid:=gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended('daily-streak:'||p_profile_id::text,0));
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into v_existing from public.daily_streak_claims where profile_id=p_profile_id and claim_date=v_today;
  if found then return jsonb_build_object('status','claimed','alreadyClaimed',true,'streak',v_existing.streak,'cycleDay',v_existing.cycle_day,'reward',v_existing.reward); end if;
  select * into v_state from public.daily_streak_state where profile_id=p_profile_id for update;
  if found and v_state.last_claim_date=v_today-1 then v_streak:=v_state.current_streak+1; else v_streak:=1; end if;
  v_day:=((v_streak-1)%7)+1;
  v_spec:=public.daily_streak_reward_v064(v_day);
  v_reward:=public.grant_virtual_reward_v200(p_profile_id,v_spec->>'kind',greatest(1,(v_spec->>'amount')::integer),
    coalesce(v_spec->'metadata','{}'::jsonb)||jsonb_build_object('label',v_spec->>'label'),'daily_streak',v_reference);
  insert into public.daily_streak_state(profile_id,current_streak,best_streak,last_claim_date,total_claims,updated_at)
  values(p_profile_id,v_streak,v_streak,v_today,1,now())
  on conflict(profile_id) do update set current_streak=excluded.current_streak,
    best_streak=greatest(public.daily_streak_state.best_streak,excluded.current_streak),last_claim_date=excluded.last_claim_date,
    total_claims=public.daily_streak_state.total_claims+1,updated_at=now();
  insert into public.daily_streak_claims(profile_id,claim_date,streak,cycle_day,reward)
  values(p_profile_id,v_today,v_streak,v_day,v_reward);
  perform public.award_profile_xp(p_profile_id,'daily-streak:'||v_today::text,5);
  return jsonb_build_object('status','claimed','alreadyClaimed',false,'streak',v_streak,'cycleDay',v_day,'reward',v_reward);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Collection Book: Model / Backdrop / Symbol coverage and milestone grants.
-- ---------------------------------------------------------------------------

create table if not exists public.collection_milestone_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  base_name text not null,
  milestone integer not null check(milestone in (25,50,75,100)),
  coverage integer not null check(coverage between 0 and 100),
  reward jsonb not null default '{}'::jsonb,
  claimed_at timestamptz not null default now(),
  primary key(profile_id,base_name,milestone)
);
create unique index if not exists collection_milestone_claims_canonical_v064_uidx
  on public.collection_milestone_claims(profile_id,lower(trim(base_name)),milestone);
create index if not exists collection_milestone_claims_profile_v064_idx on public.collection_milestone_claims(profile_id,claimed_at desc);
alter table public.collection_milestone_claims enable row level security;
revoke all on public.collection_milestone_claims from public,anon,authenticated;
grant all on public.collection_milestone_claims to service_role;

create or replace function public.collection_book_status_v064(p_profile_id uuid,p_base_name text)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_name text:=trim(coalesce(p_base_name,''));
  v_models_total integer:=0; v_models_owned integer:=0;
  v_backdrops_total integer:=0; v_backdrops_owned integer:=0;
  v_symbols_total integer:=0; v_symbols_owned integer:=0;
  v_dimensions integer:=0; v_sum numeric:=0; v_coverage integer:=0;
  v_claimed jsonb:='[]'::jsonb;
begin
  if char_length(v_name)<1 or char_length(v_name)>120 then raise exception 'Invalid collection name'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  select count(distinct nullif(trim(model_name),''))::integer,
         count(distinct nullif(trim(backdrop_name),''))::integer,
         count(distinct nullif(trim(symbol_name),''))::integer
    into v_models_total,v_backdrops_total,v_symbols_total
  from public.gift_assets where lower(trim(base_name))=lower(v_name) and coalesce(is_burned,false)=false;
  select count(distinct nullif(trim(ga.model_name),''))::integer,
         count(distinct nullif(trim(ga.backdrop_name),''))::integer,
         count(distinct nullif(trim(ga.symbol_name),''))::integer
    into v_models_owned,v_backdrops_owned,v_symbols_owned
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where vg.owner_profile_id=p_profile_id and lower(trim(ga.base_name))=lower(v_name) and coalesce(ga.is_burned,false)=false;
  if v_models_total>0 then v_dimensions:=v_dimensions+1; v_sum:=v_sum+least(1,v_models_owned::numeric/v_models_total); end if;
  if v_backdrops_total>0 then v_dimensions:=v_dimensions+1; v_sum:=v_sum+least(1,v_backdrops_owned::numeric/v_backdrops_total); end if;
  if v_symbols_total>0 then v_dimensions:=v_dimensions+1; v_sum:=v_sum+least(1,v_symbols_owned::numeric/v_symbols_total); end if;
  if v_dimensions>0 then v_coverage:=least(100,greatest(0,floor(100*v_sum/v_dimensions)::integer)); end if;
  select coalesce(jsonb_agg(milestone order by milestone),'[]'::jsonb) into v_claimed
  from public.collection_milestone_claims where profile_id=p_profile_id and lower(trim(base_name))=lower(v_name);
  return jsonb_build_object('baseName',v_name,'coverage',v_coverage,
    'models',jsonb_build_object('owned',v_models_owned,'total',v_models_total),
    'backdrops',jsonb_build_object('owned',v_backdrops_owned,'total',v_backdrops_total),
    'symbols',jsonb_build_object('owned',v_symbols_owned,'total',v_symbols_total),
    'claimedMilestones',v_claimed);
end;
$$;

create or replace function public.collection_book_snapshot_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_rows jsonb:='[]'::jsonb;
  v_name text;
  v_status jsonb;
  v_owned integer;
  v_points integer;
  v_holder integer;
  v_floor numeric;
  v_total_points integer:=0;
  v_gifts integer:=0;
  v_completed integer:=0;
  v_level integer:=1;
  v_start integer:=0;
  v_next integer:=5;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  select count(*)::integer into v_gifts from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where vg.owner_profile_id=p_profile_id and coalesce(ga.is_burned,false)=false;

  for v_name in
    select distinct ga.base_name from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
    where vg.owner_profile_id=p_profile_id and coalesce(ga.is_burned,false)=false and nullif(trim(ga.base_name),'') is not null
    order by ga.base_name
  loop
    v_status:=public.collection_book_status_v064(p_profile_id,v_name);
    v_holder:=0;
    v_floor:=null;
    select count(*)::integer,
      coalesce(sum(case when least(coalesce(ga.model_rarity_per_mille,1000),coalesce(ga.backdrop_rarity_per_mille,1000),coalesce(ga.symbol_rarity_per_mille,1000))<=10 then 5
        when least(coalesce(ga.model_rarity_per_mille,1000),coalesce(ga.backdrop_rarity_per_mille,1000),coalesce(ga.symbol_rarity_per_mille,1000))<=30 then 3
        when least(coalesce(ga.model_rarity_per_mille,1000),coalesce(ga.backdrop_rarity_per_mille,1000),coalesce(ga.symbol_rarity_per_mille,1000))<=100 then 2 else 1 end),0)::integer
      into v_owned,v_points
    from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
    where vg.owner_profile_id=p_profile_id and lower(trim(ga.base_name))=lower(trim(v_name)) and coalesce(ga.is_burned,false)=false;
    select coalesce(holder_count,0)::integer,floor_price into v_holder,v_floor from public.gift_collection_overview
      where lower(trim(base_name))=lower(trim(v_name)) limit 1;
    v_total_points:=v_total_points+coalesce(v_points,0);
    if coalesce((v_status->>'coverage')::integer,0)>=100 then v_completed:=v_completed+1; end if;
    v_rows:=v_rows||jsonb_build_array(v_status||jsonb_build_object('owned',coalesce(v_owned,0),'rarityPoints',coalesce(v_points,0),
      'holders',coalesce(v_holder,0),'floorPrice',v_floor));
  end loop;
  v_level:=greatest(1,floor(sqrt(greatest(v_total_points,0)::numeric/5.0))::integer+1);
  v_start:=5*(v_level-1)*(v_level-1);
  v_next:=5*v_level*v_level;
  return jsonb_build_object('level',v_level,'totalPoints',v_total_points,'nextLevel',v_next,
    'progress',least(1,greatest(0,(v_total_points-v_start)::numeric/greatest(1,v_next-v_start))),
    'giftCount',v_gifts,'completed',v_completed,'collections',v_rows,'milestones',jsonb_build_array(25,50,75,100));
end;
$$;

create or replace function public.claim_collection_milestone_v064(p_profile_id uuid,p_base_name text,p_milestone integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_name text:=trim(coalesce(p_base_name,''));
  v_status jsonb;
  v_coverage integer:=0;
  v_existing public.collection_milestone_claims;
  v_reward jsonb:='{}'::jsonb;
  v_primary jsonb;
  v_bonus jsonb:=null;
  v_item_key text;
  v_slug text;
  v_reference uuid:=gen_random_uuid();
begin
  if p_milestone not in (25,50,75,100) then raise exception 'Invalid collection milestone'; end if;
  if char_length(v_name)<1 or char_length(v_name)>120 then raise exception 'Invalid collection name'; end if;
  perform pg_advisory_xact_lock(hashtextextended('collection-book:'||p_profile_id::text||':'||lower(v_name)||':'||p_milestone::text,0));
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into v_existing from public.collection_milestone_claims
  where profile_id=p_profile_id and lower(trim(base_name))=lower(v_name) and milestone=p_milestone;
  if found then return jsonb_build_object('status','claimed','alreadyClaimed',true,'milestone',p_milestone,'coverage',v_existing.coverage,'reward',v_existing.reward); end if;
  v_status:=public.collection_book_status_v064(p_profile_id,v_name);
  v_coverage:=coalesce((v_status->>'coverage')::integer,0);
  if v_coverage<p_milestone then raise exception 'Collection milestone is locked'; end if;

  if p_milestone=25 then
    v_primary:=public.grant_virtual_reward_v200(p_profile_id,'mxm_coins',250,jsonb_build_object('label','250 MXM'),'collection_book',v_reference);
  elsif p_milestone=50 then
    v_primary:=public.grant_virtual_reward_v200(p_profile_id,'mxm_coins',700,jsonb_build_object('label','700 MXM'),'collection_book',v_reference);
    v_bonus:=public.grant_virtual_reward_v200(p_profile_id,'case',1,jsonb_build_object('sku','case_starter','label','Стартовый кейс'),'collection_book',v_reference);
  elsif p_milestone=75 then
    v_primary:=public.grant_virtual_reward_v200(p_profile_id,'mxm_coins',1500,jsonb_build_object('label','1 500 MXM'),'collection_book',v_reference);
    v_bonus:=public.grant_virtual_reward_v200(p_profile_id,'case',1,jsonb_build_object('sku','case_rare','label','Редкий кейс'),'collection_book',v_reference);
  else
    v_slug:=trim(both '-' from regexp_replace(lower(v_name),'[^a-z0-9]+','-','g'));
    if v_slug='' then v_slug:='collection'; end if;
    v_item_key:='collection_master:'||left(v_slug,48)||':'||substr(md5(lower(v_name)),1,10);
    insert into public.profile_items(item_key,item_type,title,rarity,metadata,active)
    values(v_item_key,'badge',left(v_name,92)||' Master','legendary',jsonb_build_object('source','collection_book','collection',v_name),true)
    on conflict(item_key) do update set active=true;
    v_primary:=public.grant_virtual_reward_v200(p_profile_id,'mxm_coins',3000,jsonb_build_object('label','3 000 MXM'),'collection_book',v_reference);
    v_bonus:=public.grant_virtual_reward_v200(p_profile_id,'profile_item',1,jsonb_build_object('itemKey',v_item_key,'duplicateMxm',2500,'label',left(v_name,92)||' Master'),'collection_book',v_reference);
  end if;
  v_reward:=jsonb_build_object('primary',v_primary,'bonus',v_bonus);
  insert into public.collection_milestone_claims(profile_id,base_name,milestone,coverage,reward)
  values(p_profile_id,v_name,p_milestone,v_coverage,v_reward);
  perform public.award_profile_xp(p_profile_id,'collection-milestone:'||lower(v_name)||':'||p_milestone::text,case p_milestone when 25 then 10 when 50 then 20 when 75 then 35 else 60 end);
  insert into public.economy_events(profile_id,kind,amount,metadata)
  values(p_profile_id,'collection_book',case p_milestone when 25 then 250 when 50 then 700 when 75 then 1500 else 3000 end,
    jsonb_build_object('unit','mxm_coins','collection',v_name,'milestone',p_milestone,'coverage',v_coverage,'reward',v_reward));
  return jsonb_build_object('status','claimed','alreadyClaimed',false,'milestone',p_milestone,'coverage',v_coverage,'reward',v_reward);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Achievements 2.0 with categories, rarity and live progress.
-- ---------------------------------------------------------------------------

alter table public.achievements add column if not exists category text not null default 'general';
alter table public.achievements add column if not exists rarity text not null default 'common';
alter table public.achievements add column if not exists metric_key text;
alter table public.achievements add column if not exists target numeric not null default 1;

alter table public.achievements drop constraint if exists achievements_rarity_v064_check;
alter table public.achievements add constraint achievements_rarity_v064_check check(rarity in ('common','rare','epic','legendary'));
alter table public.achievements drop constraint if exists achievements_target_v064_check;
alter table public.achievements add constraint achievements_target_v064_check check(target>0);

insert into public.achievements(key,title,description,icon,xp_reward,sort_order,category,rarity,metric_key,target,active) values
  ('first_trade','Первая сделка','Совершить первую рыночную сделку.','handshake',15,10,'trading','common','trades',1,true),
  ('ten_sales','10 продаж','Совершить 10 продаж подарков или мемкоинов.','receipt',35,20,'trading','rare','sales',10,true),
  ('trader_25','Ритм рынка','Совершить 25 сделок.','chart',45,25,'trading','rare','trades',25,true),
  ('trader_100','Market Operator','Совершить 100 сделок.','chart',100,30,'trading','epic','trades',100,true),
  ('trader_500','Market Veteran','Совершить 500 сделок.','chart',250,35,'trading','legendary','trades',500,true),
  ('volume_10k','Объём 10K','Наторговать на 10 000 TON.','chart',75,40,'trading','rare','volume',10000,true),
  ('volume_100k','Объём 100K','Наторговать на 100 000 TON.','chart',180,45,'trading','epic','volume',100000,true),
  ('collector_10','Коллекционер','Одновременно владеть 10 Telegram-подарками.','gem',40,50,'collection','rare','gifts_owned',10,true),
  ('collector_50','Архивариус','Одновременно владеть 50 Telegram-подарками.','gem',120,55,'collection','epic','gifts_owned',50,true),
  ('collection_master','Мастер коллекции','Закрыть Collection Book одной серии на 100%.','gem',160,60,'collection','legendary','collections_completed',1,true),
  ('case_first','Первый дроп','Открыть первый кейс MXM.','box',15,70,'cases','common','cases_opened',1,true),
  ('case_25','Case Runner','Открыть 25 кейсов MXM.','box',80,75,'cases','rare','cases_opened',25,true),
  ('legendary_drop','Золотой сигнал','Получить легендарный дроп из кейса.','sparkles',120,80,'cases','legendary','legendary_drops',1,true),
  ('coin_creator','Создатель','Запустить собственный мемкоин.','rocket',30,90,'creator','rare','coins_created',1,true),
  ('creator_5','Серийный автор','Запустить 5 мемкоинов.','rocket',110,95,'creator','epic','coins_created',5,true),
  ('streak_7','Неделя в MXM','Сохранить серию входов 7 дней.','flame',45,100,'streak','rare','streak_best',7,true),
  ('streak_30','Месяц в MXM','Сохранить серию входов 30 дней.','flame',180,105,'streak','legendary','streak_best',30,true),
  ('season_hunter','Сезонный охотник','Получить 20 наград Battle Pass.','trophy',90,110,'season','epic','season_claims',20,true),
  ('level_25','Уровень 25','Достичь 25 уровня аккаунта.','award',60,120,'account','rare','account_level',25,true),
  ('level_50','Уровень 50','Достичь 50 уровня аккаунта.','award',140,125,'account','epic','account_level',50,true),
  ('level_100','Уровень 100','Достичь максимального базового уровня аккаунта.','award',350,130,'account','legendary','account_level',100,true),
  ('early_user','Early User','Аккаунт создан до 1 сентября 2026 года.','sparkles',25,140,'legacy','rare','early_user',1,true)
on conflict(key) do update set title=excluded.title,description=excluded.description,icon=excluded.icon,xp_reward=excluded.xp_reward,
  sort_order=excluded.sort_order,category=excluded.category,rarity=excluded.rarity,metric_key=excluded.metric_key,target=excluded.target,active=excluded.active;

create or replace function public.refresh_achievements_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_created timestamptz;
  v_coin_trades integer:=0; v_gift_trades integer:=0; v_sales integer:=0;
  v_volume numeric:=0; v_gifts integer:=0; v_coins integer:=0; v_cases integer:=0; v_legendaries integer:=0;
  v_collections integer:=0; v_streak integer:=0; v_season integer:=0; v_level integer:=1;
  v_row public.achievements;
  v_value numeric:=0;
  v_inserted integer:=0;
  v_unlocked integer:=0;
begin
  select created_at into v_created from public.profiles where id=p_profile_id;
  if v_created is null then raise exception 'Profile not found'; end if;
  select count(*)::integer,coalesce(sum(quote_amount),0) into v_coin_trades,v_volume from public.trades where profile_id=p_profile_id;
  select count(*)::integer into v_gift_trades from public.gift_trades where buyer_profile_id=p_profile_id or seller_profile_id=p_profile_id;
  select count(*)::integer into v_sales from public.gift_trades where seller_profile_id=p_profile_id;
  select v_sales + coalesce((select count(*) from public.trades where profile_id=p_profile_id and side='sell'),0)::integer into v_sales;
  select v_volume + coalesce(sum(price),0) into v_volume from public.gift_trades where buyer_profile_id=p_profile_id or seller_profile_id=p_profile_id;
  select count(*)::integer into v_gifts from public.virtual_gifts where owner_profile_id=p_profile_id;
  select count(*)::integer into v_coins from public.coins where creator_profile_id=p_profile_id;
  select count(*)::integer,count(*) filter(where rarity='legendary')::integer into v_cases,v_legendaries from public.case_openings where profile_id=p_profile_id;
  select count(distinct lower(trim(base_name)))::integer into v_collections from public.collection_milestone_claims where profile_id=p_profile_id and milestone=100;
  select coalesce(best_streak,0) into v_streak from public.daily_streak_state where profile_id=p_profile_id;
  v_streak:=coalesce(v_streak,0);
  select count(*)::integer into v_season from public.season_claims where profile_id=p_profile_id;
  select public.account_level_v064(xp) into v_level from public.profiles where id=p_profile_id;

  for v_row in select * from public.achievements where active=true and metric_key is not null order by sort_order,key loop
    v_value:=case v_row.metric_key
      when 'trades' then v_coin_trades+v_gift_trades
      when 'sales' then v_sales
      when 'volume' then v_volume
      when 'gifts_owned' then v_gifts
      when 'coins_created' then v_coins
      when 'cases_opened' then v_cases
      when 'legendary_drops' then v_legendaries
      when 'collections_completed' then v_collections
      when 'streak_best' then v_streak
      when 'season_claims' then v_season
      when 'account_level' then v_level
      when 'early_user' then case when v_created<'2026-09-01'::timestamptz then 1 else 0 end
      else 0 end;
    if v_value>=v_row.target then
      insert into public.user_achievements(profile_id,achievement_key,metadata)
      values(p_profile_id,v_row.key,jsonb_build_object('metric',v_row.metric_key,'value',v_value,'target',v_row.target))
      on conflict(profile_id,achievement_key) do nothing;
      get diagnostics v_inserted=row_count;
      if v_inserted=1 then
        v_unlocked:=v_unlocked+1;
        if v_row.xp_reward>0 then perform public.award_profile_xp(p_profile_id,'achievement:'||v_row.key,v_row.xp_reward); end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('newlyUnlocked',v_unlocked,'metrics',jsonb_build_object(
    'trades',v_coin_trades+v_gift_trades,'sales',v_sales,'volume',v_volume,'giftsOwned',v_gifts,'coinsCreated',v_coins,
    'casesOpened',v_cases,'legendaryDrops',v_legendaries,'collectionsCompleted',v_collections,'streakBest',v_streak,
    'seasonClaims',v_season,'accountLevel',v_level));
end;
$$;

create or replace function public.progression_snapshot_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_refresh jsonb;
  v_metrics jsonb;
  v_achievements jsonb:='[]'::jsonb;
  v_row record;
  v_value numeric;
begin
  v_refresh:=public.refresh_achievements_v064(p_profile_id);
  v_metrics:=coalesce(v_refresh->'metrics','{}'::jsonb);
  for v_row in
    select a.*,ua.unlocked_at from public.achievements a
    left join public.user_achievements ua on ua.profile_id=p_profile_id and ua.achievement_key=a.key
    where a.active=true order by a.sort_order,a.key
  loop
    v_value:=case v_row.metric_key
      when 'trades' then coalesce((v_metrics->>'trades')::numeric,0)
      when 'sales' then coalesce((v_metrics->>'sales')::numeric,0)
      when 'volume' then coalesce((v_metrics->>'volume')::numeric,0)
      when 'gifts_owned' then coalesce((v_metrics->>'giftsOwned')::numeric,0)
      when 'coins_created' then coalesce((v_metrics->>'coinsCreated')::numeric,0)
      when 'cases_opened' then coalesce((v_metrics->>'casesOpened')::numeric,0)
      when 'legendary_drops' then coalesce((v_metrics->>'legendaryDrops')::numeric,0)
      when 'collections_completed' then coalesce((v_metrics->>'collectionsCompleted')::numeric,0)
      when 'streak_best' then coalesce((v_metrics->>'streakBest')::numeric,0)
      when 'season_claims' then coalesce((v_metrics->>'seasonClaims')::numeric,0)
      when 'account_level' then coalesce((v_metrics->>'accountLevel')::numeric,0)
      when 'early_user' then case when v_row.unlocked_at is not null then 1 else 0 end
      else 0 end;
    v_achievements:=v_achievements||jsonb_build_array(jsonb_build_object(
      'key',v_row.key,'title',v_row.title,'description',v_row.description,'icon',v_row.icon,'xpReward',v_row.xp_reward,
      'category',v_row.category,'rarity',v_row.rarity,'progress',least(v_value,v_row.target),'target',v_row.target,
      'unlocked',v_row.unlocked_at is not null,'unlockedAt',v_row.unlocked_at
    ));
  end loop;
  return jsonb_build_object('account',public.account_progression_snapshot_v064(p_profile_id),
    'streak',public.daily_streak_snapshot_v064(p_profile_id),'achievements',v_achievements,'newlyUnlocked',coalesce((v_refresh->>'newlyUnlocked')::integer,0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Case pity. Base odds stay visible; a personal guarantee only restricts
-- the candidate pool when its counter reaches the disclosed threshold.
-- ---------------------------------------------------------------------------

alter table public.case_definitions add column if not exists rare_pity integer;
alter table public.case_definitions add column if not exists epic_pity integer;
alter table public.case_definitions add column if not exists legendary_pity integer;

update public.case_definitions set
  rare_pity=case sku when 'case_starter' then 10 when 'case_market' then 8 when 'case_rare' then 6 when 'case_creator' then 5 else null end,
  epic_pity=case sku when 'case_starter' then 25 when 'case_market' then 18 when 'case_rare' then 12 when 'case_creator' then 10 when 'case_legendary' then 6 when 'case_vault' then 5 else null end,
  legendary_pity=case sku when 'case_market' then 50 when 'case_rare' then 30 when 'case_creator' then 25 when 'case_legendary' then 12 when 'case_vault' then 10 else null end
where sku in ('case_starter','case_market','case_rare','case_creator','case_legendary','case_vault');

create table if not exists public.case_pity_state (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  case_sku text not null references public.case_definitions(sku) on delete cascade,
  opens_since_rare integer not null default 0 check(opens_since_rare>=0),
  opens_since_epic integer not null default 0 check(opens_since_epic>=0),
  opens_since_legendary integer not null default 0 check(opens_since_legendary>=0),
  total_opens integer not null default 0 check(total_opens>=0),
  updated_at timestamptz not null default now(),
  primary key(profile_id,case_sku)
);
create index if not exists case_pity_state_profile_v064_idx on public.case_pity_state(profile_id,updated_at desc);
alter table public.case_pity_state enable row level security;
revoke all on public.case_pity_state from public,anon,authenticated;
grant all on public.case_pity_state to service_role;

alter table public.case_openings add column if not exists pity_triggered boolean not null default false;
alter table public.case_openings add column if not exists pity_rarity text;

create or replace function public.open_case_v200(
  p_profile_id uuid,p_case_sku text,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request uuid:=coalesce(p_request_id,gen_random_uuid());
  v_existing public.case_openings;
  v_inventory public.profile_inventory;
  v_case public.case_definitions;
  v_pity public.case_pity_state;
  v_loot public.case_loot_definitions;
  v_total integer;
  v_roll integer;
  v_random bytea;
  v_reward jsonb;
  v_remaining integer;
  v_force_rank integer:=0;
  v_force_rarity text:=null;
  v_reward_rank integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,0));
  select * into v_existing from public.case_openings where request_id=v_request;
  if found then
    if v_existing.profile_id<>p_profile_id or v_existing.case_sku<>p_case_sku then raise exception 'Case request ID was already used'; end if;
    select quantity into v_remaining from public.profile_inventory where profile_id=p_profile_id and sku=p_case_sku;
    return jsonb_build_object('status','opened','alreadyOpened',true,'reward',jsonb_build_object(
      'label',v_existing.reward_label,'rarity',v_existing.rarity,'kind',v_existing.reward_kind,'amount',v_existing.reward_amount,
      'pityTriggered',v_existing.pity_triggered,'pityRarity',v_existing.pity_rarity
    ),'remaining',coalesce(v_remaining,0));
  end if;

  select * into v_case from public.case_definitions where sku=p_case_sku and active=true;
  if not found then raise exception 'Case is unavailable'; end if;
  select * into v_inventory from public.profile_inventory where profile_id=p_profile_id and sku=p_case_sku for update;
  if not found or v_inventory.quantity<1 then raise exception 'No case in inventory'; end if;

  insert into public.case_pity_state(profile_id,case_sku) values(p_profile_id,p_case_sku)
  on conflict(profile_id,case_sku) do nothing;
  select * into v_pity from public.case_pity_state where profile_id=p_profile_id and case_sku=p_case_sku for update;

  if v_case.legendary_pity is not null and v_pity.opens_since_legendary+1>=v_case.legendary_pity then
    v_force_rank:=3; v_force_rarity:='legendary';
  elsif v_case.epic_pity is not null and v_pity.opens_since_epic+1>=v_case.epic_pity then
    v_force_rank:=2; v_force_rarity:='epic';
  elsif v_case.rare_pity is not null and v_pity.opens_since_rare+1>=v_case.rare_pity then
    v_force_rank:=1; v_force_rarity:='rare';
  end if;

  select sum(weight)::integer into v_total from public.case_loot_definitions
  where case_sku=p_case_sku and active=true and (case rarity when 'legendary' then 3 when 'epic' then 2 when 'rare' then 1 else 0 end)>=v_force_rank;
  if coalesce(v_total,0)<=0 then raise exception 'Case odds are not configured'; end if;
  v_random:=decode(replace(gen_random_uuid()::text,'-',''),'hex');
  v_roll:=mod((get_byte(v_random,0)::numeric*16777216+get_byte(v_random,1)::numeric*65536+
    get_byte(v_random,2)::numeric*256+get_byte(v_random,3)::numeric),v_total)::integer+1;
  select x.id,x.case_sku,x.reward_key,x.reward_kind,x.reward_label,x.amount,x.weight,x.rarity,x.metadata,x.active
  into v_loot from (
    select l.*,sum(l.weight) over(order by l.reward_key rows between unbounded preceding and current row) as ceiling
    from public.case_loot_definitions l where l.case_sku=p_case_sku and l.active=true
      and (case l.rarity when 'legendary' then 3 when 'epic' then 2 when 'rare' then 1 else 0 end)>=v_force_rank
  ) x where x.ceiling>=v_roll order by x.ceiling limit 1;
  if not found then raise exception 'Case draw failed'; end if;
  v_reward_rank:=case v_loot.rarity when 'legendary' then 3 when 'epic' then 2 when 'rare' then 1 else 0 end;

  if v_loot.reward_kind='profile_item' and exists(select 1 from public.profile_item_inventory
    where profile_id=p_profile_id and item_key=v_loot.metadata->>'itemKey') then
    v_loot.reward_kind:='mxm_coins';
    v_loot.amount:=greatest(1,coalesce((v_loot.metadata->>'duplicateMxm')::integer,250));
    v_loot.reward_label:=v_loot.amount::text||' MXM duplicate compensation';
    v_loot.metadata:='{}'::jsonb;
  end if;

  update public.profile_inventory set quantity=quantity-1,updated_at=now()
  where profile_id=p_profile_id and sku=p_case_sku returning quantity into v_remaining;
  v_reward:=public.grant_virtual_reward_v200(p_profile_id,v_loot.reward_kind,v_loot.amount,
    v_loot.metadata||jsonb_build_object('label',v_loot.reward_label),'case',v_request);
  insert into public.case_openings(request_id,profile_id,case_sku,loot_id,reward_kind,reward_label,reward_amount,rarity,pity_triggered,pity_rarity)
  values(v_request,p_profile_id,p_case_sku,v_loot.id,v_reward->>'kind',v_reward->>'label',
    greatest(0,coalesce((v_reward->>'amount')::integer,0)),v_loot.rarity,v_force_rank>0,v_force_rarity);

  update public.case_pity_state set
    opens_since_rare=case when v_reward_rank>=1 then 0 else opens_since_rare+1 end,
    opens_since_epic=case when v_reward_rank>=2 then 0 else opens_since_epic+1 end,
    opens_since_legendary=case when v_reward_rank>=3 then 0 else opens_since_legendary+1 end,
    total_opens=total_opens+1,updated_at=now()
  where profile_id=p_profile_id and case_sku=p_case_sku;

  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'case',case when v_reward->>'kind'='mxm_coins' then coalesce((v_reward->>'amount')::numeric,0) else 0 end,v_request,
    jsonb_build_object('unit',v_loot.reward_kind,'caseSku',p_case_sku,'reward',v_reward,'rarity',v_loot.rarity,
      'pityTriggered',v_force_rank>0,'pityRarity',v_force_rarity));
  return jsonb_build_object('status','opened','alreadyOpened',false,'requestId',v_request,
    'reward',jsonb_build_object('label',v_reward->>'label','rarity',v_loot.rarity,'kind',v_reward->>'kind',
      'amount',coalesce((v_reward->>'amount')::integer,0),'creditedEnergy',v_reward->'creditedEnergy','overflowMxmCoins',v_reward->'overflowMxmCoins',
      'pityTriggered',v_force_rank>0,'pityRarity',v_force_rarity),
    'remaining',v_remaining);
end;
$$;

create or replace function public.case_snapshot_v200(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'cases',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku',d.sku,'title',d.title,'tier',d.tier,'description',d.description,
        'quantity',coalesce(i.quantity,0),'remaining',d.remaining_supply,
        'pity',jsonb_build_object(
          'rare',case when d.rare_pity is null then null else jsonb_build_object('current',coalesce(ps.opens_since_rare,0),'threshold',d.rare_pity,'remaining',greatest(1,d.rare_pity-coalesce(ps.opens_since_rare,0))) end,
          'epic',case when d.epic_pity is null then null else jsonb_build_object('current',coalesce(ps.opens_since_epic,0),'threshold',d.epic_pity,'remaining',greatest(1,d.epic_pity-coalesce(ps.opens_since_epic,0))) end,
          'legendary',case when d.legendary_pity is null then null else jsonb_build_object('current',coalesce(ps.opens_since_legendary,0),'threshold',d.legendary_pity,'remaining',greatest(1,d.legendary_pity-coalesce(ps.opens_since_legendary,0))) end,
          'totalOpens',coalesce(ps.total_opens,0)
        ),
        'odds',coalesce((
          select jsonb_agg(jsonb_build_object(
            'reward',l.reward_key,'label',l.reward_label,
            'percent',round(100.0*l.weight/nullif((select sum(l2.weight) from public.case_loot_definitions l2 where l2.case_sku=d.sku and l2.active=true),0),2),
            'rarity',l.rarity
          ) order by l.weight desc,l.reward_key)
          from public.case_loot_definitions l where l.case_sku=d.sku and l.active=true
        ),'[]'::jsonb)
      ) order by coalesce(sp.sort_order,999999),d.sku)
      from public.case_definitions d
      left join public.store_products sp on sp.sku=d.sku
      left join public.profile_inventory i on i.profile_id=p_profile_id and i.sku=d.sku
      left join public.case_pity_state ps on ps.profile_id=p_profile_id and ps.case_sku=d.sku
      where d.active=true
    ),'[]'::jsonb),
    'history',coalesce((
      select jsonb_agg(jsonb_build_object('id',o.id,'caseSku',o.case_sku,'rewardLabel',o.reward_label,
        'rarity',o.rarity,'openedAt',o.opened_at,'pityTriggered',o.pity_triggered,'pityRarity',o.pity_rarity) order by o.opened_at desc)
      from (select * from public.case_openings where profile_id=p_profile_id order by opened_at desc limit 40) o
    ),'[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. Battle Pass prestige after the 30-level track.
-- ---------------------------------------------------------------------------

create table if not exists public.season_prestige_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  prestige_level integer not null check(prestige_level between 1 and 1000),
  reward jsonb not null,
  claimed_at timestamptz not null default now(),
  primary key(profile_id,season_id,prestige_level)
);
create index if not exists season_prestige_claims_profile_v064_idx on public.season_prestige_claims(profile_id,claimed_at desc);
alter table public.season_prestige_claims enable row level security;
revoke all on public.season_prestige_claims from public,anon,authenticated;
grant all on public.season_prestige_claims to service_role;

create or replace function public.season_prestige_reward_v064(p_level integer)
returns jsonb language sql immutable parallel safe as $$
  select case
    when p_level=10 then jsonb_build_object('kind','profile_item','amount',1,'label','Рамка Prestige Orbit','metadata','{"itemKey":"season_prestige_frame","duplicateMxm":9000}'::jsonb)
    when p_level%20=0 then jsonb_build_object('kind','case','amount',1,'label','Легендарный кейс','metadata','{"sku":"case_legendary"}'::jsonb)
    when p_level%5=0 then jsonb_build_object('kind','case','amount',1,'label','Редкий кейс','metadata','{"sku":"case_rare"}'::jsonb)
    when p_level%3=0 then jsonb_build_object('kind','energy','amount',75,'label','75 энергии','metadata','{}'::jsonb)
    else jsonb_build_object('kind','mxm_coins','amount',least(1200,450+p_level*25),'label',(least(1200,450+p_level*25))::text||' MXM','metadata','{}'::jsonb)
  end;
$$;

create or replace function public.claim_season_prestige_v064(p_profile_id uuid,p_prestige_level integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_season public.seasons;
  v_xp integer:=0;
  v_max_xp integer:=0;
  v_earned integer:=0;
  v_existing public.season_prestige_claims;
  v_spec jsonb;
  v_reward jsonb;
  v_reference uuid:=gen_random_uuid();
begin
  if p_prestige_level<1 then raise exception 'Invalid prestige level'; end if;
  perform pg_advisory_xact_lock(hashtextextended('season-prestige:'||p_profile_id::text||':'||p_prestige_level::text,0));
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  perform public.ensure_current_season_v200();
  select * into v_season from public.seasons where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if not found then raise exception 'No active season'; end if;
  select * into v_existing from public.season_prestige_claims where profile_id=p_profile_id and season_id=v_season.id and prestige_level=p_prestige_level;
  if found then return jsonb_build_object('status','claimed','alreadyClaimed',true,'prestigeLevel',p_prestige_level,'reward',v_existing.reward); end if;
  select coalesce(sum(amount),0)::integer into v_xp from public.profile_xp_events where profile_id=p_profile_id and created_at>=v_season.starts_at and created_at<v_season.ends_at;
  select coalesce(max(required_xp),0)::integer into v_max_xp from public.season_rewards where season_id=v_season.id;
  v_earned:=greatest(0,floor(greatest(v_xp-v_max_xp,0)::numeric/300)::integer);
  if p_prestige_level>v_earned then raise exception 'Season prestige reward is locked'; end if;
  if p_prestige_level>1 and not exists(select 1 from public.season_prestige_claims
    where profile_id=p_profile_id and season_id=v_season.id and prestige_level=p_prestige_level-1) then
    raise exception 'Previous season prestige reward is not claimed';
  end if;
  v_spec:=public.season_prestige_reward_v064(p_prestige_level);
  v_reward:=public.grant_virtual_reward_v200(p_profile_id,v_spec->>'kind',greatest(1,(v_spec->>'amount')::integer),
    coalesce(v_spec->'metadata','{}'::jsonb)||jsonb_build_object('label',v_spec->>'label'),'season_prestige',v_reference);
  insert into public.season_prestige_claims(profile_id,season_id,prestige_level,reward) values(p_profile_id,v_season.id,p_prestige_level,v_reward);
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'season_prestige',case when v_spec->>'kind'='mxm_coins' then (v_spec->>'amount')::integer else 0 end,v_season.id,
    jsonb_build_object('unit',v_spec->>'kind','prestigeLevel',p_prestige_level,'reward',v_reward));
  return jsonb_build_object('status','claimed','alreadyClaimed',false,'prestigeLevel',p_prestige_level,'reward',v_reward);
end;
$$;

create or replace function public.season_snapshot_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_season public.seasons;
  v_xp integer:=0;
  v_level integer:=1;
  v_premium boolean:=false;
  v_levels jsonb;
  v_max_xp integer:=0;
  v_prestige integer:=0;
  v_prestige_claimed integer:=0;
  v_next_spec jsonb;
begin
  perform public.ensure_current_season_v200();
  select * into v_season from public.seasons where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if not found then raise exception 'No active season'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  select coalesce(sum(amount),0)::integer into v_xp from public.profile_xp_events where profile_id=p_profile_id and created_at>=v_season.starts_at and created_at<v_season.ends_at;
  select coalesce(max(level),1),coalesce(max(required_xp),0) into v_level,v_max_xp from public.season_rewards
  where season_id=v_season.id and track='free' and required_xp<=v_xp;
  select exists(select 1 from public.profile_entitlements where profile_id=p_profile_id and entitlement_key='season_pass' and (expires_at is null or expires_at>now())) into v_premium;
  select coalesce(jsonb_agg(jsonb_build_object(
    'level',q.level,'requiredXp',q.required_xp,
    'freeReward',jsonb_build_object('label',q.free_label,'kind',q.free_kind,'amount',q.free_amount),
    'premiumReward',jsonb_build_object('label',q.premium_label,'kind',q.premium_kind,'amount',q.premium_amount),
    'freeClaimed',q.free_claimed,'premiumClaimed',q.premium_claimed
  ) order by q.level),'[]'::jsonb) into v_levels
  from (
    select f.level,f.required_xp,f.reward_label free_label,f.reward_kind free_kind,f.amount free_amount,
      p.reward_label premium_label,p.reward_kind premium_kind,p.amount premium_amount,
      exists(select 1 from public.season_claims c where c.profile_id=p_profile_id and c.season_id=v_season.id and c.level=f.level and c.track='free') free_claimed,
      exists(select 1 from public.season_claims c where c.profile_id=p_profile_id and c.season_id=v_season.id and c.level=f.level and c.track='premium') premium_claimed
    from public.season_rewards f join public.season_rewards p on p.season_id=f.season_id and p.level=f.level and p.track='premium'
    where f.season_id=v_season.id and f.track='free'
  ) q;
  select coalesce(max(required_xp),0)::integer into v_max_xp from public.season_rewards where season_id=v_season.id;
  v_prestige:=greatest(0,floor(greatest(v_xp-v_max_xp,0)::numeric/300)::integer);
  select count(*)::integer into v_prestige_claimed from public.season_prestige_claims where profile_id=p_profile_id and season_id=v_season.id;
  v_next_spec:=public.season_prestige_reward_v064(v_prestige_claimed+1);
  return jsonb_build_object(
    'season',jsonb_build_object('id',v_season.id,'title',v_season.title,'startsAt',v_season.starts_at,'endsAt',v_season.ends_at,
      'daysLeft',greatest(0,ceil(extract(epoch from (v_season.ends_at-now()))/86400.0)::integer)),
    'xp',v_xp,'level',v_level,'premium',v_premium,'levels',v_levels,
    'prestige',jsonb_build_object('unlocked',v_xp>=v_max_xp,'level',v_prestige,'claimed',v_prestige_claimed,
      'claimable',greatest(0,v_prestige-v_prestige_claimed),'stepXp',300,'baseXp',v_max_xp,
      'nextRequiredXp',v_max_xp+(v_prestige+1)*300,'nextClaimLevel',v_prestige_claimed+1,
      'nextReward',jsonb_build_object('kind',v_next_spec->>'kind','amount',(v_next_spec->>'amount')::integer,'label',v_next_spec->>'label'))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Permissions + PostgREST procedure cache refresh.
-- ---------------------------------------------------------------------------

revoke execute on function public.account_level_v064(bigint) from public,anon,authenticated;
revoke execute on function public.account_progression_snapshot_v064(uuid) from public,anon,authenticated;
revoke execute on function public.claim_account_level_reward_v064(uuid,integer) from public,anon,authenticated;
revoke execute on function public.daily_streak_reward_v064(integer) from public,anon,authenticated;
revoke execute on function public.daily_streak_snapshot_v064(uuid) from public,anon,authenticated;
revoke execute on function public.claim_daily_streak_v064(uuid) from public,anon,authenticated;
revoke execute on function public.collection_book_status_v064(uuid,text) from public,anon,authenticated;
revoke execute on function public.collection_book_snapshot_v064(uuid) from public,anon,authenticated;
revoke execute on function public.claim_collection_milestone_v064(uuid,text,integer) from public,anon,authenticated;
revoke execute on function public.refresh_achievements_v064(uuid) from public,anon,authenticated;
revoke execute on function public.progression_snapshot_v064(uuid) from public,anon,authenticated;
revoke execute on function public.season_prestige_reward_v064(integer) from public,anon,authenticated;
revoke execute on function public.claim_season_prestige_v064(uuid,integer) from public,anon,authenticated;
revoke execute on function public.open_case_v200(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.case_snapshot_v200(uuid) from public,anon,authenticated;
revoke execute on function public.season_snapshot_v200(uuid) from public,anon,authenticated;

grant execute on function public.account_level_v064(bigint),
  public.account_progression_snapshot_v064(uuid),public.claim_account_level_reward_v064(uuid,integer),
  public.daily_streak_reward_v064(integer),public.daily_streak_snapshot_v064(uuid),public.claim_daily_streak_v064(uuid),
  public.collection_book_status_v064(uuid,text),public.collection_book_snapshot_v064(uuid),public.claim_collection_milestone_v064(uuid,text,integer),
  public.refresh_achievements_v064(uuid),public.progression_snapshot_v064(uuid),
  public.season_prestige_reward_v064(integer),public.claim_season_prestige_v064(uuid,integer),
  public.open_case_v200(uuid,text,uuid),public.case_snapshot_v200(uuid),public.season_snapshot_v200(uuid)
to service_role;

notify pgrst, 'reload schema';
commit;
