begin;

-- MemeX Market v0.71.0
-- Honest Telegram Stars revenue, 52 weekly seasons, expanded cases/cosmetics,
-- and review-based creator/memecoin verification.

-- ---------------------------------------------------------------------------
-- Weekly season catalogue.
-- ---------------------------------------------------------------------------

alter table public.seasons add column if not exists week_number integer;
alter table public.seasons add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists seasons_active_window_v071_idx
  on public.seasons (active, starts_at, ends_at);
create unique index if not exists seasons_week_number_v071_idx
  on public.seasons (week_number) where week_number is not null;

update public.seasons
set active=false
where season_key='market-2-launch';

-- Trust can never be bought. Old paid verification SKUs are retired; review
-- applications below are the only source of creator and coin verification.
update public.store_products
set active=false, updated_at=now()
where sku in ('creator_verified_7d','creator_verified_30d','creator_verified_90d');

insert into public.profile_items(item_key,item_type,title,rarity,metadata,active) values
  ('glacier_crown_frame','frame','Glacier Crown','legendary','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-glacier-crown.png","motion":"drift"}'::jsonb,true),
  ('vault_sovereign_frame','frame','Vault Sovereign','legendary','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-vault-sovereign.png","motion":"pulse"}'::jsonb,true),
  ('obsidian_signal_frame','frame','Obsidian Signal','epic','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-obsidian-signal.png","motion":"scan"}'::jsonb,true),
  ('circuit_elite_frame','frame','Circuit Elite','epic','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-circuit-elite.png","motion":"scan"}'::jsonb,true),
  ('iron_regent_frame','frame','Iron Regent','legendary','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-iron-regent.png","motion":"pulse"}'::jsonb,true),
  ('arctic_relay_frame','frame','Arctic Relay','epic','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-arctic-relay.png","motion":"drift"}'::jsonb,true),
  ('ember_sentinel_frame','frame','Ember Sentinel','legendary','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-ember-sentinel.png","motion":"pulse"}'::jsonb,true),
  ('quantum_frost_frame','frame','Quantum Frost','legendary','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-quantum-frost.png","motion":"scan"}'::jsonb,true),
  ('midnight_laurels_frame','frame','Midnight Laurels','legendary','{"source":"battle_pass","exclusive":true,"asset":"/assets/season/frame-midnight-laurels.png","motion":"drift"}'::jsonb,true),
  ('weekly_vanguard_badge','badge','Weekly Vanguard','epic','{"source":"battle_pass","exclusive":true}'::jsonb,true),
  ('year_one_badge','badge','Year One','legendary','{"source":"battle_pass","exclusive":true}'::jsonb,true)
on conflict(item_key) do update set
  item_type=excluded.item_type,
  title=excluded.title,
  rarity=excluded.rarity,
  metadata=excluded.metadata,
  active=excluded.active;

-- ---------------------------------------------------------------------------
-- New paid content. Every case has an authoritative server loot table and a
-- finite supply; probabilities shown by the client are derived from weights.
-- ---------------------------------------------------------------------------

insert into public.store_products(sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata,active) values
  ('case_foundry','cases','Foundry Drop','Индустриальная серия с MXM, энергией и редкими профильными предметами.',59,'1 кейс Foundry Drop','Новый',260,'{"caseTier":"starter","quantity":1,"highlights":["6 наград","Эпическое 7%","Тираж 48 000"]}'::jsonb,true),
  ('case_weekly','cases','Weekly Cache','Недельный кейс с компактным набором сезонных наград.',49,'1 кейс Weekly Cache','Неделя',270,'{"caseTier":"starter","quantity":1,"highlights":["5 наград","Обновляемая серия","Тираж 52 000"]}'::jsonb,true),
  ('case_glacier','cases','Glacier Protocol','Холодная серия с повышенным MXM и шансом на Arctic Frost.',89,'1 кейс Glacier Protocol','Редкий',280,'{"caseTier":"rare","quantity":1,"highlights":["6 наград","Эпическое+ 18%","Тираж 18 000"]}'::jsonb,true),
  ('case_kinetic','cases','Kinetic Core','Быстрая серия для активной прогрессии и коллекций.',109,'1 кейс Kinetic Core','Редкий',290,'{"caseTier":"rare","quantity":1,"highlights":["6 наград","Эпическое+ 22%","Тираж 15 000"]}'::jsonb,true),
  ('case_midnight','cases','Midnight Relay','Тёмная коллекционная серия с крупными пакетами MXM.',139,'1 кейс Midnight Relay','Эпический',300,'{"caseTier":"rare","quantity":1,"highlights":["6 наград","Легендарное 8%","Тираж 11 000"]}'::jsonb,true),
  ('case_sovereign','cases','Sovereign Vault','Премиальная серия с Royal Gold и крупными наградами.',199,'1 кейс Sovereign Vault','Премиум',310,'{"caseTier":"legendary","quantity":1,"highlights":["6 наград","Легендарное 24%","Тираж 6 500"]}'::jsonb,true),
  ('case_blackout','cases','Blackout 3200','Лимитированная тёмная серия с Founder Edition.',269,'1 кейс Blackout 3200','3 200 шт.',320,'{"caseTier":"legendary","quantity":1,"highlights":["6 наград","Легендарное 31%","Тираж 3 200"]}'::jsonb,true),
  ('case_anniversary','cases','Year One Archive','Самая редкая серия первого года MemeX Market.',399,'1 кейс Year One Archive','1 200 шт.',330,'{"caseTier":"legendary","quantity":1,"highlights":["6 наград","Легендарное 38%","Тираж 1 200"]}'::jsonb,true)
on conflict(sku) do update set
  category=excluded.category,title=excluded.title,description=excluded.description,
  stars_price=excluded.stars_price,reward_label=excluded.reward_label,badge=excluded.badge,
  sort_order=excluded.sort_order,metadata=excluded.metadata,active=true,updated_at=now();

insert into public.case_definitions(sku,title,tier,description,remaining_supply,active,rare_pity,epic_pity,legendary_pity) values
  ('case_foundry','Foundry Drop','starter','Индустриальная серия с шестью честно взвешенными наградами.',48000,true,8,20,50),
  ('case_weekly','Weekly Cache','starter','Компактный недельный кейс для сезонной прогрессии.',52000,true,8,18,45),
  ('case_glacier','Glacier Protocol','rare','Холодная редкая серия с шансом на Arctic Frost.',18000,true,5,11,28),
  ('case_kinetic','Kinetic Core','rare','Редкая серия с ускоренной гарантией эпического предмета.',15000,true,5,10,25),
  ('case_midnight','Midnight Relay','rare','Тёмная серия с крупным MXM и шансом на Deep Space.',11000,true,4,9,22),
  ('case_sovereign','Sovereign Vault','legendary','Премиальная серия с Royal Gold и крупным MXM.',6500,true,null,6,13),
  ('case_blackout','Blackout 3200','legendary','Лимитированный выпуск с шансом на Founder Edition.',3200,true,null,5,11),
  ('case_anniversary','Year One Archive','legendary','Архивный выпуск первого года с самым редким пулом.',1200,true,null,4,9)
on conflict(sku) do update set
  title=excluded.title,tier=excluded.tier,description=excluded.description,
  active=true,rare_pity=excluded.rare_pity,epic_pity=excluded.epic_pity,
  legendary_pity=excluded.legendary_pity;

delete from public.case_loot_definitions
where case_sku in ('case_foundry','case_weekly','case_glacier','case_kinetic','case_midnight','case_sovereign','case_blackout','case_anniversary');

insert into public.case_loot_definitions(case_sku,reward_key,reward_kind,reward_label,amount,weight,rarity,metadata,active) values
  ('case_foundry','mxm_300','mxm_coins','300 MXM',300,3900,'common','{}',true),
  ('case_foundry','energy_35','energy','35 энергии',35,2500,'common','{}',true),
  ('case_foundry','mxm_900','mxm_coins','900 MXM',900,2200,'rare','{}',true),
  ('case_foundry','market_badge','profile_item','Значок Market Runner',1,700,'epic','{"itemKey":"market_runner_badge","duplicateMxm":700}',true),
  ('case_foundry','chrome_frame','profile_item','Рамка Liquid Chrome',1,600,'epic','{"itemKey":"chrome_frame","duplicateMxm":2500}',true),
  ('case_foundry','mxm_3000','mxm_coins','3 000 MXM',3000,100,'legendary','{}',true),

  ('case_weekly','mxm_250','mxm_coins','250 MXM',250,4100,'common','{}',true),
  ('case_weekly','energy_30','energy','30 энергии',30,2800,'common','{}',true),
  ('case_weekly','mxm_700','mxm_coins','700 MXM',700,2200,'rare','{}',true),
  ('case_weekly','weekly_badge','profile_item','Значок Weekly Vanguard',1,700,'epic','{"itemKey":"weekly_vanguard_badge","duplicateMxm":900}',true),
  ('case_weekly','mxm_2500','mxm_coins','2 500 MXM',2500,200,'legendary','{}',true),

  ('case_glacier','mxm_650','mxm_coins','650 MXM',650,3300,'common','{}',true),
  ('case_glacier','energy_60','energy','60 энергии',60,2100,'rare','{}',true),
  ('case_glacier','mxm_1800','mxm_coins','1 800 MXM',1800,2800,'rare','{}',true),
  ('case_glacier','frost_frame','profile_item','Рамка Arctic Frost',1,1300,'epic','{"itemKey":"frost_frame","duplicateMxm":3000}',true),
  ('case_glacier','aurora_frame','profile_item','Рамка Aurora Glass',1,450,'epic','{"itemKey":"aurora_frame","duplicateMxm":4500}',true),
  ('case_glacier','mxm_6000','mxm_coins','6 000 MXM',6000,150,'legendary','{}',true),

  ('case_kinetic','mxm_800','mxm_coins','800 MXM',800,3200,'common','{}',true),
  ('case_kinetic','energy_80','energy','80 энергии',80,1900,'rare','{}',true),
  ('case_kinetic','mxm_2400','mxm_coins','2 400 MXM',2400,2700,'rare','{}',true),
  ('case_kinetic','creator_badge','profile_item','Значок Creator Signal',1,1300,'epic','{"itemKey":"creator_signal_badge","duplicateMxm":2200}',true),
  ('case_kinetic','aurora_frame','profile_item','Рамка Aurora Glass',1,700,'epic','{"itemKey":"aurora_frame","duplicateMxm":4500}',true),
  ('case_kinetic','royal_frame','profile_item','Рамка Royal Gold',1,200,'legendary','{"itemKey":"royal_frame","duplicateMxm":7500}',true),

  ('case_midnight','mxm_1200','mxm_coins','1 200 MXM',1200,3000,'common','{}',true),
  ('case_midnight','energy_100','energy','100 энергии',100,1700,'rare','{}',true),
  ('case_midnight','mxm_3500','mxm_coins','3 500 MXM',3500,2700,'rare','{}',true),
  ('case_midnight','aurora_frame','profile_item','Рамка Aurora Glass',1,1500,'epic','{"itemKey":"aurora_frame","duplicateMxm":4500}',true),
  ('case_midnight','void_frame','profile_item','Рамка Deep Space',1,800,'legendary','{"itemKey":"void_frame","duplicateMxm":9000}',true),
  ('case_midnight','mxm_12000','mxm_coins','12 000 MXM',12000,300,'legendary','{}',true),

  ('case_sovereign','mxm_2500','mxm_coins','2 500 MXM',2500,2400,'rare','{}',true),
  ('case_sovereign','energy_150','energy','150 энергии',150,1600,'rare','{}',true),
  ('case_sovereign','mxm_7000','mxm_coins','7 000 MXM',7000,3000,'epic','{}',true),
  ('case_sovereign','royal_frame','profile_item','Рамка Royal Gold',1,1700,'legendary','{"itemKey":"royal_frame","duplicateMxm":7500}',true),
  ('case_sovereign','void_frame','profile_item','Рамка Deep Space',1,900,'legendary','{"itemKey":"void_frame","duplicateMxm":9000}',true),
  ('case_sovereign','mxm_20000','mxm_coins','20 000 MXM',20000,400,'legendary','{}',true),

  ('case_blackout','mxm_4000','mxm_coins','4 000 MXM',4000,2200,'rare','{}',true),
  ('case_blackout','mxm_9000','mxm_coins','9 000 MXM',9000,3000,'epic','{}',true),
  ('case_blackout','vault_badge','profile_item','Значок Vault Keeper',1,1700,'epic','{"itemKey":"vault_keeper_badge","duplicateMxm":3000}',true),
  ('case_blackout','void_frame','profile_item','Рамка Deep Space',1,1500,'legendary','{"itemKey":"void_frame","duplicateMxm":9000}',true),
  ('case_blackout','founder_frame','profile_item','Рамка Founder Edition',1,1200,'legendary','{"itemKey":"founder_frame","duplicateMxm":15000}',true),
  ('case_blackout','mxm_30000','mxm_coins','30 000 MXM',30000,400,'legendary','{}',true),

  ('case_anniversary','mxm_7000','mxm_coins','7 000 MXM',7000,1900,'rare','{}',true),
  ('case_anniversary','mxm_15000','mxm_coins','15 000 MXM',15000,2800,'epic','{}',true),
  ('case_anniversary','year_badge','profile_item','Значок Year One',1,1500,'epic','{"itemKey":"year_one_badge","duplicateMxm":5000}',true),
  ('case_anniversary','royal_frame','profile_item','Рамка Royal Gold',1,1400,'legendary','{"itemKey":"royal_frame","duplicateMxm":7500}',true),
  ('case_anniversary','founder_frame','profile_item','Рамка Founder Edition',1,1800,'legendary','{"itemKey":"founder_frame","duplicateMxm":15000}',true),
  ('case_anniversary','mxm_50000','mxm_coins','50 000 MXM',50000,600,'legendary','{}',true);

-- Existing stock is never refilled on a rerun.

update public.store_products set
  title='Недельный пропуск MXM',
  description='Премиальная дорожка текущей недели с 12 уровнями и эксклюзивными рамками.',
  stars_price=149,
  reward_label='Премиум текущей недели',
  badge='7 дней',
  metadata='{"entitlement":"season_pass","highlights":["12 уровней","3 эксклюзивные рамки","Действует до конца недели"]}'::jsonb,
  active=true,
  updated_at=now()
where sku='season_premium';

with frame_catalog as (
  select array[
    'glacier_crown_frame','vault_sovereign_frame','obsidian_signal_frame',
    'circuit_elite_frame','iron_regent_frame','arctic_relay_frame',
    'ember_sentinel_frame','quantum_frost_frame','midnight_laurels_frame'
  ]::text[] as keys
), themes as (
  select array['VAULT','GLACIER','SIGNAL','FOUNDRY','BLACKOUT','KINETIC','SOVEREIGN','RELAY','ARCHIVE','OBSIDIAN','CIRCUIT','CROWN']::text[] as names
), schedule as (
  select
    i+1 as week_number,
    timestamptz '2026-08-24 00:00:00+00' + make_interval(weeks=>i) as starts_at,
    timestamptz '2026-08-24 00:00:00+00' + make_interval(weeks=>i+1) as ends_at,
    (select names[(i%12)+1] from themes) as theme,
    (select array[
      keys[((i*3)%9)+1],
      keys[(((i*3)+1)%9)+1],
      keys[(((i*3)+2)%9)+1]
    ] from frame_catalog) as exclusive_keys
  from generate_series(0,51) i
)
insert into public.seasons(season_key,title,starts_at,ends_at,active,week_number,metadata)
select
  'weekly-'||to_char(starts_at,'IYYY-IW'),
  'Неделя '||lpad(week_number::text,2,'0')||' · '||theme,
  starts_at,ends_at,true,week_number,
  jsonb_build_object('theme',lower(theme),'exclusiveFrameKeys',exclusive_keys,'durationDays',7)
from schedule
on conflict(season_key) do update set
  title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
  active=true,week_number=excluded.week_number,metadata=excluded.metadata;

delete from public.season_rewards sr
using public.seasons s
where sr.season_id=s.id and s.week_number is not null;

with levels(level,required_xp) as (
  values (1,0),(2,20),(3,45),(4,75),(5,110),(6,150),(7,195),(8,245),(9,300),(10,360),(11,425),(12,500)
), weekly as (
  select id,week_number,metadata from public.seasons where week_number is not null
), rewards as (
  select w.id as season_id,w.week_number,l.level,l.required_xp,t.track,
    case
      when t.track='free' and l.level in (2,6,10) then 'energy'
      when t.track='free' and l.level in (3,5,8,11) then 'case'
      when t.track='premium' and l.level in (2,5,7,10) then 'case'
      when t.track='premium' and l.level in (4,8,12) then 'profile_item'
      else 'mxm_coins'
    end as reward_kind,
    case
      when t.track='free' and l.level=1 then '150 MXM'
      when t.track='free' and l.level=2 then '20 энергии'
      when t.track='free' and l.level=3 then 'Стартовый кейс'
      when t.track='free' and l.level=4 then '300 MXM'
      when t.track='free' and l.level=5 then 'Market Drop'
      when t.track='free' and l.level=6 then '40 энергии'
      when t.track='free' and l.level=7 then '500 MXM'
      when t.track='free' and l.level=8 then 'Редкий кейс'
      when t.track='free' and l.level=9 then '750 MXM'
      when t.track='free' and l.level=10 then '75 энергии'
      when t.track='free' and l.level=11 then 'Weekly Cache'
      when t.track='free' and l.level=12 then '1 000 MXM'
      when t.track='premium' and l.level=1 then '300 MXM'
      when t.track='premium' and l.level=2 then 'Weekly Cache'
      when t.track='premium' and l.level=3 then '750 MXM'
      when t.track='premium' and l.level=4 then 'Эксклюзивная рамка I'
      when t.track='premium' and l.level=5 then 'Редкий кейс'
      when t.track='premium' and l.level=6 then '1 000 MXM'
      when t.track='premium' and l.level=7 then 'Creator Signal'
      when t.track='premium' and l.level=8 then 'Эксклюзивная рамка II'
      when t.track='premium' and l.level=9 then '150 энергии'
      when t.track='premium' and l.level=10 then 'Sovereign Vault'
      when t.track='premium' and l.level=11 then '2 000 MXM'
      else 'Эксклюзивная рамка III'
    end as reward_label,
    case
      when t.track='free' and l.level=1 then 150
      when t.track='free' and l.level=2 then 20
      when t.track='free' and l.level=3 then 1
      when t.track='free' and l.level=4 then 300
      when t.track='free' and l.level=5 then 1
      when t.track='free' and l.level=6 then 40
      when t.track='free' and l.level=7 then 500
      when t.track='free' and l.level=8 then 1
      when t.track='free' and l.level=9 then 750
      when t.track='free' and l.level=10 then 75
      when t.track='free' and l.level=11 then 1
      when t.track='free' and l.level=12 then 1000
      when t.track='premium' and l.level=1 then 300
      when t.track='premium' and l.level=2 then 1
      when t.track='premium' and l.level=3 then 750
      when t.track='premium' and l.level=4 then 1
      when t.track='premium' and l.level=5 then 1
      when t.track='premium' and l.level=6 then 1000
      when t.track='premium' and l.level=7 then 1
      when t.track='premium' and l.level=8 then 1
      when t.track='premium' and l.level=9 then 150
      when t.track='premium' and l.level=10 then 1
      when t.track='premium' and l.level=11 then 2000
      else 1
    end as amount,
    case
      when t.track='free' and l.level=3 then '{"sku":"case_starter"}'::jsonb
      when t.track='free' and l.level=5 then '{"sku":"case_market"}'::jsonb
      when t.track='free' and l.level=8 then '{"sku":"case_rare"}'::jsonb
      when t.track='free' and l.level=11 then '{"sku":"case_weekly"}'::jsonb
      when t.track='premium' and l.level=2 then '{"sku":"case_weekly"}'::jsonb
      when t.track='premium' and l.level=5 then '{"sku":"case_rare"}'::jsonb
      when t.track='premium' and l.level=7 then '{"sku":"case_creator"}'::jsonb
      when t.track='premium' and l.level=10 then '{"sku":"case_sovereign"}'::jsonb
      when t.track='premium' and l.level=4 then jsonb_build_object('itemKey',w.metadata->'exclusiveFrameKeys'->>0,'duplicateMxm',6000)
      when t.track='premium' and l.level=8 then jsonb_build_object('itemKey',w.metadata->'exclusiveFrameKeys'->>1,'duplicateMxm',9000)
      when t.track='premium' and l.level=12 then jsonb_build_object('itemKey',w.metadata->'exclusiveFrameKeys'->>2,'duplicateMxm',15000)
      else '{}'::jsonb
    end as metadata
  from weekly w cross join levels l cross join (values ('free'),('premium')) t(track)
)
insert into public.season_rewards(season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata)
select season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata from rewards;

create or replace function public.ensure_current_season_v200()
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_current uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('mxm-current-week-v071',0));
  select id into v_current
  from public.seasons
  where active=true and now()>=starts_at and now()<ends_at
  order by starts_at desc limit 1;
  if v_current is null then
    raise exception 'Weekly season schedule is missing for current date';
  end if;
  return v_current;
end;
$$;

create or replace function public.season_snapshot_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_season public.seasons;
  v_next public.seasons;
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
  select * into v_season from public.seasons
  where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if not found then raise exception 'No active weekly season'; end if;
  select * into v_next from public.seasons
  where active=true and starts_at>=v_season.ends_at order by starts_at asc limit 1;
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;

  select coalesce(sum(amount),0)::integer into v_xp from public.profile_xp_events
  where profile_id=p_profile_id and created_at>=v_season.starts_at and created_at<v_season.ends_at;
  select coalesce(max(level),1) into v_level from public.season_rewards
  where season_id=v_season.id and track='free' and required_xp<=v_xp;
  select exists(select 1 from public.profile_entitlements
    where profile_id=p_profile_id and entitlement_key='season_pass'
      and (expires_at is null or expires_at>now())
      and coalesce(metadata->>'seasonId',v_season.id::text)=v_season.id::text) into v_premium;

  select coalesce(jsonb_agg(jsonb_build_object(
    'level',q.level,'requiredXp',q.required_xp,
    'freeReward',jsonb_build_object('label',q.free_label,'kind',q.free_kind,'amount',q.free_amount,'metadata',q.free_metadata),
    'premiumReward',jsonb_build_object('label',q.premium_label,'kind',q.premium_kind,'amount',q.premium_amount,'metadata',q.premium_metadata),
    'freeClaimed',q.free_claimed,'premiumClaimed',q.premium_claimed
  ) order by q.level),'[]'::jsonb) into v_levels
  from (
    select f.level,f.required_xp,
      f.reward_label free_label,f.reward_kind free_kind,f.amount free_amount,f.metadata free_metadata,
      p.reward_label premium_label,p.reward_kind premium_kind,p.amount premium_amount,p.metadata premium_metadata,
      exists(select 1 from public.season_claims c where c.profile_id=p_profile_id and c.season_id=v_season.id and c.level=f.level and c.track='free') free_claimed,
      exists(select 1 from public.season_claims c where c.profile_id=p_profile_id and c.season_id=v_season.id and c.level=f.level and c.track='premium') premium_claimed
    from public.season_rewards f join public.season_rewards p
      on p.season_id=f.season_id and p.level=f.level and p.track='premium'
    where f.season_id=v_season.id and f.track='free'
  ) q;

  select coalesce(max(required_xp),0)::integer into v_max_xp
  from public.season_rewards where season_id=v_season.id;
  v_prestige:=greatest(0,floor(greatest(v_xp-v_max_xp,0)::numeric/300)::integer);
  select count(*)::integer into v_prestige_claimed
  from public.season_prestige_claims where profile_id=p_profile_id and season_id=v_season.id;
  v_next_spec:=public.season_prestige_reward_v064(v_prestige_claimed+1);

  return jsonb_build_object(
    'season',jsonb_build_object(
      'id',v_season.id,'title',v_season.title,'startsAt',v_season.starts_at,'endsAt',v_season.ends_at,
      'daysLeft',greatest(0,ceil(extract(epoch from (v_season.ends_at-now()))/86400.0)::integer),
      'weekNumber',v_season.week_number,'theme',v_season.metadata->>'theme',
      'exclusiveFrameKeys',coalesce(v_season.metadata->'exclusiveFrameKeys','[]'::jsonb)
    ),
    'nextSeason',case when v_next.id is null then null else jsonb_build_object(
      'id',v_next.id,'title',v_next.title,'startsAt',v_next.starts_at,'endsAt',v_next.ends_at,
      'weekNumber',v_next.week_number,'theme',v_next.metadata->>'theme',
      'exclusiveFrameKeys',coalesce(v_next.metadata->'exclusiveFrameKeys','[]'::jsonb)) end,
    'xp',v_xp,'level',v_level,'premium',v_premium,'levels',v_levels,
    'prestige',jsonb_build_object('unlocked',v_xp>=v_max_xp,'level',v_prestige,'claimed',v_prestige_claimed,
      'claimable',greatest(0,v_prestige-v_prestige_claimed),'stepXp',300,'baseXp',v_max_xp,
      'nextRequiredXp',v_max_xp+(v_prestige+1)*300,'nextClaimLevel',v_prestige_claimed+1,
      'nextReward',jsonb_build_object('kind',v_next_spec->>'kind','amount',(v_next_spec->>'amount')::integer,'label',v_next_spec->>'label'))
  );
end;
$$;

-- Patch season purchase fulfilment so the entitlement is bound to one week.
create or replace function public.bind_current_season_pass_v071(p_profile_id uuid,p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_season public.seasons;
begin
  perform public.ensure_current_season_v200();
  select * into v_season from public.seasons
  where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  insert into public.profile_entitlements(profile_id,entitlement_key,expires_at,metadata)
  values(p_profile_id,'season_pass',v_season.ends_at,jsonb_build_object('purchaseId',p_purchase_id,'seasonId',v_season.id,'weekNumber',v_season.week_number))
  on conflict(profile_id,entitlement_key) do update set
    expires_at=excluded.expires_at,metadata=excluded.metadata,updated_at=now();
  return jsonb_build_object('kind','entitlement','key','season_pass','expiresAt',v_season.ends_at,
    'seasonId',v_season.id,'weekNumber',v_season.week_number,'label','Премиум текущей недели');
end;
$$;

create or replace function public.sync_paid_weekly_pass_v071()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='paid'
     and (tg_op='INSERT' or old.status is distinct from 'paid')
     and new.product_sku='season_premium' then
    perform public.bind_current_season_pass_v071(new.profile_id,new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists star_purchase_weekly_pass_v071 on public.star_purchases;
create trigger star_purchase_weekly_pass_v071
after insert or update of status on public.star_purchases
for each row execute function public.sync_paid_weekly_pass_v071();

-- ---------------------------------------------------------------------------
-- Review-based verification.
-- ---------------------------------------------------------------------------

create table if not exists public.verification_requests_v071 (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check(target_type in ('creator','coin')),
  coin_id uuid references public.coins(id) on delete cascade,
  evidence text not null default '' check(char_length(evidence)<=1200),
  status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text check(review_note is null or char_length(review_note)<=600),
  tier text check(tier is null or tier in ('verified','notable')),
  check((target_type='coin' and coin_id is not null) or (target_type='creator' and coin_id is null))
);

create unique index if not exists verification_requests_pending_v071_idx
  on public.verification_requests_v071(profile_id,target_type,coalesce(coin_id,'00000000-0000-0000-0000-000000000000'::uuid))
  where status='pending';
create index if not exists verification_requests_queue_v071_idx
  on public.verification_requests_v071(status,requested_at);

create table if not exists public.coin_verifications_v071 (
  coin_id uuid primary key references public.coins(id) on delete cascade,
  tier text not null check(tier in ('verified','notable')),
  verified_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id) on delete set null,
  request_id uuid references public.verification_requests_v071(id) on delete set null,
  revoked_at timestamptz,
  revoked_reason text check(revoked_reason is null or char_length(revoked_reason)<=600)
);

create table if not exists public.creator_verifications_v071 (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  tier text not null check(tier in ('verified','notable')),
  verified_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id) on delete set null,
  request_id uuid references public.verification_requests_v071(id) on delete set null,
  revoked_at timestamptz,
  revoked_reason text check(revoked_reason is null or char_length(revoked_reason)<=600)
);

alter table public.verification_requests_v071 enable row level security;
alter table public.coin_verifications_v071 enable row level security;
alter table public.creator_verifications_v071 enable row level security;
revoke all on table public.verification_requests_v071,public.coin_verifications_v071,public.creator_verifications_v071 from public,anon,authenticated;
grant select,insert,update,delete on table public.verification_requests_v071,public.coin_verifications_v071,public.creator_verifications_v071 to service_role;

create or replace function public.review_verification_request_v071(
  p_request_id uuid,
  p_reviewer_profile_id uuid,
  p_decision text,
  p_note text default '',
  p_tier text default 'verified'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_request public.verification_requests_v071;
begin
  if p_decision not in ('approved','rejected','revoked') then raise exception 'Invalid verification decision'; end if;
  if p_tier not in ('verified','notable') then raise exception 'Invalid verification tier'; end if;
  if not exists(select 1 from public.profiles where id=p_reviewer_profile_id) then raise exception 'Reviewer profile missing'; end if;
  select * into v_request from public.verification_requests_v071 where id=p_request_id for update;
  if not found then raise exception 'Verification request not found'; end if;
  if v_request.status<>'pending' and p_decision<>'revoked' then raise exception 'Verification request already reviewed'; end if;

  if p_decision='approved' and v_request.target_type='coin' then
    insert into public.coin_verifications_v071(coin_id,tier,verified_at,verified_by,request_id,revoked_at,revoked_reason)
    values(v_request.coin_id,p_tier,now(),p_reviewer_profile_id,v_request.id,null,null)
    on conflict(coin_id) do update set tier=excluded.tier,verified_at=excluded.verified_at,
      verified_by=excluded.verified_by,request_id=excluded.request_id,revoked_at=null,revoked_reason=null;
  elsif p_decision='approved' then
    insert into public.creator_verifications_v071(profile_id,tier,verified_at,verified_by,request_id,revoked_at,revoked_reason)
    values(v_request.profile_id,p_tier,now(),p_reviewer_profile_id,v_request.id,null,null)
    on conflict(profile_id) do update set tier=excluded.tier,verified_at=excluded.verified_at,
      verified_by=excluded.verified_by,request_id=excluded.request_id,revoked_at=null,revoked_reason=null;
  elsif p_decision='revoked' and v_request.target_type='coin' then
    update public.coin_verifications_v071 set revoked_at=now(),revoked_reason=left(coalesce(p_note,''),600)
    where coin_id=v_request.coin_id;
  elsif p_decision='revoked' then
    update public.creator_verifications_v071 set revoked_at=now(),revoked_reason=left(coalesce(p_note,''),600)
    where profile_id=v_request.profile_id;
  end if;

  update public.verification_requests_v071 set status=p_decision,reviewed_at=now(),reviewed_by=p_reviewer_profile_id,
    review_note=left(coalesce(p_note,''),600),tier=case when p_decision='approved' then p_tier else tier end
  where id=v_request.id;
  return jsonb_build_object('status',p_decision,'targetType',v_request.target_type,'coinId',v_request.coin_id,
    'profileId',v_request.profile_id,'tier',case when p_decision='approved' then p_tier else null end);
end;
$$;

revoke execute on function public.ensure_current_season_v200() from public,anon,authenticated;
revoke execute on function public.season_snapshot_v200(uuid) from public,anon,authenticated;
revoke execute on function public.bind_current_season_pass_v071(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.sync_paid_weekly_pass_v071() from public,anon,authenticated;
revoke execute on function public.review_verification_request_v071(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.ensure_current_season_v200(),public.season_snapshot_v200(uuid),
  public.bind_current_season_pass_v071(uuid,uuid),public.review_verification_request_v071(uuid,uuid,text,text,text) to service_role;

commit;
