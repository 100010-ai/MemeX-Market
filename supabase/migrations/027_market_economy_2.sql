begin;

-- MXM Market Economy 2.0. All balances, rewards, cases, items and coins in
-- this migration are closed-loop game state. Nothing is withdrawable or a
-- representation of TON, Telegram Stars, securities, or real-world value.

-- ---------------------------------------------------------------------------
-- Economy configuration and wallet state.
-- ---------------------------------------------------------------------------

alter table public.economy_settings
  add column if not exists coin_initial_buy_min numeric(18,8) not null default 1 check(coin_initial_buy_min between 0 and 100000),
  add column if not exists coin_initial_buy_max numeric(18,8) not null default 1000 check(coin_initial_buy_max between 1 and 100000),
  add column if not exists coin_start_price_min numeric(30,16) not null default 0.00000001 check(coin_start_price_min > 0),
  add column if not exists coin_start_price_max numeric(30,16) not null default 0.000001 check(coin_start_price_max > 0),
  add column if not exists coin_floor_max_bps integer not null default 5000 check(coin_floor_max_bps between 0 and 9000),
  add column if not exists coin_total_fee_bps integer not null default 50 check(coin_total_fee_bps between 1 and 1000),
  add column if not exists creator_lock_bps integer not null default 5000 check(creator_lock_bps between 0 and 10000),
  add column if not exists creator_lock_days integer not null default 30 check(creator_lock_days between 1 and 365),
  add column if not exists early_buyer_limit integer not null default 100 check(early_buyer_limit between 1 and 10000),
  add column if not exists coin_launch_energy_cost integer not null default 20 check(coin_launch_energy_cost between 0 and 1000);

update public.economy_settings set
  schema_version=200,
  coin_initial_buy_min=1,
  coin_initial_buy_max=1000,
  coin_start_price_min=0.00000001,
  coin_start_price_max=0.000001,
  coin_floor_max_bps=5000,
  coin_total_fee_bps=50,
  creator_lock_bps=5000,
  creator_lock_days=30,
  early_buyer_limit=100,
  coin_launch_energy_cost=20,
  updated_at=now()
where singleton=true;
alter table public.economy_settings alter column schema_version set default 200;

alter table public.profiles
  add column if not exists mxm_coins bigint not null default 0 check(mxm_coins between 0 and 9000000000000000),
  add column if not exists energy integer not null default 100 check(energy between 0 and 10000),
  add column if not exists max_energy integer not null default 100 check(max_energy between 1 and 10000),
  add column if not exists premium_until timestamptz,
  add column if not exists premium_daily_claimed_on date,
  add column if not exists stars_spent bigint not null default 0 check(stars_spent >= 0),
  add column if not exists vip_points bigint not null default 0 check(vip_points >= 0),
  add column if not exists energy_updated_at timestamptz not null default now(),
  add column if not exists equipped_profile_frame text;

alter table public.coins
  add column if not exists launch_price numeric(30,16),
  add column if not exists floor_price numeric(30,16),
  add column if not exists floor_expires_at timestamptz,
  add column if not exists initial_buy_quote numeric(24,8) not null default 0,
  add column if not exists initial_buy_tokens numeric(30,8) not null default 0;
update public.coins set launch_price=coalesce(launch_price,current_price) where launch_price is null;
alter table public.coins alter column launch_price set not null;

-- Auditable, idempotent VIP progression from meaningful market activity.
-- Dust trades earn nothing, each trade is capped, and activity grants share a
-- UTC-day cap. Stars remain uncapped paid progression in the purchase ledger.
create table if not exists public.vip_point_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_kind text not null check(source_kind in ('coin_buy','coin_sell','coin_launch')),
  reference_id uuid not null,
  activity_value numeric(24,8) not null check(activity_value>0),
  points integer not null check(points between 0 and 100),
  created_at timestamptz not null default now(),
  unique(source_kind,reference_id)
);
create index if not exists vip_point_events_profile_day_v200_idx
  on public.vip_point_events(profile_id,created_at desc);

-- One row per purchasable SKU. Prices and fulfilment metadata are authoritative
-- here; lib/store.ts is only a rolling-deploy fallback catalogue.
create table if not exists public.store_products (
  sku text primary key check(sku ~ '^[a-z0-9_]{3,48}$'),
  category text not null check(category in ('currency','membership','season','cases','creator','profile','energy')),
  title text not null check(char_length(title) between 2 and 64),
  description text not null default '' check(char_length(description) <= 400),
  stars_price integer not null check(stars_price between 1 and 100000),
  reward_label text not null check(char_length(reward_label) between 1 and 80),
  badge text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.store_products drop constraint if exists store_products_stars_price_check;
alter table public.store_products add constraint store_products_stars_price_v200_check check(stars_price between 5 and 100000);

insert into public.store_products(sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata,active) values
  ('mxm_starter','currency','Starter Pack','Virtual currency for the MXM closed-loop game economy.',50,'1 000 MXM Coins',null,10,'{"mxmCoins":1000}',true),
  ('mxm_trader','currency','Trader Pack','Virtual currency for the MXM closed-loop game economy.',180,'5 000 MXM Coins','+10%',20,'{"mxmCoins":5000}',true),
  ('mxm_whale','currency','Whale Pack','Virtual currency for the MXM closed-loop game economy.',650,'25 000 MXM Coins','Best value',30,'{"mxmCoins":25000}',true),
  ('mxm_investor','currency','Investor Pack','Virtual currency for the MXM closed-loop game economy.',1990,'100 000 MXM Coins','Maximum',40,'{"mxmCoins":100000}',true),
  ('premium_30d','membership','MXM Premium','Thirty days of Premium game benefits.',299,'30 days Premium','Premium',50,'{"entitlement":"premium","durationDays":30}',true),
  ('season_premium','season','Premium Track','Premium reward track for the current 30-day season.',199,'Premium Battle Pass','Season',60,'{"entitlement":"season_pass"}',true),
  ('case_starter','cases','Starter Case','A paid virtual case with disclosed odds.',25,'1 Starter Case',null,70,'{"caseTier":"starter","quantity":1}',true),
  ('case_rare','cases','Rare Case','A paid virtual case with disclosed odds.',79,'1 Rare Case','Rare',80,'{"caseTier":"rare","quantity":1}',true),
  ('case_legendary','cases','Legendary Case','A paid virtual case with disclosed odds.',199,'1 Legendary Case','Legendary',90,'{"caseTier":"legendary","quantity":1}',true),
  ('energy_refill','energy','Energy Refill','Restores virtual Energy to the account maximum.',20,'Full Energy',null,100,'{"energyRefill":true}',true),
  ('creator_boost_24h','creator','Coin Boost','Highlights one creator-owned coin for 24 hours.',99,'24 hour Boost','Creator',110,'{"creatorTool":"boost","durationHours":24,"requiresCoin":true}',true),
  ('creator_verified_30d','creator','Verified Creator','A 30-day virtual creator profile entitlement.',349,'Verified for 30 days','Verified',120,'{"entitlement":"creator_verified","durationDays":30}',true),
  ('creator_analytics_30d','creator','Advanced Analytics','A 30-day creator analytics entitlement.',249,'Analytics for 30 days',null,130,'{"entitlement":"creator_analytics","durationDays":30}',true),
  ('profile_neon_frame','profile','Neon Frame','A permanent virtual profile frame.',89,'Permanent profile item','Limited',140,'{"profileItem":"neon_frame","itemType":"frame"}',true)
on conflict(sku) do update set
  category=excluded.category,title=excluded.title,description=excluded.description,
  stars_price=excluded.stars_price,reward_label=excluded.reward_label,badge=excluded.badge,
  sort_order=excluded.sort_order,metadata=excluded.metadata,active=excluded.active,updated_at=now();

alter table public.star_purchases add column if not exists product_sku text references public.store_products(sku) on delete restrict;
alter table public.star_purchases add column if not exists product_context jsonb not null default '{}'::jsonb;
alter table public.star_purchases add column if not exists payer_telegram_id bigint;
alter table public.star_purchases add column if not exists refunded_at timestamptz;
alter table public.star_purchases add column if not exists refund_reason text;
alter table public.star_purchases add column if not exists refund_metadata jsonb not null default '{}'::jsonb;
alter table public.star_purchases add column if not exists precheckout_id text;
alter table public.star_purchases add column if not exists precheckout_authorized_at timestamptz;
alter table public.star_purchases add column if not exists expires_at timestamptz;
alter table public.star_purchases add column if not exists reserved_grant jsonb;
alter table public.star_purchases add column if not exists reservation_released_at timestamptz;
create unique index if not exists star_purchases_precheckout_v200_uidx on public.star_purchases(precheckout_id) where precheckout_id is not null;
create unique index if not exists star_purchases_nonrepeatable_auth_v200_uidx
  on public.star_purchases(profile_id,product_sku)
  where status='authorized' and product_sku in ('season_premium','energy_refill','profile_neon_frame');
alter table public.star_purchases alter column ton_reward set default 0;
alter table public.star_purchases drop constraint if exists star_purchases_stars_check;
alter table public.star_purchases add constraint star_purchases_stars_v200_check check(stars between 5 and 100000);
alter table public.star_purchases drop constraint if exists star_purchases_ton_reward_check;
alter table public.star_purchases add constraint star_purchases_ton_reward_v200_check check(ton_reward >= 0);
alter table public.star_purchases drop constraint if exists star_purchases_status_check;
alter table public.star_purchases add constraint star_purchases_status_v200_check
  check(status in ('pending','authorized','paid','cancelled','expired','refunded'));

update public.star_purchases sp set payer_telegram_id=p.telegram_id
from public.profiles p where p.id=sp.profile_id and sp.payer_telegram_id is null;
update public.star_purchases set expires_at=coalesce(expires_at,created_at+interval '30 minutes') where expires_at is null;
alter table public.star_purchases alter column expires_at set default (now()+interval '30 minutes');

create or replace function public.set_star_purchase_payer_v200()
returns trigger language plpgsql set search_path=public as $$
begin
  select telegram_id into new.payer_telegram_id from public.profiles where id=new.profile_id;
  if new.payer_telegram_id is null then raise exception 'Purchase payer profile is missing'; end if;
  new.expires_at:=coalesce(new.expires_at,now()+interval '30 minutes');
  return new;
end;
$$;
drop trigger if exists star_purchase_payer_v200 on public.star_purchases;
create trigger star_purchase_payer_v200 before insert on public.star_purchases
for each row execute function public.set_star_purchase_payer_v200();

create table if not exists public.profile_entitlements (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  entitlement_key text not null check(entitlement_key ~ '^[a-z0-9:_-]{3,80}$'),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(profile_id,entitlement_key)
);

create table if not exists public.profile_inventory (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sku text not null check(sku ~ '^[a-z0-9:_-]{3,80}$'),
  quantity integer not null default 0 check(quantity between 0 and 1000000),
  updated_at timestamptz not null default now(),
  primary key(profile_id,sku)
);

create table if not exists public.profile_items (
  item_key text primary key check(item_key ~ '^[a-z0-9:_-]{3,100}$'),
  item_type text not null check(item_type in ('frame','badge','collectible')),
  title text not null,
  rarity text not null default 'common' check(rarity in ('common','rare','epic','legendary')),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.profile_items(item_key,item_type,title,rarity,metadata) values
  ('neon_frame','frame','Neon Frame','epic','{"source":"store"}'),
  ('case_pixel_badge','badge','Pixel Pioneer','common','{"source":"case"}'),
  ('case_rare_badge','badge','Rare Signal','rare','{"source":"case"}'),
  ('case_legend_badge','badge','Market Legend','legendary','{"source":"case"}')
on conflict(item_key) do update set item_type=excluded.item_type,title=excluded.title,rarity=excluded.rarity,metadata=excluded.metadata,active=true;

create table if not exists public.profile_item_inventory (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_key text not null references public.profile_items(item_key) on delete restrict,
  acquired_at timestamptz not null default now(),
  source text not null default 'system',
  source_reference uuid,
  primary key(profile_id,item_key)
);

create table if not exists public.coin_boosts (
  id uuid primary key default gen_random_uuid(),
  coin_id uuid not null references public.coins(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'boost' check(kind in ('boost')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  purchase_id uuid references public.star_purchases(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(purchase_id)
);
create index if not exists coin_boosts_active_v200_idx on public.coin_boosts(coin_id,ends_at desc);

-- ---------------------------------------------------------------------------
-- Paid virtual cases with disclosed, database-authoritative odds.
-- ---------------------------------------------------------------------------

create table if not exists public.case_definitions (
  sku text primary key references public.store_products(sku) on delete restrict,
  title text not null,
  tier text not null check(tier in ('starter','rare','legendary')),
  description text not null,
  remaining_supply integer check(remaining_supply is null or remaining_supply >= 0),
  active boolean not null default true
);
insert into public.case_definitions(sku,title,tier,description,remaining_supply) values
  ('case_starter','Starter Case','starter','MXM Coins, Energy and a common collectible.',100000),
  ('case_rare','Rare Case','rare','Larger virtual rewards and rare profile items.',25000),
  ('case_legendary','Legendary Case','legendary','The largest virtual rewards and legendary items.',5000)
on conflict(sku) do update set title=excluded.title,tier=excluded.tier,description=excluded.description,active=true;

create table if not exists public.case_loot_definitions (
  id uuid primary key default gen_random_uuid(),
  case_sku text not null references public.case_definitions(sku) on delete cascade,
  reward_key text not null,
  reward_kind text not null check(reward_kind in ('mxm_coins','energy','profile_item')),
  reward_label text not null,
  amount integer not null default 1 check(amount between 1 and 1000000),
  weight integer not null check(weight between 1 and 1000000),
  rarity text not null check(rarity in ('common','rare','epic','legendary')),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  unique(case_sku,reward_key)
);
insert into public.case_loot_definitions(case_sku,reward_key,reward_kind,reward_label,amount,weight,rarity,metadata) values
  ('case_starter','mxm_100','mxm_coins','100 MXM Coins',100,6000,'common','{}'),
  ('case_starter','energy_25','energy','25 Energy (overflow: 5 MXM each)',25,3000,'common','{}'),
  ('case_starter','pixel_badge','profile_item','Pixel Pioneer Badge (duplicate: 250 MXM)',1,1000,'rare','{"itemKey":"case_pixel_badge","duplicateMxm":250}'),
  ('case_rare','mxm_500','mxm_coins','500 MXM Coins',500,5000,'common','{}'),
  ('case_rare','energy_75','energy','75 Energy (overflow: 5 MXM each)',75,2500,'rare','{}'),
  ('case_rare','rare_badge','profile_item','Rare Signal Badge (duplicate: 1 000 MXM)',1,2000,'epic','{"itemKey":"case_rare_badge","duplicateMxm":1000}'),
  ('case_rare','mxm_2500','mxm_coins','2 500 MXM Coins',2500,500,'legendary','{}'),
  ('case_legendary','mxm_2000','mxm_coins','2 000 MXM Coins',2000,5500,'rare','{}'),
  ('case_legendary','energy_150','energy','150 Energy (overflow: 5 MXM each)',150,2500,'epic','{}'),
  ('case_legendary','legend_badge','profile_item','Market Legend Badge (duplicate: 5 000 MXM)',1,1500,'legendary','{"itemKey":"case_legend_badge","duplicateMxm":5000}'),
  ('case_legendary','mxm_10000','mxm_coins','10 000 MXM Coins',10000,500,'legendary','{}')
on conflict(case_sku,reward_key) do update set
  reward_kind=excluded.reward_kind,reward_label=excluded.reward_label,amount=excluded.amount,
  weight=excluded.weight,rarity=excluded.rarity,metadata=excluded.metadata,active=true;

create table if not exists public.case_openings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  case_sku text not null references public.case_definitions(sku) on delete restrict,
  loot_id uuid not null references public.case_loot_definitions(id) on delete restrict,
  reward_kind text not null,
  reward_label text not null,
  reward_amount integer not null,
  rarity text not null,
  opened_at timestamptz not null default now()
);
create index if not exists case_openings_profile_v200_idx on public.case_openings(profile_id,opened_at desc);

-- ---------------------------------------------------------------------------
-- Thirty-day season and two reward tracks.
-- ---------------------------------------------------------------------------

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  season_key text not null unique,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at > starts_at),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.seasons(season_key,title,starts_at,ends_at,active)
values('market-2-launch','Meme Season: Genesis',date_trunc('day',now()),date_trunc('day',now())+interval '30 days',true)
on conflict(season_key) do nothing;

create table if not exists public.season_rewards (
  season_id uuid not null references public.seasons(id) on delete cascade,
  level integer not null check(level between 1 and 100),
  track text not null check(track in ('free','premium')),
  required_xp integer not null check(required_xp >= 0),
  reward_kind text not null check(reward_kind in ('mxm_coins','energy','case','profile_item')),
  reward_label text not null,
  amount integer not null check(amount between 1 and 1000000),
  metadata jsonb not null default '{}'::jsonb,
  primary key(season_id,level,track)
);

with s as (select id from public.seasons where season_key='market-2-launch')
insert into public.season_rewards(season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata)
select s.id,v.level,v.track,v.required_xp,v.reward_kind,v.reward_label,v.amount,v.metadata
from s cross join (values
  (1,'free',0,'mxm_coins','100 MXM Coins',100,'{}'::jsonb),(1,'premium',0,'mxm_coins','500 MXM Coins',500,'{}'::jsonb),
  (2,'free',20,'energy','25 Energy',25,'{}'),(2,'premium',20,'case','1 Starter Case',1,'{"sku":"case_starter"}'),
  (3,'free',50,'mxm_coins','250 MXM Coins',250,'{}'),(3,'premium',50,'mxm_coins','1 000 MXM Coins',1000,'{}'),
  (4,'free',90,'case','1 Starter Case',1,'{"sku":"case_starter"}'),(4,'premium',90,'energy','100 Energy',100,'{}'),
  (5,'free',140,'mxm_coins','500 MXM Coins',500,'{}'),(5,'premium',140,'case','1 Rare Case',1,'{"sku":"case_rare"}'),
  (6,'free',200,'energy','50 Energy',50,'{}'),(6,'premium',200,'mxm_coins','2 000 MXM Coins',2000,'{}'),
  (7,'free',275,'mxm_coins','750 MXM Coins',750,'{}'),(7,'premium',275,'case','1 Rare Case',1,'{"sku":"case_rare"}'),
  (8,'free',365,'case','1 Starter Case',1,'{"sku":"case_starter"}'),(8,'premium',365,'mxm_coins','3 000 MXM Coins',3000,'{}'),
  (9,'free',470,'mxm_coins','1 000 MXM Coins',1000,'{}'),(9,'premium',470,'energy','150 Energy',150,'{}'),
  (10,'free',600,'case','1 Rare Case',1,'{"sku":"case_rare"}'),(10,'premium',600,'case','1 Legendary Case',1,'{"sku":"case_legendary"}')
) as v(level,track,required_xp,reward_kind,reward_label,amount,metadata)
on conflict(season_id,level,track) do update set
  required_xp=excluded.required_xp,reward_kind=excluded.reward_kind,reward_label=excluded.reward_label,
  amount=excluded.amount,metadata=excluded.metadata;

create table if not exists public.season_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  level integer not null,
  track text not null check(track in ('free','premium')),
  reward jsonb not null,
  claimed_at timestamptz not null default now(),
  primary key(profile_id,season_id,level,track),
  foreign key(season_id,level,track) references public.season_rewards(season_id,level,track) on delete restrict
);

create or replace function public.ensure_current_season_v200()
returns uuid language plpgsql security definer set search_path=public as $$
declare v_current uuid; v_source uuid; v_start timestamptz:=date_trunc('day',now());
begin
  perform pg_advisory_xact_lock(hashtextextended('mxm-current-season-v200',0));
  select id into v_current from public.seasons where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if v_current is not null then return v_current; end if;
  update public.seasons set active=false where active=true and ends_at<=now();
  select id into v_source from public.seasons where season_key='market-2-launch';
  insert into public.seasons(season_key,title,starts_at,ends_at,active)
  values('season-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),'Meme Season '||to_char(v_start,'YYYY-MM'),v_start,v_start+interval '30 days',true)
  returning id into v_current;
  insert into public.season_rewards(season_id,level,track,required_xp,reward_kind,reward_label,amount,metadata)
  select v_current,level,track,required_xp,reward_kind,reward_label,amount,metadata
  from public.season_rewards where season_id=v_source;
  return v_current;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creator launch, fee, lock and genesis-buyer ledgers.
-- ---------------------------------------------------------------------------

create table if not exists public.coin_launch_requests (
  request_id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  fingerprint text not null,
  coin_id uuid not null references public.coins(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.creator_token_locks (
  coin_id uuid not null references public.coins(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  total_locked numeric(30,8) not null check(total_locked >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at > starts_at),
  created_at timestamptz not null default now(),
  primary key(coin_id,profile_id)
);

create table if not exists public.coin_early_buyers (
  coin_id uuid not null references public.coins(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  ordinal integer not null check(ordinal > 0),
  first_trade_id uuid not null references public.trades(id) on delete cascade,
  first_bought_at timestamptz not null default now(),
  primary key(coin_id,profile_id),
  unique(coin_id,ordinal)
);

create table if not exists public.coin_fee_ledger (
  trade_id uuid primary key references public.trades(id) on delete cascade,
  coin_id uuid not null references public.coins(id) on delete cascade,
  trader_profile_id uuid not null references public.profiles(id) on delete cascade,
  creator_profile_id uuid references public.profiles(id) on delete set null,
  side text not null check(side in ('buy','sell')),
  fee_base numeric(24,8) not null check(fee_base > 0),
  total_fee numeric(24,8) not null check(total_fee >= 0),
  platform_fee numeric(24,8) not null check(platform_fee >= 0),
  creator_fee numeric(24,8) not null check(creator_fee >= 0),
  creator_fee_bps integer not null check(creator_fee_bps between 0 and 1000),
  platform_fee_bps integer not null check(platform_fee_bps between 0 and 1000),
  created_at timestamptz not null default now(),
  check(abs(total_fee-platform_fee-creator_fee) <= 0.00000002)
);
create index if not exists coin_fee_ledger_creator_v200_idx on public.coin_fee_ledger(creator_profile_id,created_at desc);

-- Stop the old inferred-fee trigger: v2.00 records the exact platform/creator
-- split itself and balances it to the cent-equivalent precision of virtual TON.
drop trigger if exists trades_economy_fee_v045 on public.trades;

alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events add constraint economy_events_kind_check check(kind in (
  'rewarded_ad','coin_launch','coin_trade_fee','coin_creator_fee','coin_platform_fee',
  'mission','admin','system','stars','store','case','season','premium','referral',
  'sponsored_task','promo_code','collection_bonus'
));

-- ---------------------------------------------------------------------------
-- Row-level access: application mutations remain service-role-only.
-- ---------------------------------------------------------------------------

alter table public.store_products enable row level security;
alter table public.profile_entitlements enable row level security;
alter table public.profile_inventory enable row level security;
alter table public.profile_items enable row level security;
alter table public.profile_item_inventory enable row level security;
alter table public.coin_boosts enable row level security;
alter table public.case_definitions enable row level security;
alter table public.case_loot_definitions enable row level security;
alter table public.case_openings enable row level security;
alter table public.seasons enable row level security;
alter table public.season_rewards enable row level security;
alter table public.season_claims enable row level security;
alter table public.coin_launch_requests enable row level security;
alter table public.creator_token_locks enable row level security;
alter table public.coin_early_buyers enable row level security;
alter table public.coin_fee_ledger enable row level security;
alter table public.vip_point_events enable row level security;

revoke all on public.store_products,public.profile_entitlements,public.profile_inventory,
  public.profile_items,public.profile_item_inventory,public.coin_boosts,public.case_definitions,
  public.case_loot_definitions,public.case_openings,public.seasons,public.season_rewards,
  public.season_claims,public.coin_launch_requests,public.creator_token_locks,
  public.coin_early_buyers,public.coin_fee_ledger,public.vip_point_events from public,anon,authenticated;
grant all on public.store_products,public.profile_entitlements,public.profile_inventory,
  public.profile_items,public.profile_item_inventory,public.coin_boosts,public.case_definitions,
  public.case_loot_definitions,public.case_openings,public.seasons,public.season_rewards,
  public.season_claims,public.coin_launch_requests,public.creator_token_locks,
  public.coin_early_buyers,public.coin_fee_ledger,public.vip_point_events to service_role;

-- MXM Coins have concrete closed-loop spend sinks. These tables precede the
-- wallet snapshot because that function exposes their active catalogue.
create table if not exists public.mxm_sink_products (
  sku text primary key references public.store_products(sku) on delete restrict,
  mxm_price bigint not null check(mxm_price between 1 and 1000000000),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.mxm_sink_products(sku,mxm_price,active,sort_order) values
  ('case_starter',1400,true,10),('case_rare',4400,true,20),('case_legendary',11000,true,30),
  ('energy_refill',1100,true,40),('profile_neon_frame',4900,true,50)
on conflict(sku) do update set mxm_price=excluded.mxm_price,active=excluded.active,sort_order=excluded.sort_order,updated_at=now();
create table if not exists public.mxm_purchase_requests (
  request_id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sku text not null references public.mxm_sink_products(sku) on delete restrict,
  price bigint not null check(price>0),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.mxm_sink_products enable row level security;
alter table public.mxm_purchase_requests enable row level security;
revoke all on public.mxm_sink_products,public.mxm_purchase_requests from public,anon,authenticated;
grant all on public.mxm_sink_products,public.mxm_purchase_requests to service_role;

-- ---------------------------------------------------------------------------
-- Shared virtual reward primitives and account snapshots.
-- ---------------------------------------------------------------------------

create or replace function public.refresh_profile_energy_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_step_seconds integer;
  v_units integer;
  v_target_max integer;
begin
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  v_target_max:=case when v_profile.premium_until>now() then 150 else 100 end;
  if v_profile.max_energy<>v_target_max or v_profile.energy>v_target_max then
    update public.profiles set max_energy=v_target_max,energy=least(energy,v_target_max),updated_at=now()
    where id=p_profile_id returning * into v_profile;
  end if;
  v_step_seconds:=case when v_profile.premium_until>now() then 300 else 600 end;
  if v_profile.energy>=v_profile.max_energy then
    update public.profiles set energy=max_energy,energy_updated_at=now() where id=p_profile_id;
    return jsonb_build_object('energy',v_profile.max_energy,'maxEnergy',v_profile.max_energy,'regenSeconds',v_step_seconds);
  end if;
  v_units:=greatest(0,floor(extract(epoch from (now()-v_profile.energy_updated_at))/v_step_seconds)::integer);
  if v_units>0 then
    update public.profiles set
      energy=least(max_energy,energy+v_units),
      energy_updated_at=case when energy+v_units>=max_energy then now()
        else energy_updated_at+make_interval(secs=>v_units*v_step_seconds) end,
      updated_at=now()
    where id=p_profile_id returning * into v_profile;
  end if;
  return jsonb_build_object('energy',v_profile.energy,'maxEnergy',v_profile.max_energy,'regenSeconds',v_step_seconds);
end;
$$;

create or replace function public.grant_virtual_reward_v200(
  p_profile_id uuid,
  p_kind text,
  p_amount integer,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'system',
  p_reference_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_item_key text;
  v_sku text;
  v_profile public.profiles;
  v_energy_credit integer:=0;
  v_overflow integer:=0;
  v_overflow_mxm bigint:=0;
begin
  if p_amount is null or p_amount<=0 then raise exception 'Reward amount must be positive'; end if;
  if p_kind='energy' then perform public.refresh_profile_energy_v200(p_profile_id); end if;
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;

  if p_kind='mxm_coins' then
    update public.profiles set mxm_coins=mxm_coins+p_amount,updated_at=now() where id=p_profile_id;
  elsif p_kind='energy' then
    v_energy_credit:=least(p_amount,greatest(0,v_profile.max_energy-v_profile.energy));
    v_overflow:=p_amount-v_energy_credit;
    v_overflow_mxm:=v_overflow::bigint*5;
    update public.profiles set energy=energy+v_energy_credit,mxm_coins=mxm_coins+v_overflow_mxm,
      energy_updated_at=now(),updated_at=now() where id=p_profile_id;
  elsif p_kind='case' then
    v_sku:=nullif(p_metadata->>'sku','');
    if v_sku is null or not exists(select 1 from public.case_definitions where sku=v_sku and active=true) then
      raise exception 'Case reward is invalid';
    end if;
    insert into public.profile_inventory(profile_id,sku,quantity)
    values(p_profile_id,v_sku,p_amount)
    on conflict(profile_id,sku) do update set quantity=public.profile_inventory.quantity+excluded.quantity,updated_at=now();
  elsif p_kind='profile_item' then
    v_item_key:=nullif(p_metadata->>'itemKey','');
    if v_item_key is null or not exists(select 1 from public.profile_items where item_key=v_item_key and active=true) then
      raise exception 'Profile item reward is invalid';
    end if;
    insert into public.profile_item_inventory(profile_id,item_key,source,source_reference)
    values(p_profile_id,v_item_key,left(coalesce(nullif(p_source,''),'system'),40),p_reference_id)
    on conflict(profile_id,item_key) do nothing;
  else
    raise exception 'Unsupported virtual reward kind';
  end if;

  return jsonb_build_object(
    'kind',case when p_kind='energy' and v_energy_credit=0 then 'mxm_coins' else p_kind end,
    'amount',case when p_kind='energy' and v_energy_credit=0 then v_overflow_mxm
      when p_kind='energy' then v_energy_credit else p_amount end,
    'creditedEnergy',case when p_kind='energy' then v_energy_credit else null end,
    'overflowMxmCoins',case when p_kind='energy' then v_overflow_mxm else 0 end,
    'label',case when p_kind='energy' and v_overflow>0 then
      v_energy_credit::text||' Energy + '||v_overflow_mxm::text||' MXM overflow compensation'
    else coalesce(nullif(p_metadata->>'label',''),
      case p_kind when 'mxm_coins' then p_amount::text||' MXM Coins'
                  when 'energy' then p_amount::text||' Energy'
                  when 'case' then p_amount::text||' case'
                  else coalesce(v_item_key,'Profile item') end) end
  );
end;
$$;

create or replace function public.equip_profile_item_v200(p_profile_id uuid,p_item_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item public.profile_items;
begin
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select i.* into v_item
  from public.profile_items i join public.profile_item_inventory pi on pi.item_key=i.item_key
  where pi.profile_id=p_profile_id and i.item_key=p_item_key and i.active=true;
  if not found then raise exception 'Profile item is not owned'; end if;
  if v_item.item_type<>'frame' then raise exception 'Only profile frames can be equipped'; end if;
  update public.profiles set equipped_profile_frame=v_item.item_key,updated_at=now() where id=p_profile_id;
  return jsonb_build_object('status','equipped','key',v_item.item_key,'type',v_item.item_type);
end;
$$;

create or replace function public.monetization_snapshot_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_profile public.profiles;
  v_tier text;
  v_progress numeric;
  v_energy integer;
  v_regen_seconds integer;
  v_effective_max integer;
begin
  select * into v_profile from public.profiles where id=p_profile_id;
  if not found then raise exception 'Profile not found'; end if;

  if v_profile.vip_points>=50000 then v_tier:='Diamond'; v_progress:=100;
  elsif v_profile.vip_points>=20000 then v_tier:='Platinum'; v_progress:=100*(v_profile.vip_points-20000)/30000.0;
  elsif v_profile.vip_points>=5000 then v_tier:='Gold'; v_progress:=100*(v_profile.vip_points-5000)/15000.0;
  elsif v_profile.vip_points>=1000 then v_tier:='Silver'; v_progress:=100*(v_profile.vip_points-1000)/4000.0;
  else v_tier:='Bronze'; v_progress:=100*v_profile.vip_points/1000.0;
  end if;
  v_regen_seconds:=case when v_profile.premium_until>now() then 300 else 600 end;
  v_effective_max:=case when v_profile.premium_until>now() then 150 else 100 end;
  v_energy:=least(v_effective_max,v_profile.energy+greatest(0,
    floor(extract(epoch from (now()-v_profile.energy_updated_at))/v_regen_seconds)::integer));

  return jsonb_build_object(
    'wallet',jsonb_build_object(
      'mxmCoins',v_profile.mxm_coins,
      'energy',v_energy,
      'maxEnergy',v_effective_max,
      'energyRegenSeconds',v_regen_seconds,
      'energyUpdatedAt',v_profile.energy_updated_at,
      'premiumUntil',v_profile.premium_until,
      'premiumActive',coalesce(v_profile.premium_until>now(),false),
      'dailyBonusAvailable',coalesce(v_profile.premium_until>now(),false)
        and v_profile.premium_daily_claimed_on is distinct from (now() at time zone 'UTC')::date,
      'vipTier',v_tier,
      'vipPoints',v_profile.vip_points,
      'vipNextThreshold',case v_tier when 'Bronze' then 1000 when 'Silver' then 5000
        when 'Gold' then 20000 when 'Platinum' then 50000 else null end,
      'vipProgress',round(greatest(0,least(100,v_progress)),2)
    ),
    'inventory',coalesce((
      select jsonb_agg(jsonb_build_object('sku',i.sku,'quantity',i.quantity) order by i.sku)
      from public.profile_inventory i where i.profile_id=p_profile_id and i.quantity>0
    ),'[]'::jsonb),
    'entitlements',coalesce((
      select jsonb_agg(jsonb_build_object('key',e.entitlement_key,'expiresAt',e.expires_at) order by e.entitlement_key)
      from public.profile_entitlements e
      where e.profile_id=p_profile_id and (e.expires_at is null or e.expires_at>now())
    ),'[]'::jsonb),
    'profileItems',coalesce((
      select jsonb_agg(jsonb_build_object(
        'key',i.item_key,'type',i.item_type,'title',i.title,
        'equipped',i.item_type='frame' and v_profile.equipped_profile_frame=i.item_key
      ) order by pi.acquired_at,i.item_key)
      from public.profile_item_inventory pi join public.profile_items i on i.item_key=pi.item_key
      where pi.profile_id=p_profile_id and i.active=true
    ),'[]'::jsonb),
    'mxmShop',coalesce((
      select jsonb_agg(jsonb_build_object('sku',s.sku,'mxmPrice',s.mxm_price,'title',p.title,
        'rewardLabel',p.reward_label,'metadata',p.metadata) order by s.sort_order)
      from public.mxm_sink_products s join public.store_products p on p.sku=s.sku
      where s.active=true and p.active=true
    ),'[]'::jsonb),
    'creatorCoins',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'symbol',c.symbol) order by c.created_at desc)
      from public.coins c where c.creator_profile_id=p_profile_id and c.status='active'
        and coalesce(c.hidden_from_market,false)=false
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.claim_premium_daily_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles; v_day date:=(now() at time zone 'UTC')::date; v_energy_credit integer:=0;
begin
  perform public.refresh_profile_energy_v200(p_profile_id);
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.premium_until is null or v_profile.premium_until<=now() then
    return jsonb_build_object('status','premium_required');
  end if;
  if v_profile.premium_daily_claimed_on=v_day then
    return jsonb_build_object('status','already_claimed','alreadyClaimed',true,'mxmCoins',v_profile.mxm_coins,'energy',v_profile.energy);
  end if;
  v_energy_credit:=least(25,greatest(0,v_profile.max_energy-v_profile.energy));
  update public.profiles set
    premium_daily_claimed_on=v_day,
    mxm_coins=mxm_coins+250,
    energy=energy+v_energy_credit,
    energy_updated_at=now(),
    updated_at=now()
  where id=p_profile_id returning * into v_profile;
  insert into public.economy_events(profile_id,kind,amount,metadata)
  values(p_profile_id,'premium',250,jsonb_build_object('unit','mxm_coins','energy',v_energy_credit,'day',v_day));
  return jsonb_build_object('status','claimed','alreadyClaimed',false,'reward',jsonb_build_object('mxmCoins',250,'energy',v_energy_credit),'mxmCoins',v_profile.mxm_coins,'energy',v_profile.energy);
end;
$$;

-- ---------------------------------------------------------------------------
-- Telegram Stars fulfilment. A purchase row and charge can be finalized once;
-- all product grants occur in this same database transaction.
-- ---------------------------------------------------------------------------

create or replace function public.store_purchase_eligibility_v200(
  p_profile_id uuid,p_product_sku text,p_product_context jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_product public.store_products;
  v_profile public.profiles;
  v_effective_energy integer;
  v_effective_max integer;
  v_step integer;
  v_coin_id uuid;
  v_item text;
  v_season_id uuid;
  v_remaining integer;
  v_boost_slots integer:=0;
  v_boost_occupied boolean:=false;
  v_reason text:=null;
begin
  select * into v_product from public.store_products where sku=p_product_sku and active=true;
  if not found then return jsonb_build_object('eligible',false,'reason','product_unavailable'); end if;
  select * into v_profile from public.profiles where id=p_profile_id;
  if not found then return jsonb_build_object('eligible',false,'reason','profile_missing'); end if;
  if (v_product.metadata->>'entitlement'='season_pass' or v_product.metadata ? 'profileItem'
      or coalesce((v_product.metadata->>'energyRefill')::boolean,false))
     and exists(select 1 from public.star_purchases sp where sp.profile_id=p_profile_id
       and sp.product_sku=p_product_sku and sp.status='authorized'
       and sp.expires_at>now()-interval '15 minutes') then
    v_reason:='active_purchase_reservation';
  end if;
  if v_reason is null and v_product.metadata ? 'caseTier' then
    select remaining_supply into v_remaining from public.case_definitions where sku=v_product.sku and active=true;
    if not found or (v_remaining is not null and v_remaining<=0) then v_reason:='case_sold_out'; end if;
    if v_reason is null and (not exists(select 1 from public.case_loot_definitions where case_sku=v_product.sku and active=true and weight>0)
      or exists(select 1 from public.case_loot_definitions l where l.case_sku=v_product.sku and l.active=true
        and l.reward_kind='profile_item' and not exists(select 1 from public.profile_items i where i.item_key=l.metadata->>'itemKey' and i.active=true))) then
      v_reason:='case_config_invalid';
    end if;
  elsif v_reason is null and v_product.metadata->>'entitlement'='season_pass' then
    v_season_id:=public.ensure_current_season_v200();
    if exists(select 1 from public.profile_entitlements where profile_id=p_profile_id and entitlement_key='season_pass'
      and (expires_at is null or expires_at>now())) then v_reason:='season_pass_owned'; end if;
  elsif v_reason is null and v_product.metadata ? 'profileItem' then
    v_item:=v_product.metadata->>'profileItem';
    if exists(select 1 from public.profile_item_inventory where profile_id=p_profile_id and item_key=v_item) then
      v_reason:='profile_item_owned';
    end if;
  elsif v_reason is null and coalesce((v_product.metadata->>'energyRefill')::boolean,false) then
    v_step:=case when v_profile.premium_until>now() then 300 else 600 end;
    v_effective_max:=case when v_profile.premium_until>now() then 150 else 100 end;
    v_effective_energy:=least(v_effective_max,v_profile.energy+greatest(0,
      floor(extract(epoch from (now()-v_profile.energy_updated_at))/v_step)::integer));
    if v_effective_energy>=v_effective_max then v_reason:='energy_full'; end if;
  elsif v_reason is null and coalesce((v_product.metadata->>'requiresCoin')::boolean,false) then
    begin v_coin_id:=(coalesce(p_product_context,'{}'::jsonb)->>'coinId')::uuid;
    exception when others then v_coin_id:=null; end;
    if v_coin_id is null or not exists(select 1 from public.coins where id=v_coin_id and creator_profile_id=p_profile_id
      and status='active' and coalesce(hidden_from_market,false)=false) then
      v_reason:='invalid_creator_coin';
    end if;
    if v_reason is null and v_product.metadata->>'creatorTool'='boost' then
      if not coalesce((select (feature_flags->>'memecoins')::boolean
        from public.runtime_config_v056 where singleton=true),true) then
        v_reason:='memecoins_disabled';
      else
        with occupied as (
          select b.coin_id from public.coin_boosts b where b.kind='boost' and b.ends_at>now()
          union
          select c.id
          from public.star_purchases sp
          join public.coins c on c.id::text=sp.reserved_grant->'productContext'->>'coinId'
          where sp.status='authorized' and sp.expires_at>now()-interval '15 minutes'
            and sp.reserved_grant->'metadata'->>'creatorTool'='boost'
        )
        select count(*)::integer,coalesce(bool_or(coin_id=v_coin_id),false)
        into v_boost_slots,v_boost_occupied from occupied;
        if v_boost_slots>=48 and not v_boost_occupied then v_reason:='boost_capacity_full'; end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('eligible',v_reason is null,'reason',v_reason,'productSku',v_product.sku,
    'stars',v_product.stars_price,'remaining',v_remaining,'seasonId',v_season_id);
end;
$$;

create or replace function public.authorize_star_precheckout_v200(
  p_purchase_id uuid,p_payload text,p_query_id text,p_payer_telegram_id bigint,p_stars integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_purchase public.star_purchases;
  v_eligibility jsonb;
  v_product public.store_products;
  v_case public.case_definitions;
  v_quantity integer:=1;
  v_energy_amount integer;
  v_reserved jsonb;
begin
  perform set_config('lock_timeout','2s',true);
  perform public.release_expired_star_authorizations_v200(25);
  if p_query_id is null or length(trim(p_query_id))<4 then return jsonb_build_object('ok',false,'reason','query_id_missing'); end if;
  select * into v_purchase from public.star_purchases where id=p_purchase_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','purchase_missing'); end if;
  if v_purchase.status='authorized' then
    if v_purchase.precheckout_id=p_query_id and v_purchase.invoice_payload=p_payload
       and v_purchase.payer_telegram_id=p_payer_telegram_id and v_purchase.stars=p_stars then
      return jsonb_build_object('ok',true,'status','authorized','alreadyAuthorized',true);
    end if;
    return jsonb_build_object('ok',false,'reason','purchase_already_authorized');
  end if;
  if v_purchase.status<>'pending' then return jsonb_build_object('ok',false,'reason','invalid_status'); end if;
  perform pg_advisory_xact_lock(hashtextextended('star-auth:'||v_purchase.profile_id::text||':'||coalesce(v_purchase.product_sku,'legacy'),0));
  if v_purchase.expires_at is null or v_purchase.expires_at<=now() then
    update public.star_purchases set status='expired',updated_at=now() where id=p_purchase_id;
    return jsonb_build_object('ok',false,'reason','invoice_expired');
  end if;
  if v_purchase.invoice_payload is distinct from p_payload then return jsonb_build_object('ok',false,'reason','payload_mismatch'); end if;
  if v_purchase.payer_telegram_id is distinct from p_payer_telegram_id then return jsonb_build_object('ok',false,'reason','payer_mismatch'); end if;
  if v_purchase.stars is distinct from p_stars or p_stars<5 then return jsonb_build_object('ok',false,'reason','stars_mismatch'); end if;
  if v_purchase.product_sku is not null then
    select * into v_product from public.store_products where sku=v_purchase.product_sku and active=true;
    if not found then return jsonb_build_object('ok',false,'reason','product_unavailable'); end if;
    if not coalesce((select (feature_flags->>'stars')::boolean
      from public.runtime_config_v056 where singleton=true),true) then
      return jsonb_build_object('ok',false,'reason','stars_disabled');
    end if;
    if v_product.metadata->>'creatorTool'='boost' then
      perform pg_advisory_xact_lock(hashtextextended('coin-boost-capacity-v200',0));
    end if;
    if (v_product.metadata->>'entitlement'='season_pass' or v_product.metadata ? 'profileItem'
       or coalesce((v_product.metadata->>'energyRefill')::boolean,false))
       and exists(select 1 from public.star_purchases other where other.profile_id=v_purchase.profile_id
         and other.product_sku=v_purchase.product_sku and other.status='authorized'
         and other.expires_at>now()-interval '15 minutes'
         and other.id<>v_purchase.id) then
      return jsonb_build_object('ok',false,'reason','active_purchase_reservation');
    end if;
    v_eligibility:=public.store_purchase_eligibility_v200(v_purchase.profile_id,v_purchase.product_sku,v_purchase.product_context);
    if not coalesce((v_eligibility->>'eligible')::boolean,false) then
      return jsonb_build_object('ok',false,'reason',coalesce(v_eligibility->>'reason','not_eligible'));
    end if;
    if (v_eligibility->>'stars')::integer<>p_stars then return jsonb_build_object('ok',false,'reason','price_changed'); end if;
    if v_product.metadata ? 'caseTier' then
      v_quantity:=greatest(1,coalesce((v_product.metadata->>'quantity')::integer,1));
      select * into v_case from public.case_definitions where sku=v_product.sku and active=true for update;
      if not found or (v_case.remaining_supply is not null and v_case.remaining_supply<v_quantity) then
        return jsonb_build_object('ok',false,'reason','case_sold_out');
      end if;
      update public.case_definitions set remaining_supply=remaining_supply-v_quantity
      where sku=v_product.sku and remaining_supply is not null;
    elsif coalesce((v_product.metadata->>'energyRefill')::boolean,false) then
      perform public.refresh_profile_energy_v200(v_purchase.profile_id);
      select greatest(1,max_energy-energy) into v_energy_amount
      from public.profiles where id=v_purchase.profile_id;
    end if;
    v_reserved:=jsonb_build_object('productSku',v_product.sku,'stars',v_product.stars_price,
      'rewardLabel',v_product.reward_label,'metadata',v_product.metadata,'productContext',v_purchase.product_context,
      'caseStockReserved',v_product.metadata ? 'caseTier','quantity',v_quantity,
      'energyAmount',v_energy_amount,'authorizedAt',now());
  elsif v_purchase.ton_reward<=0 then
    return jsonb_build_object('ok',false,'reason','legacy_reward_invalid');
  else
    v_reserved:=jsonb_build_object('kind','legacy_virtual_ton','amount',v_purchase.ton_reward,'stars',v_purchase.stars,'authorizedAt',now());
  end if;
  update public.star_purchases set status='authorized',precheckout_id=trim(p_query_id),
    precheckout_authorized_at=now(),expires_at=now()+interval '30 minutes',reserved_grant=v_reserved,updated_at=now() where id=p_purchase_id;
  return jsonb_build_object('ok',true,'status','authorized','alreadyAuthorized',false,'productSku',v_purchase.product_sku);
exception when unique_violation then
  return jsonb_build_object('ok',false,'reason','precheckout_query_reused');
end;
$$;

create or replace function public.release_expired_star_authorizations_v200(p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_purchase public.star_purchases; v_released integer:=0; v_quantity integer;
begin
  for v_purchase in select * from public.star_purchases
    -- Telegram may deliver successful_payment after the pre-checkout TTL. Keep
    -- reserved value for a bounded grace period so a charged payment can still
    -- be finalized before inventory is returned to sale.
    where status='authorized' and expires_at<now()-interval '15 minutes'
    order by expires_at for update skip locked limit greatest(1,least(coalesce(p_limit,200),1000))
  loop
    if coalesce((v_purchase.reserved_grant->>'caseStockReserved')::boolean,false) then
      v_quantity:=greatest(1,coalesce((v_purchase.reserved_grant->>'quantity')::integer,1));
      update public.case_definitions set remaining_supply=remaining_supply+v_quantity
      where sku=v_purchase.product_sku and remaining_supply is not null;
    end if;
    update public.star_purchases set status='expired',reservation_released_at=now(),updated_at=now() where id=v_purchase.id;
    v_released:=v_released+1;
  end loop;
  return jsonb_build_object('released',v_released);
end;
$$;

create or replace function public.finalize_star_purchase_v200(
  p_purchase_id uuid,p_charge_id text,p_stars integer,p_payer_telegram_id bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_purchase public.star_purchases;
  v_product public.store_products;
  v_reward jsonb:='{}'::jsonb;
  v_days integer;
  v_hours integer;
  v_quantity integer;
  v_coin_id uuid;
  v_expires timestamptz;
  v_item text;
  v_ref numeric:=0;
  v_metadata jsonb;
  v_reward_label text;
begin
  select * into v_purchase from public.star_purchases where id=p_purchase_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if v_purchase.status='paid' then
    if v_purchase.payer_telegram_id is distinct from p_payer_telegram_id
       or v_purchase.stars is distinct from p_stars
       or v_purchase.telegram_payment_charge_id is distinct from trim(p_charge_id) then
      raise exception 'Paid purchase confirmation mismatch';
    end if;
    return jsonb_build_object('status','paid','productSku',v_purchase.product_sku,'alreadyPaid',true);
  end if;
  if v_purchase.status<>'authorized' then return jsonb_build_object('status',v_purchase.status,'reason','precheckout_required'); end if;
  if p_stars is distinct from v_purchase.stars then raise exception 'Star amount mismatch'; end if;
  if p_payer_telegram_id is null or v_purchase.payer_telegram_id is distinct from p_payer_telegram_id then raise exception 'Payment payer mismatch'; end if;
  if p_charge_id is null or length(trim(p_charge_id))<4 then raise exception 'Payment charge id missing'; end if;
  if exists(select 1 from public.star_purchases where telegram_payment_charge_id=p_charge_id and id<>p_purchase_id) then
    raise exception 'Payment charge was already used';
  end if;

  perform 1 from public.profiles where id=v_purchase.profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_purchase.payer_telegram_id is not null and v_purchase.payer_telegram_id is distinct from
    (select telegram_id from public.profiles where id=v_purchase.profile_id) then raise exception 'Purchase payer mismatch'; end if;

  if v_purchase.product_sku is null then
    if v_purchase.ton_reward<=0 then raise exception 'Legacy Star reward is invalid'; end if;
    update public.profiles set balance=balance+v_purchase.ton_reward,stars_spent=stars_spent+v_purchase.stars,
      vip_points=vip_points+v_purchase.stars,updated_at=now() where id=v_purchase.profile_id;
    v_reward:=jsonb_build_object('kind','virtual_ton','amount',v_purchase.ton_reward,'label',v_purchase.ton_reward::text||' virtual TON');
    v_ref:=public.credit_referral_bonus_v046(v_purchase.profile_id,'stars',v_purchase.ton_reward,v_purchase.id);
  else
    if v_purchase.reserved_grant is null then raise exception 'Authorized grant reservation is missing'; end if;
    if (v_purchase.reserved_grant->>'stars')::integer<>v_purchase.stars then raise exception 'Reserved store price mismatch'; end if;
    select * into v_product from public.store_products where sku=v_purchase.product_sku for share;
    if not found then raise exception 'Reserved store product is missing'; end if;
    v_metadata:=v_purchase.reserved_grant->'metadata';
    v_reward_label:=v_purchase.reserved_grant->>'rewardLabel';

    update public.profiles set stars_spent=stars_spent+v_purchase.stars,vip_points=vip_points+v_purchase.stars,updated_at=now()
    where id=v_purchase.profile_id;

    if v_metadata ? 'mxmCoins' then
      v_quantity:=(v_metadata->>'mxmCoins')::integer;
      v_reward:=public.grant_virtual_reward_v200(v_purchase.profile_id,'mxm_coins',v_quantity,
        jsonb_build_object('label',v_reward_label),'store',v_purchase.id);
      v_ref:=public.credit_referral_bonus_v046(v_purchase.profile_id,'store',v_quantity,v_purchase.id);
    elsif v_metadata->>'entitlement'='premium' then
      v_days:=greatest(1,coalesce((v_metadata->>'durationDays')::integer,30));
      select greatest(now(),coalesce(premium_until,now()))+make_interval(days=>v_days)
      into v_expires from public.profiles where id=v_purchase.profile_id;
      update public.profiles set premium_until=v_expires,max_energy=greatest(max_energy,150),
        energy=greatest(energy,150),energy_updated_at=now(),updated_at=now() where id=v_purchase.profile_id;
      insert into public.profile_entitlements(profile_id,entitlement_key,expires_at,metadata)
      values(v_purchase.profile_id,'premium',v_expires,jsonb_build_object('purchaseId',v_purchase.id))
      on conflict(profile_id,entitlement_key) do update set expires_at=excluded.expires_at,metadata=excluded.metadata,updated_at=now();
      v_reward:=jsonb_build_object('kind','entitlement','key','premium','expiresAt',v_expires,'label',v_reward_label);
    elsif v_metadata->>'entitlement'='season_pass' then
      perform public.ensure_current_season_v200();
      select ends_at into v_expires from public.seasons where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
      v_expires:=coalesce(v_expires,now()+interval '30 days');
      insert into public.profile_entitlements(profile_id,entitlement_key,expires_at,metadata)
      values(v_purchase.profile_id,'season_pass',v_expires,jsonb_build_object('purchaseId',v_purchase.id))
      on conflict(profile_id,entitlement_key) do update set expires_at=greatest(public.profile_entitlements.expires_at,excluded.expires_at),metadata=excluded.metadata,updated_at=now();
      v_reward:=jsonb_build_object('kind','entitlement','key','season_pass','expiresAt',v_expires,'label',v_reward_label);
    elsif v_metadata ? 'caseTier' then
      v_quantity:=greatest(1,coalesce((v_purchase.reserved_grant->>'quantity')::integer,1));
      insert into public.profile_inventory(profile_id,sku,quantity) values(v_purchase.profile_id,v_product.sku,v_quantity)
      on conflict(profile_id,sku) do update set quantity=public.profile_inventory.quantity+excluded.quantity,updated_at=now();
      v_reward:=jsonb_build_object('kind','case','sku',v_product.sku,'amount',v_quantity,'label',v_reward_label);
    elsif coalesce((v_metadata->>'energyRefill')::boolean,false) then
      v_quantity:=greatest(1,coalesce((v_purchase.reserved_grant->>'energyAmount')::integer,1));
      v_reward:=public.grant_virtual_reward_v200(v_purchase.profile_id,'energy',v_quantity,
        jsonb_build_object('label',v_reward_label),'store',v_purchase.id);
    elsif v_metadata->>'creatorTool'='boost' then
      v_coin_id:=(v_purchase.reserved_grant->'productContext'->>'coinId')::uuid;
      v_hours:=greatest(1,coalesce((v_metadata->>'durationHours')::integer,24));
      select greatest(now(),coalesce(max(ends_at),now()))+make_interval(hours=>v_hours) into v_expires
      from public.coin_boosts where coin_id=v_coin_id and kind='boost';
      insert into public.coin_boosts(coin_id,profile_id,kind,starts_at,ends_at,purchase_id)
      values(v_coin_id,v_purchase.profile_id,'boost',greatest(now(),v_expires-make_interval(hours=>v_hours)),v_expires,v_purchase.id);
      v_reward:=jsonb_build_object('kind','coin_boost','coinId',v_coin_id,'hours',v_hours,'label',v_reward_label);
    elsif v_metadata ? 'profileItem' then
      v_item:=v_metadata->>'profileItem';
      v_reward:=public.grant_virtual_reward_v200(v_purchase.profile_id,'profile_item',1,
        jsonb_build_object('itemKey',v_item,'label',v_reward_label),'store',v_purchase.id);
    elsif v_metadata ? 'entitlement' then
      v_days:=greatest(1,coalesce((v_metadata->>'durationDays')::integer,30));
      v_expires:=now()+make_interval(days=>v_days);
      select greatest(now(),coalesce(expires_at,now()))+make_interval(days=>v_days)
      into v_expires from public.profile_entitlements
      where profile_id=v_purchase.profile_id and entitlement_key=v_metadata->>'entitlement';
      v_expires:=coalesce(v_expires,now()+make_interval(days=>v_days));
      insert into public.profile_entitlements(profile_id,entitlement_key,expires_at,metadata)
      values(v_purchase.profile_id,v_metadata->>'entitlement',v_expires,jsonb_build_object('purchaseId',v_purchase.id))
      on conflict(profile_id,entitlement_key) do update set expires_at=excluded.expires_at,metadata=excluded.metadata,updated_at=now();
      v_reward:=jsonb_build_object('kind','entitlement','key',v_metadata->>'entitlement','expiresAt',v_expires,'label',v_reward_label);
    else
      raise exception 'Store product fulfilment is not configured';
    end if;
  end if;

  update public.star_purchases set status='paid',telegram_payment_charge_id=trim(p_charge_id),paid_at=now(),updated_at=now()
  where id=p_purchase_id;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_purchase.profile_id,case when v_purchase.product_sku is null then 'stars' else 'store' end,
    case when v_purchase.product_sku is null then v_purchase.ton_reward else 0 end,v_purchase.id,
    jsonb_build_object('stars',v_purchase.stars,'productSku',v_purchase.product_sku,'reward',v_reward,'unit','virtual'));
  return jsonb_build_object('status','paid','productSku',v_purchase.product_sku,'reward',v_reward,
    'referralReward',v_ref,'alreadyPaid',false);
end;
$$;

create or replace function public.mark_star_purchase_refunded_v200(
  p_purchase_id uuid,p_charge_id text,p_reason text,p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_purchase public.star_purchases;
begin
  select * into v_purchase from public.star_purchases where id=p_purchase_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if v_purchase.status='refunded' then
    if v_purchase.telegram_payment_charge_id is distinct from p_charge_id then raise exception 'Refund charge mismatch'; end if;
    return jsonb_build_object('status','refunded','alreadyRefunded',true,'reversalRequired',true);
  end if;
  if v_purchase.status<>'paid' or v_purchase.telegram_payment_charge_id is distinct from p_charge_id
     or v_purchase.payer_telegram_id is null then raise exception 'Purchase is not refundable'; end if;
  update public.star_purchases set status='refunded',refunded_at=now(),refund_reason=left(trim(coalesce(p_reason,'Admin refund')),500),
    refund_metadata=coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('virtualReversal','manual_review_required'),updated_at=now()
  where id=p_purchase_id;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_purchase.profile_id,'system',0,v_purchase.id,jsonb_build_object('action','stars_refund','productSku',v_purchase.product_sku,
    'stars',v_purchase.stars,'virtualReversal','manual_review_required'));
  return jsonb_build_object('status','refunded','alreadyRefunded',false,'reversalRequired',true);
end;
$$;

create or replace function public.case_snapshot_v200(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'cases',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku',d.sku,'title',d.title,'tier',d.tier,'description',d.description,
        'quantity',coalesce(i.quantity,0),'remaining',d.remaining_supply,
        'odds',coalesce((
          select jsonb_agg(jsonb_build_object(
            'reward',l.reward_key,'label',l.reward_label,
            'percent',round(100.0*l.weight/nullif((select sum(l2.weight) from public.case_loot_definitions l2
              where l2.case_sku=d.sku and l2.active=true),0),2),'rarity',l.rarity
          ) order by l.weight desc,l.reward_key)
          from public.case_loot_definitions l where l.case_sku=d.sku and l.active=true
        ),'[]'::jsonb)
      ) order by case d.tier when 'starter' then 1 when 'rare' then 2 else 3 end)
      from public.case_definitions d
      left join public.profile_inventory i on i.profile_id=p_profile_id and i.sku=d.sku
      where d.active=true
    ),'[]'::jsonb),
    'history',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',h.id,'caseSku',h.case_sku,'rewardLabel',h.reward_label,
        'rarity',h.rarity,'openedAt',h.opened_at
      ) order by h.opened_at desc)
      from (select * from public.case_openings where profile_id=p_profile_id order by opened_at desc limit 30) h
    ),'[]'::jsonb)
  );
$$;

create or replace function public.open_case_v200(
  p_profile_id uuid,p_case_sku text,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request uuid:=coalesce(p_request_id,gen_random_uuid());
  v_existing public.case_openings;
  v_inventory public.profile_inventory;
  v_loot public.case_loot_definitions;
  v_total integer;
  v_roll integer;
  v_random bytea;
  v_reward jsonb;
  v_remaining integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,0));
  select * into v_existing from public.case_openings where request_id=v_request;
  if found then
    if v_existing.profile_id<>p_profile_id or v_existing.case_sku<>p_case_sku then
      raise exception 'Case request ID was already used';
    end if;
    select quantity into v_remaining from public.profile_inventory where profile_id=p_profile_id and sku=p_case_sku;
    return jsonb_build_object('status','opened','alreadyOpened',true,'reward',jsonb_build_object(
      'label',v_existing.reward_label,'rarity',v_existing.rarity,'kind',v_existing.reward_kind,'amount',v_existing.reward_amount
    ),'remaining',coalesce(v_remaining,0));
  end if;

  if not exists(select 1 from public.case_definitions where sku=p_case_sku and active=true) then
    raise exception 'Case is unavailable';
  end if;
  select * into v_inventory from public.profile_inventory
  where profile_id=p_profile_id and sku=p_case_sku for update;
  if not found or v_inventory.quantity<1 then raise exception 'No case in inventory'; end if;

  select sum(weight)::integer into v_total from public.case_loot_definitions where case_sku=p_case_sku and active=true;
  if coalesce(v_total,0)<=0 then raise exception 'Case odds are not configured'; end if;
  v_random:=gen_random_bytes(4);
  v_roll:=mod((get_byte(v_random,0)::numeric*16777216+get_byte(v_random,1)::numeric*65536+
    get_byte(v_random,2)::numeric*256+get_byte(v_random,3)::numeric),v_total)::integer+1;
  select x.id,x.case_sku,x.reward_key,x.reward_kind,x.reward_label,x.amount,x.weight,x.rarity,x.metadata,x.active
  into v_loot from (
    select l.*,sum(l.weight) over(order by l.reward_key rows between unbounded preceding and current row) as ceiling
    from public.case_loot_definitions l where l.case_sku=p_case_sku and l.active=true
  ) x where x.ceiling>=v_roll order by x.ceiling limit 1;
  if not found then raise exception 'Case draw failed'; end if;

  -- Permanent items never become a zero-value duplicate. The disclosed loot
  -- row advertises its fixed MXM compensation and the opening history records
  -- the actual compensated reward.
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
  insert into public.case_openings(request_id,profile_id,case_sku,loot_id,reward_kind,reward_label,reward_amount,rarity)
  values(v_request,p_profile_id,p_case_sku,v_loot.id,v_reward->>'kind',v_reward->>'label',
    greatest(0,coalesce((v_reward->>'amount')::integer,0)),v_loot.rarity);
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'case',case when v_reward->>'kind'='mxm_coins' then coalesce((v_reward->>'amount')::numeric,0) else 0 end,v_request,
    jsonb_build_object('unit',v_loot.reward_kind,'caseSku',p_case_sku,'reward',v_reward,'rarity',v_loot.rarity));
  return jsonb_build_object('status','opened','alreadyOpened',false,'requestId',v_request,
    'reward',jsonb_build_object('label',v_reward->>'label','rarity',v_loot.rarity,'kind',v_reward->>'kind',
      'amount',coalesce((v_reward->>'amount')::integer,0),'creditedEnergy',v_reward->'creditedEnergy','overflowMxmCoins',v_reward->'overflowMxmCoins'),
    'remaining',v_remaining);
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
begin
  perform public.ensure_current_season_v200();
  select * into v_season from public.seasons
  where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if not found then raise exception 'No active season'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;

  select coalesce(sum(amount),0)::integer into v_xp from public.profile_xp_events
  where profile_id=p_profile_id and created_at>=v_season.starts_at and created_at<v_season.ends_at;
  select coalesce(max(level),1) into v_level from public.season_rewards
  where season_id=v_season.id and track='free' and required_xp<=v_xp;
  select exists(select 1 from public.profile_entitlements
    where profile_id=p_profile_id and entitlement_key='season_pass' and (expires_at is null or expires_at>now())) into v_premium;

  select coalesce(jsonb_agg(jsonb_build_object(
    'level',q.level,'requiredXp',q.required_xp,
    'freeReward',jsonb_build_object('label',q.free_label,'kind',q.free_kind,'amount',q.free_amount),
    'premiumReward',jsonb_build_object('label',q.premium_label,'kind',q.premium_kind,'amount',q.premium_amount),
    'freeClaimed',q.free_claimed,'premiumClaimed',q.premium_claimed
  ) order by q.level),'[]'::jsonb) into v_levels
  from (
    select f.level,f.required_xp,
      f.reward_label free_label,f.reward_kind free_kind,f.amount free_amount,
      p.reward_label premium_label,p.reward_kind premium_kind,p.amount premium_amount,
      exists(select 1 from public.season_claims c where c.profile_id=p_profile_id and c.season_id=v_season.id and c.level=f.level and c.track='free') free_claimed,
      exists(select 1 from public.season_claims c where c.profile_id=p_profile_id and c.season_id=v_season.id and c.level=f.level and c.track='premium') premium_claimed
    from public.season_rewards f join public.season_rewards p
      on p.season_id=f.season_id and p.level=f.level and p.track='premium'
    where f.season_id=v_season.id and f.track='free'
  ) q;

  return jsonb_build_object(
    'season',jsonb_build_object('id',v_season.id,'title',v_season.title,'startsAt',v_season.starts_at,
      'endsAt',v_season.ends_at,'daysLeft',greatest(0,ceil(extract(epoch from (v_season.ends_at-now()))/86400.0)::integer)),
    'xp',v_xp,'level',v_level,'premium',v_premium,'levels',v_levels
  );
end;
$$;

create or replace function public.claim_season_reward_v200(
  p_profile_id uuid,p_level integer,p_track text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_season public.seasons;
  v_reward public.season_rewards;
  v_existing jsonb;
  v_xp integer:=0;
  v_grant jsonb;
begin
  if p_track not in ('free','premium') then raise exception 'Invalid season track'; end if;
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  perform public.ensure_current_season_v200();
  select * into v_season from public.seasons
  where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if not found then raise exception 'No active season'; end if;
  select reward into v_existing from public.season_claims
  where profile_id=p_profile_id and season_id=v_season.id and level=p_level and track=p_track;
  if found then return jsonb_build_object('status','claimed','alreadyClaimed',true,'reward',v_existing); end if;
  select * into v_reward from public.season_rewards
  where season_id=v_season.id and level=p_level and track=p_track;
  if not found then raise exception 'Season reward not found'; end if;
  select coalesce(sum(amount),0)::integer into v_xp from public.profile_xp_events
  where profile_id=p_profile_id and created_at>=v_season.starts_at and created_at<v_season.ends_at;
  if v_xp<v_reward.required_xp then raise exception 'Season level is locked'; end if;
  if p_track='premium' and not exists(select 1 from public.profile_entitlements
    where profile_id=p_profile_id and entitlement_key='season_pass' and (expires_at is null or expires_at>now())) then
    raise exception 'Premium track is locked';
  end if;
  v_grant:=public.grant_virtual_reward_v200(p_profile_id,v_reward.reward_kind,v_reward.amount,
    v_reward.metadata||jsonb_build_object('label',v_reward.reward_label),'season',v_season.id);
  insert into public.season_claims(profile_id,season_id,level,track,reward)
  values(p_profile_id,v_season.id,p_level,p_track,v_grant);
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'season',case when v_reward.reward_kind='mxm_coins' then v_reward.amount else 0 end,v_season.id,
    jsonb_build_object('unit',v_reward.reward_kind,'level',p_level,'track',p_track,'reward',v_grant));
  return jsonb_build_object('status','claimed','alreadyClaimed',false,'reward',v_grant);
end;
$$;

-- ---------------------------------------------------------------------------
-- Creator levels, fee split, vesting lock and atomic AMM execution.
-- The total trade fee remains 50 bps (0.5%), matching lib/amm.ts. Creator
-- progression only reallocates that fixed total between creator and platform.
-- ---------------------------------------------------------------------------

create or replace function public.creator_level_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_coins integer:=0;
  v_holders integer:=0;
  v_volume numeric:=0;
  v_level text;
  v_creator_bps integer;
  v_next_volume numeric;
begin
  select count(*)::integer into v_coins from public.coins where creator_profile_id=p_profile_id;
  select count(distinct h.profile_id)::integer into v_holders
  from public.holdings h join public.coins c on c.id=h.coin_id
  where c.creator_profile_id=p_profile_id and h.quantity>0;
  select coalesce(sum(t.quote_amount),0) into v_volume
  from public.trades t join public.coins c on c.id=t.coin_id where c.creator_profile_id=p_profile_id;

  if v_volume>=1000000 or v_holders>=500 then
    v_level:='Diamond'; v_creator_bps:=25; v_next_volume:=null;
  elsif v_volume>=100000 or v_holders>=100 then
    v_level:='Gold'; v_creator_bps:=20; v_next_volume:=1000000;
  elsif v_volume>=10000 or v_holders>=25 then
    v_level:='Silver'; v_creator_bps:=15; v_next_volume:=100000;
  else
    v_level:='Bronze'; v_creator_bps:=10; v_next_volume:=10000;
  end if;
  return jsonb_build_object('name',v_level,'creatorFeeBps',v_creator_bps,'coinCount',v_coins,
    'holderCount',v_holders,'volume',v_volume,'nextVolume',v_next_volume);
end;
$$;

create or replace function public.creator_fee_bps_v200(p_profile_id uuid)
returns integer language sql security definer set search_path=public stable as $$
  select coalesce((public.creator_level_v200(p_profile_id)->>'creatorFeeBps')::integer,10);
$$;

create or replace function public.coin_locked_tokens_v200(p_profile_id uuid,p_coin_id uuid)
returns numeric language sql security definer set search_path=public stable as $$
  select coalesce((
    select case
      when now()>=l.ends_at then 0
      when now()<=l.starts_at then l.total_locked
      else l.total_locked*(extract(epoch from (l.ends_at-now()))/nullif(extract(epoch from (l.ends_at-l.starts_at)),0))
    end
    from public.creator_token_locks l where l.profile_id=p_profile_id and l.coin_id=p_coin_id
  ),0);
$$;

create or replace function public.credit_vip_activity_v200(
  p_profile_id uuid,p_source_kind text,p_activity_value numeric,p_reference_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_existing public.vip_point_events;
  v_requested integer:=0;
  v_granted integer:=0;
  v_day_points integer:=0;
  v_daily_cap constant integer:=100;
  v_day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  v_valid boolean:=false;
begin
  if p_source_kind not in ('coin_buy','coin_sell','coin_launch') or p_reference_id is null
     or p_activity_value is null or p_activity_value<=0 then
    raise exception 'Invalid VIP activity';
  end if;
  if p_source_kind in ('coin_buy','coin_sell') then
    select exists(select 1 from public.trades t where t.id=p_reference_id and t.profile_id=p_profile_id
      and t.side=case when p_source_kind='coin_buy' then 'buy' else 'sell' end
      and abs(t.quote_amount-p_activity_value)<=0.00000002) into v_valid;
    if not v_valid then raise exception 'VIP trade reference mismatch'; end if;
    -- One point per whole virtual TON, no points below 1 TON, max 25 per trade.
    v_requested:=floor(least(p_activity_value,25))::integer;
  else
    select exists(select 1 from public.coins c cross join public.economy_settings e
      where c.id=p_reference_id and c.creator_profile_id=p_profile_id and e.singleton=true
        and abs((c.initial_buy_quote+e.coin_launch_fee)-p_activity_value)<=0.00000002) into v_valid;
    if not v_valid then raise exception 'VIP launch reference mismatch'; end if;
    v_requested:=50;
  end if;
  if v_requested<=0 then
    return jsonb_build_object('points',0,'requested',0,'dailyCap',v_daily_cap,'reason','minimum_activity');
  end if;

  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into v_existing from public.vip_point_events
  where source_kind=p_source_kind and reference_id=p_reference_id;
  if found then
    if v_existing.profile_id<>p_profile_id or abs(v_existing.activity_value-p_activity_value)>0.00000002 then
      raise exception 'VIP activity reference was already used';
    end if;
    return jsonb_build_object('points',v_existing.points,'requested',v_requested,'dailyCap',v_daily_cap,
      'alreadyCredited',true);
  end if;
  select coalesce(sum(points),0)::integer into v_day_points from public.vip_point_events
  where profile_id=p_profile_id and created_at>=v_day_start and created_at<v_day_start+interval '1 day';
  v_granted:=least(v_requested,greatest(0,v_daily_cap-v_day_points));
  insert into public.vip_point_events(profile_id,source_kind,reference_id,activity_value,points)
  values(p_profile_id,p_source_kind,p_reference_id,p_activity_value,v_granted);
  if v_granted>0 then
    update public.profiles set vip_points=vip_points+v_granted,updated_at=now() where id=p_profile_id;
  end if;
  return jsonb_build_object('points',v_granted,'requested',v_requested,'dailyCap',v_daily_cap,
    'dailyEarned',v_day_points+v_granted,'alreadyCredited',false,
    'reason',case when v_granted<v_requested then 'daily_cap' else null end);
end;
$$;

create or replace function public.record_coin_fee_split_v200(
  p_trade_id uuid,p_coin_id uuid,p_trader_id uuid,p_creator_id uuid,p_side text,
  p_fee_base numeric,p_total_fee numeric,p_creator_fee_bps integer,p_total_fee_bps integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_creator_fee numeric:=0;
  v_platform_fee numeric:=0;
  v_platform_bps integer;
  v_treasury uuid;
begin
  if p_total_fee<0 or p_fee_base<=0 or p_creator_fee_bps<0 or p_creator_fee_bps>p_total_fee_bps then
    raise exception 'Invalid coin fee split';
  end if;
  v_platform_bps:=p_total_fee_bps-p_creator_fee_bps;
  if p_creator_id is not null then v_creator_fee:=round(p_fee_base*p_creator_fee_bps/10000.0,8); end if;
  v_platform_fee:=greatest(0,p_total_fee-v_creator_fee);
  select treasury_profile_id into v_treasury from public.market_settings where singleton=true;

  if v_creator_fee>0 then
    update public.profiles set balance=balance+v_creator_fee,updated_at=now() where id=p_creator_id;
  end if;
  if v_platform_fee>0 and v_treasury is not null then
    update public.profiles set balance=balance+v_platform_fee,updated_at=now() where id=v_treasury;
  end if;
  insert into public.coin_fee_ledger(trade_id,coin_id,trader_profile_id,creator_profile_id,side,fee_base,
    total_fee,platform_fee,creator_fee,creator_fee_bps,platform_fee_bps)
  values(p_trade_id,p_coin_id,p_trader_id,p_creator_id,p_side,p_fee_base,p_total_fee,v_platform_fee,v_creator_fee,p_creator_fee_bps,v_platform_bps);

  if p_total_fee>0 then
    insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
    values(p_trader_id,'coin_trade_fee',-p_total_fee,p_trade_id,
      jsonb_build_object('coinId',p_coin_id,'side',p_side,'unit','virtual_ton','totalFeeBps',p_total_fee_bps));
  end if;
  if v_creator_fee>0 then
    insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
    values(p_creator_id,'coin_creator_fee',v_creator_fee,p_trade_id,
      jsonb_build_object('coinId',p_coin_id,'side',p_side,'unit','virtual_ton','bps',p_creator_fee_bps));
  end if;
  if v_platform_fee>0 and v_treasury is not null then
    insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
    values(v_treasury,'coin_platform_fee',v_platform_fee,p_trade_id,
      jsonb_build_object('coinId',p_coin_id,'side',p_side,'unit','virtual_ton','bps',v_platform_bps));
  end if;
  return jsonb_build_object('totalFee',p_total_fee,'creatorFee',v_creator_fee,'platformFee',v_platform_fee,
    'creatorFeeBps',p_creator_fee_bps,'platformFeeBps',v_platform_bps);
end;
$$;

create or replace function public.buy_coin_v2(
  p_profile_id uuid,p_coin_id uuid,p_quote_amount numeric,p_min_token_out numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_coin public.coins;
  v_total_bps integer:=50;
  v_creator_bps integer:=10;
  v_total_fee numeric;
  v_quote_net numeric;
  v_k numeric;
  v_new_quote numeric;
  v_new_token numeric;
  v_token_out numeric;
  v_exec_price numeric;
  v_reserved numeric;
  v_trade_id uuid;
  v_fee jsonb;
  v_limit integer:=100;
  v_ordinal integer;
  v_vip jsonb;
begin
  if p_quote_amount is null or p_quote_amount<0.01 then raise exception 'Minimum buy is 0.01 virtual TON'; end if;
  if p_min_token_out is null or p_min_token_out<0 then raise exception 'Invalid slippage floor'; end if;
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  v_reserved:=public.reserved_market_balance_v056(p_profile_id,null,null,null);
  if v_profile.balance-v_reserved<p_quote_amount then raise exception 'Insufficient available balance'; end if;
  select * into v_coin from public.coins where id=p_coin_id and status='active' for update;
  if not found then raise exception 'Coin is not tradeable'; end if;
  if v_coin.token_reserve<=0 or v_coin.quote_reserve<=0 then raise exception 'Coin reserves are invalid'; end if;
  select coin_total_fee_bps,early_buyer_limit into v_total_bps,v_limit from public.economy_settings where singleton=true;
  v_total_bps:=coalesce(v_total_bps,50); v_limit:=coalesce(v_limit,100);
  v_creator_bps:=least(v_total_bps,public.creator_fee_bps_v200(v_coin.creator_profile_id));
  v_total_fee:=round(p_quote_amount*v_total_bps/10000.0,8);
  v_quote_net:=p_quote_amount-v_total_fee;
  v_k:=v_coin.token_reserve*v_coin.quote_reserve;
  v_new_quote:=v_coin.quote_reserve+v_quote_net;
  v_new_token:=v_k/v_new_quote;
  v_token_out:=v_coin.token_reserve-v_new_token;
  if v_token_out<=0 then raise exception 'Trade too small'; end if;
  if p_min_token_out>0 and v_token_out<p_min_token_out then raise exception 'Price moved beyond slippage limit'; end if;
  v_exec_price:=p_quote_amount/v_token_out;

  update public.profiles set balance=balance-p_quote_amount,updated_at=now() where id=p_profile_id;
  insert into public.holdings(profile_id,coin_id,quantity,cost_basis) values(p_profile_id,p_coin_id,v_token_out,p_quote_amount)
  on conflict(profile_id,coin_id) do update set quantity=public.holdings.quantity+excluded.quantity,
    cost_basis=public.holdings.cost_basis+excluded.cost_basis,updated_at=now();
  update public.coins set token_reserve=v_new_token,quote_reserve=v_new_quote,
    current_price=v_new_quote/v_new_token,market_cap=(v_new_quote/v_new_token)*total_supply,updated_at=now()
  where id=p_coin_id returning * into v_coin;
  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl)
  values(p_profile_id,p_coin_id,'buy',p_quote_amount,v_token_out,v_exec_price,0) returning id into v_trade_id;

  if not exists(select 1 from public.coin_early_buyers where coin_id=p_coin_id and profile_id=p_profile_id) then
    select count(*)::integer+1 into v_ordinal from public.coin_early_buyers where coin_id=p_coin_id;
    if v_ordinal<=v_limit then
      insert into public.coin_early_buyers(coin_id,profile_id,ordinal,first_trade_id)
      values(p_coin_id,p_profile_id,v_ordinal,v_trade_id);
    end if;
  end if;
  v_fee:=public.record_coin_fee_split_v200(v_trade_id,p_coin_id,p_profile_id,v_coin.creator_profile_id,'buy',
    p_quote_amount,v_total_fee,v_creator_bps,v_total_bps);
  perform public.record_candle(p_coin_id,v_coin.current_price,p_quote_amount);
  perform public.bump_mission(p_profile_id,'coin_trade',1);
  v_vip:=public.credit_vip_activity_v200(p_profile_id,'coin_buy',p_quote_amount,v_trade_id);
  return jsonb_build_object('side','buy','quoteAmount',p_quote_amount,'tokenAmount',v_token_out,
    'executionPrice',v_exec_price,'newPrice',v_coin.current_price,'tokenReserve',v_coin.token_reserve,
    'quoteReserve',v_coin.quote_reserve,'fee',v_fee,'genesisOrdinal',v_ordinal,'vip',v_vip);
end;
$$;

create or replace function public.sell_coin_v2(
  p_profile_id uuid,p_coin_id uuid,p_token_amount numeric,p_min_quote_out numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_coin public.coins;
  v_holding public.holdings;
  v_total_bps integer:=50;
  v_creator_bps integer:=10;
  v_k numeric;
  v_new_token numeric;
  v_new_quote numeric;
  v_quote_gross numeric;
  v_total_fee numeric;
  v_quote_out numeric;
  v_exec_price numeric;
  v_cost_reduction numeric;
  v_realized numeric;
  v_sell_amount numeric;
  v_locked numeric:=0;
  v_trade_id uuid;
  v_fee jsonb;
  v_vip jsonb;
begin
  if p_token_amount is null or p_token_amount<=0 then raise exception 'Invalid sell amount'; end if;
  if p_min_quote_out is null or p_min_quote_out<0 then raise exception 'Invalid slippage floor'; end if;
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into v_holding from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id for update;
  if not found or v_holding.quantity<=0 then raise exception 'Insufficient tokens'; end if;
  select * into v_coin from public.coins where id=p_coin_id and status='active' for update;
  if not found then raise exception 'Coin is not tradeable'; end if;
  v_locked:=public.coin_locked_tokens_v200(p_profile_id,p_coin_id);
  v_sell_amount:=p_token_amount;
  if v_sell_amount>greatest(0,v_holding.quantity-v_locked)+greatest(0.00000001,v_holding.quantity*0.000000000001) then
    raise exception 'Creator tokens are still locked';
  end if;
  if greatest(0,v_holding.quantity-v_locked)-v_sell_amount<=greatest(0.00000001,v_holding.quantity*0.000000000001) then
    v_sell_amount:=greatest(0,v_holding.quantity-v_locked);
  end if;
  if v_sell_amount<=0 then raise exception 'No unlocked tokens available'; end if;
  if v_coin.token_reserve<=0 or v_coin.quote_reserve<=0 then raise exception 'Coin reserves are invalid'; end if;

  select coin_total_fee_bps into v_total_bps from public.economy_settings where singleton=true;
  v_total_bps:=coalesce(v_total_bps,50);
  v_creator_bps:=least(v_total_bps,public.creator_fee_bps_v200(v_coin.creator_profile_id));
  v_k:=v_coin.token_reserve*v_coin.quote_reserve;
  v_new_token:=v_coin.token_reserve+v_sell_amount;
  v_new_quote:=v_k/v_new_token;
  if v_coin.floor_price is not null and v_coin.floor_price>0 and v_coin.floor_expires_at>now()
     and v_new_quote/v_new_token<v_coin.floor_price then
    raise exception 'Launch floor protects this price';
  end if;
  v_quote_gross:=v_coin.quote_reserve-v_new_quote;
  v_total_fee:=round(v_quote_gross*v_total_bps/10000.0,8);
  v_quote_out:=v_quote_gross-v_total_fee;
  if v_quote_out<0.000001 then raise exception 'Trade too small'; end if;
  if p_min_quote_out>0 and v_quote_out<p_min_quote_out then raise exception 'Price moved beyond slippage limit'; end if;
  v_exec_price:=v_quote_out/v_sell_amount;
  v_cost_reduction:=case when v_sell_amount>=v_holding.quantity then v_holding.cost_basis
    else v_holding.cost_basis*(v_sell_amount/v_holding.quantity) end;
  v_realized:=v_quote_out-v_cost_reduction;

  update public.profiles set balance=balance+v_quote_out,updated_at=now() where id=p_profile_id;
  update public.holdings set quantity=greatest(0,quantity-v_sell_amount),
    cost_basis=case when v_sell_amount>=quantity then 0 else greatest(0,cost_basis-v_cost_reduction) end,updated_at=now()
  where profile_id=p_profile_id and coin_id=p_coin_id;
  update public.coins set token_reserve=v_new_token,quote_reserve=v_new_quote,current_price=v_new_quote/v_new_token,
    market_cap=(v_new_quote/v_new_token)*total_supply,updated_at=now() where id=p_coin_id returning * into v_coin;
  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl)
  values(p_profile_id,p_coin_id,'sell',v_quote_out,v_sell_amount,v_exec_price,v_realized) returning id into v_trade_id;
  v_fee:=public.record_coin_fee_split_v200(v_trade_id,p_coin_id,p_profile_id,v_coin.creator_profile_id,'sell',
    v_quote_gross,v_total_fee,v_creator_bps,v_total_bps);
  perform public.record_candle(p_coin_id,v_coin.current_price,v_quote_out);
  perform public.bump_mission(p_profile_id,'coin_trade',1);
  if v_realized>0 then perform public.bump_mission(p_profile_id,'profitable_trade',1); end if;
  v_vip:=public.credit_vip_activity_v200(p_profile_id,'coin_sell',v_quote_out,v_trade_id);
  return jsonb_build_object('side','sell','quoteAmount',v_quote_out,'tokenAmount',v_sell_amount,
    'executionPrice',v_exec_price,'newPrice',v_coin.current_price,'realizedPnl',v_realized,
    'tokenReserve',v_coin.token_reserve,'quoteReserve',v_coin.quote_reserve,'fee',v_fee,'lockedTokens',v_locked,'vip',v_vip);
end;
$$;

create or replace function public.sell_coin_all_v2(
  p_profile_id uuid,p_coin_id uuid,p_min_quote_out numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_quantity numeric; v_locked numeric;
begin
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select quantity into v_quantity from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id for update;
  if v_quantity is null or v_quantity<=0 then raise exception 'Insufficient tokens'; end if;
  v_locked:=public.coin_locked_tokens_v200(p_profile_id,p_coin_id);
  v_quantity:=greatest(0,v_quantity-v_locked);
  if v_quantity<=0 then raise exception 'No unlocked tokens available'; end if;
  return public.sell_coin_v2(p_profile_id,p_coin_id,v_quantity,p_min_quote_out);
end;
$$;

create or replace function public.execute_coin_trade_v3(
  p_request_id uuid,p_profile_id uuid,p_coin_id uuid,p_side text,p_amount numeric,
  p_sell_all boolean default false,p_min_output numeric default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_existing public.coin_trade_requests;
  v_result jsonb;
  v_quantity numeric:=0;
  v_reserved_tokens numeric:=0;
  v_locked_tokens numeric:=0;
begin
  if p_request_id is null then raise exception 'Trade request ID is required'; end if;
  if p_side not in ('buy','sell') then raise exception 'Invalid trade side'; end if;
  if p_min_output is null or p_min_output<0 then raise exception 'Invalid slippage floor'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_existing from public.coin_trade_requests where request_id=p_request_id;
  if found then
    if v_existing.profile_id<>p_profile_id or v_existing.coin_id<>p_coin_id or v_existing.side<>p_side
       or v_existing.input_amount is distinct from p_amount or v_existing.sell_all is distinct from p_sell_all
       or v_existing.min_output is distinct from p_min_output then
      raise exception 'Trade request ID was already used for another operation';
    end if;
    return v_existing.result;
  end if;
  if p_side='sell' then
    perform 1 from public.profiles where id=p_profile_id for update;
    if not found then raise exception 'Profile not found'; end if;
    select quantity into v_quantity from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id for update;
    if not found then v_quantity:=0; end if;
    select coalesce(sum(input_amount),0) into v_reserved_tokens from public.coin_conditional_orders_v056
    where profile_id=p_profile_id and coin_id=p_coin_id and kind in ('limit_sell','take_profit','stop_loss')
      and status='active' and expires_at>now();
    v_locked_tokens:=public.coin_locked_tokens_v200(p_profile_id,p_coin_id);
    if p_sell_all and v_reserved_tokens>0 then raise exception 'Tokens are reserved by active conditional orders'; end if;
    if not p_sell_all and p_amount>greatest(0,v_quantity-v_reserved_tokens-v_locked_tokens) then
      raise exception 'Insufficient unlocked and unreserved token balance';
    end if;
  end if;
  if p_side='buy' then
    if p_sell_all then raise exception 'sell_all is invalid for buy'; end if;
    v_result:=public.buy_coin_v2(p_profile_id,p_coin_id,p_amount,p_min_output);
  elsif p_sell_all then
    v_result:=public.sell_coin_all_v2(p_profile_id,p_coin_id,p_min_output);
  else
    v_result:=public.sell_coin_v2(p_profile_id,p_coin_id,p_amount,p_min_output);
  end if;
  insert into public.coin_trade_requests(request_id,profile_id,coin_id,side,input_amount,sell_all,min_output,result)
  values(p_request_id,p_profile_id,p_coin_id,p_side,p_amount,p_sell_all,p_min_output,v_result);
  return v_result;
end;
$$;

create or replace function public.create_coin_v200(
  p_request_id uuid,p_profile_id uuid,p_name text,p_symbol text,p_description text,p_image_url text,
  p_initial_buy numeric,p_start_price numeric,p_floor_price numeric
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_existing public.coin_launch_requests;
  v_fingerprint text;
  v_profile public.profiles;
  v_coin public.coins;
  v_settings public.economy_settings;
  v_reserved numeric;
  v_active_count integer;
  v_last_launch timestamptz;
  v_supply numeric:=1000000000;
  v_initial_quote numeric;
  v_initial_token numeric;
  v_k numeric;
  v_new_quote numeric;
  v_new_token numeric;
  v_fee numeric;
  v_creator_bps integer;
  v_trade_id uuid;
  v_fee_result jsonb;
  v_vip jsonb;
  v_result jsonb;
  v_lock_start timestamptz:=clock_timestamp();
begin
  if p_request_id is null then raise exception 'Launch request ID is required'; end if;
  -- The image URL is intentionally excluded: an HTTP retry may re-upload the
  -- same bytes to a new storage path, while the economic request is identical.
  v_fingerprint:=md5(concat_ws('|',p_profile_id::text,trim(p_name),upper(trim(p_symbol)),coalesce(trim(p_description),''),
    p_initial_buy::text,p_start_price::text,p_floor_price::text));
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_existing from public.coin_launch_requests where request_id=p_request_id;
  if found then
    if v_existing.profile_id<>p_profile_id or v_existing.fingerprint<>v_fingerprint then
      raise exception 'Launch request ID was already used';
    end if;
    return v_existing.result||jsonb_build_object('alreadyCreated',true);
  end if;
  select * into v_settings from public.economy_settings where singleton=true;
  if not found or v_settings.schema_version<200 then raise exception 'Market Economy 2.0 is not ready'; end if;
  if p_initial_buy is null or p_initial_buy<v_settings.coin_initial_buy_min or p_initial_buy>v_settings.coin_initial_buy_max then
    raise exception 'Initial buy is outside allowed bounds';
  end if;
  if p_start_price is null or p_start_price<v_settings.coin_start_price_min or p_start_price>v_settings.coin_start_price_max then
    raise exception 'Start price is outside allowed bounds';
  end if;
  if p_floor_price is null or p_floor_price<0 or p_floor_price>p_start_price*v_settings.coin_floor_max_bps/10000.0 then
    raise exception 'Floor price is outside allowed bounds';
  end if;
  if char_length(trim(p_name))<2 or char_length(trim(p_name))>32 then raise exception 'Invalid coin name'; end if;
  if upper(trim(p_symbol)) !~ '^[A-Z0-9]{2,8}$' then raise exception 'Invalid coin symbol'; end if;
  if char_length(coalesce(p_description,''))>180 then raise exception 'Coin description is too long'; end if;

  perform public.refresh_profile_energy_v200(p_profile_id);
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_banned and (v_profile.banned_until is null or v_profile.banned_until>now()) then raise exception 'Account is blocked'; end if;
  select count(*)::integer,max(created_at) into v_active_count,v_last_launch
  from public.coins where creator_profile_id=p_profile_id and status='active';
  if v_active_count>=v_settings.coin_max_active then raise exception 'Active coin limit reached'; end if;
  if v_last_launch is not null and v_last_launch>now()-make_interval(hours=>v_settings.coin_launch_cooldown_hours) then
    raise exception 'Coin launch is on cooldown';
  end if;
  v_reserved:=public.reserved_market_balance_v056(p_profile_id,null,null,null);
  if v_profile.balance-v_reserved<v_settings.coin_launch_fee+p_initial_buy then
    raise exception 'Insufficient available virtual TON for launch and initial buy';
  end if;
  if v_profile.energy<v_settings.coin_launch_energy_cost then
    raise exception 'Insufficient Energy for coin launch';
  end if;

  v_initial_quote:=v_supply*p_start_price;
  insert into public.coins(creator_profile_id,name,symbol,description,image_url,total_supply,token_reserve,quote_reserve,
    current_price,market_cap,status,hidden_from_market,launch_price,floor_price,floor_expires_at,initial_buy_quote)
  values(p_profile_id,trim(p_name),upper(trim(p_symbol)),left(coalesce(trim(p_description),''),180),
    nullif(trim(coalesce(p_image_url,'')),''),v_supply,v_supply,v_initial_quote,p_start_price,p_start_price*v_supply,
    'active',false,p_start_price,nullif(p_floor_price,0),v_lock_start+make_interval(days=>v_settings.creator_lock_days),p_initial_buy)
  returning * into v_coin;

  update public.profiles set balance=balance-v_settings.coin_launch_fee-p_initial_buy,
    energy=energy-v_settings.coin_launch_energy_cost,energy_updated_at=now(),updated_at=now() where id=p_profile_id;
  v_creator_bps:=least(v_settings.coin_total_fee_bps,public.creator_fee_bps_v200(p_profile_id));
  v_fee:=round(p_initial_buy*v_settings.coin_total_fee_bps/10000.0,8);
  v_k:=v_coin.token_reserve*v_coin.quote_reserve;
  v_new_quote:=v_coin.quote_reserve+p_initial_buy-v_fee;
  v_new_token:=v_k/v_new_quote;
  v_initial_token:=v_coin.token_reserve-v_new_token;
  if v_initial_token<=0 then raise exception 'Initial buy is too small'; end if;
  insert into public.holdings(profile_id,coin_id,quantity,cost_basis)
  values(p_profile_id,v_coin.id,v_initial_token,p_initial_buy);
  update public.coins set token_reserve=v_new_token,quote_reserve=v_new_quote,
    current_price=v_new_quote/v_new_token,market_cap=(v_new_quote/v_new_token)*total_supply,
    initial_buy_tokens=v_initial_token,updated_at=now() where id=v_coin.id returning * into v_coin;
  insert into public.trades(profile_id,coin_id,side,quote_amount,token_amount,price,realized_pnl)
  values(p_profile_id,v_coin.id,'buy',p_initial_buy,v_initial_token,p_initial_buy/v_initial_token,0) returning id into v_trade_id;
  insert into public.coin_early_buyers(coin_id,profile_id,ordinal,first_trade_id)
  values(v_coin.id,p_profile_id,1,v_trade_id);
  insert into public.creator_token_locks(coin_id,profile_id,total_locked,starts_at,ends_at)
  values(v_coin.id,p_profile_id,v_initial_token*v_settings.creator_lock_bps/10000.0,
    v_lock_start,v_lock_start+make_interval(days=>v_settings.creator_lock_days));
  v_fee_result:=public.record_coin_fee_split_v200(v_trade_id,v_coin.id,p_profile_id,p_profile_id,'buy',
    p_initial_buy,v_fee,v_creator_bps,v_settings.coin_total_fee_bps);
  insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
  values(v_coin.id,date_trunc('minute',now()),p_start_price,greatest(p_start_price,v_coin.current_price),
    least(p_start_price,v_coin.current_price),v_coin.current_price,p_initial_buy)
  on conflict(coin_id,bucket_start) do update set high=greatest(public.candles.high,excluded.high),
    low=least(public.candles.low,excluded.low),close=excluded.close,volume=public.candles.volume+excluded.volume;
  insert into public.market_events(actor_profile_id,kind,coin_id) values(p_profile_id,'launch',v_coin.id);
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'coin_launch',-v_settings.coin_launch_fee,v_coin.id,
    jsonb_build_object('symbol',v_coin.symbol,'unit','virtual_ton','initialBuy',p_initial_buy,'startPrice',p_start_price,'floorPrice',p_floor_price));
  perform public.bump_mission(p_profile_id,'create_coin',1);
  v_vip:=public.credit_vip_activity_v200(p_profile_id,'coin_launch',
    v_settings.coin_launch_fee+p_initial_buy,v_coin.id);

  v_result:=jsonb_build_object('id',v_coin.id,'name',v_coin.name,'symbol',v_coin.symbol,'imageUrl',v_coin.image_url,
    'launchFee',v_settings.coin_launch_fee,'initialBuy',p_initial_buy,'initialTokens',v_initial_token,
    'energyCost',v_settings.coin_launch_energy_cost,
    'startPrice',p_start_price,'floorPrice',nullif(p_floor_price,0),'lockTokens',v_initial_token*v_settings.creator_lock_bps/10000.0,
    'lockEndsAt',v_lock_start+make_interval(days=>v_settings.creator_lock_days),'genesisOrdinal',1,'fee',v_fee_result,'vip',v_vip,
    'alreadyCreated',false,'status',v_coin.status);
  insert into public.coin_launch_requests(request_id,profile_id,fingerprint,coin_id,result)
  values(p_request_id,p_profile_id,v_fingerprint,v_coin.id,v_result);
  return v_result;
exception when unique_violation then
  raise exception 'This coin symbol already exists';
end;
$$;

-- Compatibility callers also enter the same bounded v2.00 launch path.
create or replace function public.create_coin_with_image(
  p_profile_id uuid,p_name text,p_symbol text,p_description text,p_image_url text
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.create_coin_v200(gen_random_uuid(),p_profile_id,p_name,p_symbol,p_description,p_image_url,1,0.0000001,0);
end;
$$;

create or replace function public.coin_economy_snapshot_v200(p_profile_id uuid,p_coin_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_coin public.coins;
  v_lock public.creator_token_locks;
  v_locked numeric:=0;
  v_holding numeric:=0;
  v_ordinal integer;
  v_creator_bps integer:=0;
  v_total_bps integer:=50;
  v_creator_verified boolean:=false;
begin
  select * into v_coin from public.coins where id=p_coin_id;
  if not found then raise exception 'Coin not found'; end if;
  select * into v_lock from public.creator_token_locks where coin_id=p_coin_id and profile_id=p_profile_id;
  if found then v_locked:=public.coin_locked_tokens_v200(p_profile_id,p_coin_id); end if;
  select coalesce(quantity,0) into v_holding from public.holdings where profile_id=p_profile_id and coin_id=p_coin_id;
  if not found then v_holding:=0; end if;
  select ordinal into v_ordinal from public.coin_early_buyers where coin_id=p_coin_id and profile_id=p_profile_id;
  select coin_total_fee_bps into v_total_bps from public.economy_settings where singleton=true;
  if v_coin.creator_profile_id is not null then v_creator_bps:=least(v_total_bps,public.creator_fee_bps_v200(v_coin.creator_profile_id)); end if;
  select exists(select 1 from public.profile_entitlements where profile_id=v_coin.creator_profile_id
    and entitlement_key='creator_verified' and (expires_at is null or expires_at>now())) into v_creator_verified;
  return jsonb_build_object(
    'startPrice',v_coin.launch_price,'floorPrice',v_coin.floor_price,
    'floorActive',v_coin.floor_price is not null and v_coin.floor_expires_at>now(),
    'floorExpiresAt',v_coin.floor_expires_at,'initialBuy',v_coin.initial_buy_quote,
    'initialTokens',v_coin.initial_buy_tokens,'totalFeeBps',v_total_bps,
    'creatorFeeBps',v_creator_bps,'platformFeeBps',v_total_bps-v_creator_bps,
    'creatorVerified',v_creator_verified,
    'lock',case when v_lock.coin_id is null then null else jsonb_build_object(
      'total',v_lock.total_locked,'remaining',v_locked,'startsAt',v_lock.starts_at,'endsAt',v_lock.ends_at,
      'availableQuantity',greatest(0,v_holding-v_locked)) end,
    'availableQuantity',greatest(0,v_holding-v_locked),
    'genesisBadge',case when v_ordinal is null then null else jsonb_build_object('ordinal',v_ordinal,'label','Genesis #'||v_ordinal::text) end
  );
end;
$$;

create or replace function public.creator_dashboard_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare v_level jsonb; v_total_bps integer:=50; v_verified boolean:=false; v_analytics boolean:=false;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  v_level:=public.creator_level_v200(p_profile_id);
  select coin_total_fee_bps into v_total_bps from public.economy_settings where singleton=true;
  select exists(select 1 from public.profile_entitlements where profile_id=p_profile_id and entitlement_key='creator_verified'
      and (expires_at is null or expires_at>now())),
    exists(select 1 from public.profile_entitlements where profile_id=p_profile_id and entitlement_key='creator_analytics'
      and (expires_at is null or expires_at>now())) into v_verified,v_analytics;
  return jsonb_build_object(
    'verified',v_verified,'analyticsUnlocked',v_analytics,
    'level',v_level||jsonb_build_object('platformFeeBps',v_total_bps-(v_level->>'creatorFeeBps')::integer,
      'verified',v_verified,'trustLabel',case when v_verified then 'Verified Creator' else 'Community Creator' end),
    'totals',jsonb_build_object(
      'coins',coalesce((v_level->>'coinCount')::integer,0),
      'holders',coalesce((v_level->>'holderCount')::integer,0),
      'volume',coalesce((v_level->>'volume')::numeric,0),
      'creatorFees',coalesce((select sum(creator_fee) from public.coin_fee_ledger where creator_profile_id=p_profile_id),0)
    ),
    'entitlements',coalesce((select jsonb_agg(jsonb_build_object('key',entitlement_key,'expiresAt',expires_at) order by entitlement_key)
      from public.profile_entitlements where profile_id=p_profile_id and entitlement_key like 'creator_%'
        and (expires_at is null or expires_at>now())),'[]'::jsonb),
    'coins',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'symbol',c.symbol,'imageUrl',c.image_url,'status',c.status,
      'currentPrice',c.current_price,'marketCap',c.market_cap,'floorPrice',c.floor_price,
      'floorActive',c.floor_price is not null and c.floor_expires_at>now(),
      'holders',(select count(*) from public.holdings h where h.coin_id=c.id and h.quantity>0),
      'volume',(select coalesce(sum(t.quote_amount),0) from public.trades t where t.coin_id=c.id),
      'creatorFees',(select coalesce(sum(f.creator_fee),0) from public.coin_fee_ledger f where f.coin_id=c.id),
      'uniqueBuyers',case when v_analytics then (select count(distinct t.profile_id) from public.trades t where t.coin_id=c.id and t.side='buy') else null end,
      'buyerRetentionPct',case when v_analytics then coalesce((select round(100.0*count(distinct h.profile_id)/nullif(count(distinct t.profile_id),0),2)
        from public.trades t left join public.holdings h on h.coin_id=t.coin_id and h.profile_id=t.profile_id and h.quantity>0
        where t.coin_id=c.id and t.side='buy'),0) else null end,
      'buySellRatio',case when v_analytics then coalesce((select round(sum(quote_amount) filter(where side='buy')/
        nullif(sum(quote_amount) filter(where side='sell'),0),3) from public.trades where coin_id=c.id),0) else null end,
      'boostedUntil',(select max(b.ends_at) from public.coin_boosts b where b.coin_id=c.id and b.ends_at>now()),
      'createdAt',c.created_at
    ) order by c.created_at desc) from public.coins c where c.creator_profile_id=p_profile_id),'[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Referral partner levels. Only genuine system emissions and paid store/Stars
-- fulfilment are eligible; coin/gift trading turnover can never mint a bonus.
-- ---------------------------------------------------------------------------

alter table public.referral_rewards drop constraint if exists referral_rewards_source_kind_check;
alter table public.referral_rewards add constraint referral_rewards_source_kind_v200_check
  check(source_kind in ('rewarded_ad','mission','stars','store'));

create or replace function public.referral_partner_status_v200(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_invited integer:=0;
  v_qualified integer:=0;
  v_level text;
  v_bps integer;
  v_next integer;
  v_earned_ton numeric:=0;
  v_earned_mxm numeric:=0;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  select count(*)::integer,count(*) filter(where
    exists(select 1 from public.star_purchases sp where sp.profile_id=p.id and sp.status='paid')
    or exists(select 1 from public.trades t where t.profile_id=p.id)
  )::integer into v_invited,v_qualified
  from public.profiles p where p.referrer_profile_id=p_profile_id and coalesce(p.is_system,false)=false;
  if v_qualified>=50 then v_level:='Diamond'; v_bps:=1500; v_next:=null;
  elsif v_qualified>=20 then v_level:='Gold'; v_bps:=1000; v_next:=50;
  elsif v_qualified>=5 then v_level:='Silver'; v_bps:=750; v_next:=20;
  else v_level:='Bronze'; v_bps:=500; v_next:=5;
  end if;
  select coalesce(sum(reward_amount) filter(where source_kind<>'store'),0),
    coalesce(sum(reward_amount) filter(where source_kind='store'),0)
  into v_earned_ton,v_earned_mxm from public.referral_rewards where referrer_profile_id=p_profile_id;
  return jsonb_build_object('level',v_level,'bonusBps',v_bps,'invited',v_invited,'qualified',v_qualified,
    'nextQualified',v_next,'earnedVirtualTon',v_earned_ton,'earnedMxmCoins',v_earned_mxm);
end;
$$;

create or replace function public.credit_referral_bonus_v046(
  p_referred_profile_id uuid,p_source_kind text,p_source_amount numeric,p_reference_id uuid default null
) returns numeric language plpgsql security definer set search_path=public as $$
declare
  v_referrer uuid;
  v_bps integer;
  v_reward numeric;
  v_inserted integer;
begin
  if p_source_amount is null or p_source_amount<=0
     or p_source_kind not in ('mission','stars','store') then return 0; end if;
  -- Every eligible production caller has an immutable reference. Declining a
  -- reference-less bonus is safer than creating a retry-based emission path.
  if p_reference_id is null then return 0; end if;
  select referrer_profile_id into v_referrer from public.profiles where id=p_referred_profile_id;
  if v_referrer is null or v_referrer=p_referred_profile_id then return 0; end if;
  v_bps:=coalesce((public.referral_partner_status_v200(v_referrer)->>'bonusBps')::integer,500);
  v_reward:=case when p_source_kind='store'
    then floor(p_source_amount*v_bps/10000.0)
    else round(p_source_amount*v_bps/10000.0,8) end;
  if v_reward<=0 then return 0; end if;
  insert into public.referral_rewards(referrer_profile_id,referred_profile_id,source_kind,source_amount,reward_amount,reference_id)
  values(v_referrer,p_referred_profile_id,p_source_kind,p_source_amount,v_reward,p_reference_id)
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return 0; end if;
  if p_source_kind='store' then
    update public.profiles set mxm_coins=mxm_coins+v_reward::bigint,updated_at=now() where id=v_referrer;
  else
    update public.profiles set balance=balance+v_reward,updated_at=now() where id=v_referrer;
  end if;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_referrer,'referral',v_reward,p_reference_id,jsonb_build_object(
    'referredProfileId',p_referred_profile_id,'sourceKind',p_source_kind,'sourceAmount',p_source_amount,
    'bonusBps',v_bps,'unit',case when p_source_kind='store' then 'mxm_coins' else 'virtual_ton' end));
  return v_reward;
end;
$$;

-- ---------------------------------------------------------------------------
-- Collection completion bonus: five currently owned, non-burned Gifts from a
-- collection unlock one permanent virtual badge and a one-time MXM grant.
-- ---------------------------------------------------------------------------

create table if not exists public.collection_bonus_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  base_name text not null,
  item_key text not null references public.profile_items(item_key) on delete restrict,
  owned_count integer not null check(owned_count>=5),
  mxm_reward integer not null check(mxm_reward>0),
  claimed_at timestamptz not null default now(),
  primary key(profile_id,base_name)
);
create index if not exists collection_bonus_claims_profile_v200_idx on public.collection_bonus_claims(profile_id,claimed_at desc);
create unique index if not exists collection_bonus_claims_canonical_v200_uidx
  on public.collection_bonus_claims(profile_id,lower(trim(base_name)));
alter table public.collection_bonus_claims drop constraint if exists collection_bonus_claims_owned_count_check;
alter table public.collection_bonus_claims add constraint collection_bonus_claims_owned_count_v200_check check(owned_count>=1);
alter table public.collection_bonus_claims enable row level security;
revoke all on public.collection_bonus_claims from public,anon,authenticated;
grant all on public.collection_bonus_claims to service_role;

create or replace function public.collection_bonus_status_v200(p_profile_id uuid,p_base_name text)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare v_name text:=trim(coalesce(p_base_name,'')); v_owned integer:=0; v_total integer:=0; v_target integer:=5; v_claimed boolean:=false;
begin
  if char_length(v_name)<1 or char_length(v_name)>120 then raise exception 'Invalid collection name'; end if;
  select count(distinct coalesce(nullif(ga.gift_id,''),nullif(ga.telegram_name,''),ga.id::text))::integer into v_total
  from public.gift_assets ga where lower(trim(ga.base_name))=lower(v_name) and coalesce(ga.is_burned,false)=false;
  v_target:=least(5,greatest(1,v_total));
  select count(distinct coalesce(nullif(ga.gift_id,''),nullif(ga.telegram_name,''),ga.id::text))::integer into v_owned
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where vg.owner_profile_id=p_profile_id and lower(trim(ga.base_name))=lower(v_name) and coalesce(ga.is_burned,false)=false;
  select exists(select 1 from public.collection_bonus_claims where profile_id=p_profile_id and lower(trim(base_name))=lower(v_name)) into v_claimed;
  return jsonb_build_object('collection',v_name,'ownedCount',v_owned,'itemCount',v_total,'target',v_target,
    'eligible',v_total>0 and v_owned>=v_target and not v_claimed,'claimed',v_claimed);
end;
$$;

create or replace function public.claim_collection_bonus_v200(p_profile_id uuid,p_base_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_name text:=trim(coalesce(p_base_name,''));
  v_slug text;
  v_canonical text;
  v_item_key text;
  v_count integer:=0;
  v_target integer:=5;
  v_status jsonb;
  v_reward integer:=500;
  v_existing public.collection_bonus_claims;
begin
  if char_length(v_name)<1 or char_length(v_name)>120 then raise exception 'Invalid collection name'; end if;
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into v_existing from public.collection_bonus_claims
  where profile_id=p_profile_id and lower(trim(base_name))=lower(v_name);
  if found then
    return jsonb_build_object('status','claimed','alreadyClaimed',true,'collection',v_existing.base_name,
      'ownedCount',v_existing.owned_count,'reward',jsonb_build_object('mxmCoins',v_existing.mxm_reward,'itemKey',v_existing.item_key));
  end if;
  v_status:=public.collection_bonus_status_v200(p_profile_id,v_name);
  v_count:=coalesce((v_status->>'ownedCount')::integer,0);
  v_target:=coalesce((v_status->>'target')::integer,5);
  if not coalesce((v_status->>'eligible')::boolean,false) then
    return jsonb_build_object('status','locked','ownedCount',v_count,'requiredCount',v_target);
  end if;
  v_canonical:=lower(regexp_replace(v_name,'\s+',' ','g'));
  v_slug:=trim(both '-' from regexp_replace(v_canonical,'[^a-z0-9]+','-','g'));
  if v_slug='' then v_slug:='collection'; end if;
  v_item_key:='collection:'||left(v_slug,55)||':'||substr(md5(v_canonical),1,12);
  insert into public.profile_items(item_key,item_type,title,rarity,metadata)
  values(v_item_key,'badge',left(v_name,100)||' Collector','rare',jsonb_build_object('collection',v_name,'requiredCount',v_target))
  on conflict(item_key) do nothing;
  insert into public.collection_bonus_claims(profile_id,base_name,item_key,owned_count,mxm_reward)
  values(p_profile_id,v_name,v_item_key,v_count,v_reward);
  update public.profiles set mxm_coins=mxm_coins+v_reward,updated_at=now() where id=p_profile_id;
  insert into public.profile_item_inventory(profile_id,item_key,source)
  values(p_profile_id,v_item_key,'collection_bonus') on conflict(profile_id,item_key) do nothing;
  insert into public.economy_events(profile_id,kind,amount,metadata)
  values(p_profile_id,'collection_bonus',v_reward,jsonb_build_object('unit','mxm_coins','collection',v_name,'itemKey',v_item_key,'ownedCount',v_count));
  return jsonb_build_object('status','claimed','alreadyClaimed',false,'collection',v_name,'ownedCount',v_count,
    'reward',jsonb_build_object('mxmCoins',v_reward,'itemKey',v_item_key,'label',v_name||' Collector'));
end;
$$;

create or replace function public.purchase_with_mxm_v200(p_request_id uuid,p_profile_id uuid,p_sku text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_existing public.mxm_purchase_requests;
  v_sink public.mxm_sink_products;
  v_product public.store_products;
  v_profile public.profiles;
  v_case public.case_definitions;
  v_eligibility jsonb;
  v_reward jsonb;
  v_item text;
  v_result jsonb;
begin
  if p_request_id is null then raise exception 'MXM purchase request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('star-auth:'||p_profile_id::text||':'||coalesce(p_sku,'legacy'),0));
  select * into v_existing from public.mxm_purchase_requests where request_id=p_request_id;
  if found then
    if v_existing.profile_id<>p_profile_id or v_existing.sku<>p_sku then raise exception 'MXM request ID was already used'; end if;
    return v_existing.result||jsonb_build_object('alreadyPurchased',true);
  end if;
  select * into v_sink from public.mxm_sink_products where sku=p_sku and active=true;
  if not found then raise exception 'MXM sink product is unavailable'; end if;
  select * into v_product from public.store_products where sku=p_sku and active=true;
  if not found then raise exception 'Store product is unavailable'; end if;
  perform public.refresh_profile_energy_v200(p_profile_id);
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.mxm_coins<v_sink.mxm_price then raise exception 'Insufficient MXM Coins'; end if;
  v_eligibility:=public.store_purchase_eligibility_v200(p_profile_id,p_sku,'{}'::jsonb);
  if not coalesce((v_eligibility->>'eligible')::boolean,false) then
    raise exception 'MXM purchase is not eligible: %',coalesce(v_eligibility->>'reason','unknown');
  end if;
  update public.profiles set mxm_coins=mxm_coins-v_sink.mxm_price,updated_at=now() where id=p_profile_id;
  if v_product.metadata ? 'caseTier' then
    select * into v_case from public.case_definitions where sku=p_sku and active=true for update;
    if not found or (v_case.remaining_supply is not null and v_case.remaining_supply<1) then raise exception 'Case is sold out'; end if;
    update public.case_definitions set remaining_supply=remaining_supply-1 where sku=p_sku and remaining_supply is not null;
    insert into public.profile_inventory(profile_id,sku,quantity) values(p_profile_id,p_sku,1)
    on conflict(profile_id,sku) do update set quantity=public.profile_inventory.quantity+1,updated_at=now();
    v_reward:=jsonb_build_object('kind','case','sku',p_sku,'amount',1,'label',v_product.reward_label);
  elsif coalesce((v_product.metadata->>'energyRefill')::boolean,false) then
    update public.profiles set energy=max_energy,energy_updated_at=now(),updated_at=now() where id=p_profile_id;
    v_reward:=jsonb_build_object('kind','energy_refill','label',v_product.reward_label);
  elsif v_product.metadata ? 'profileItem' then
    v_item:=v_product.metadata->>'profileItem';
    v_reward:=public.grant_virtual_reward_v200(p_profile_id,'profile_item',1,
      jsonb_build_object('itemKey',v_item,'label',v_product.reward_label),'mxm_shop',p_request_id);
  else
    raise exception 'Unsupported MXM sink product';
  end if;
  v_result:=jsonb_build_object('status','purchased','alreadyPurchased',false,'sku',p_sku,
    'price',v_sink.mxm_price,'reward',v_reward,'mxmCoins',v_profile.mxm_coins-v_sink.mxm_price);
  insert into public.mxm_purchase_requests(request_id,profile_id,sku,price,result)
  values(p_request_id,p_profile_id,p_sku,v_sink.mxm_price,v_result);
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'store',-v_sink.mxm_price,p_request_id,jsonb_build_object('unit','mxm_coins','sku',p_sku,'reward',v_reward));
  return v_result;
end;
$$;

create or replace function public.set_watchlist_v200(
  p_profile_id uuid,p_kind text,p_enabled boolean,p_limit integer,
  p_coin_id uuid default null,p_gift_collection text default null,p_virtual_gift_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_exists boolean:=false; v_count integer:=0;
begin
  if p_kind not in ('coin','gift_collection','gift') or p_limit is null or p_limit<1 or p_limit>1000 then
    raise exception 'Invalid watchlist request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('watchlist:'||p_profile_id::text,0));
  perform 1 from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_kind='coin' then
    if p_coin_id is null then raise exception 'Coin ID is required'; end if;
    if p_enabled and not exists(select 1 from public.coins where id=p_coin_id and status='active') then raise exception 'Coin not found'; end if;
    select exists(select 1 from public.user_watchlist where profile_id=p_profile_id and kind='coin' and coin_id=p_coin_id) into v_exists;
  elsif p_kind='gift' then
    if p_virtual_gift_id is null then raise exception 'Gift ID is required'; end if;
    if p_enabled and not exists(select 1 from public.virtual_gifts where id=p_virtual_gift_id) then raise exception 'Gift not found'; end if;
    select exists(select 1 from public.user_watchlist where profile_id=p_profile_id and kind='gift' and virtual_gift_id=p_virtual_gift_id) into v_exists;
  else
    p_gift_collection:=trim(coalesce(p_gift_collection,''));
    if p_gift_collection='' then raise exception 'Collection name is required'; end if;
    if p_enabled and not exists(select 1 from public.gift_assets where base_name=p_gift_collection) then raise exception 'Collection not found'; end if;
    select exists(select 1 from public.user_watchlist where profile_id=p_profile_id and kind='gift_collection' and gift_collection=p_gift_collection) into v_exists;
  end if;
  if p_enabled and not v_exists then
    select count(*)::integer into v_count from public.user_watchlist where profile_id=p_profile_id;
    if v_count>=p_limit then raise exception 'Watchlist limit reached'; end if;
    insert into public.user_watchlist(profile_id,kind,coin_id,gift_collection,virtual_gift_id)
    values(p_profile_id,p_kind,case when p_kind='coin' then p_coin_id end,
      case when p_kind='gift_collection' then p_gift_collection end,case when p_kind='gift' then p_virtual_gift_id end);
  elsif not p_enabled and v_exists then
    delete from public.user_watchlist where profile_id=p_profile_id and kind=p_kind
      and (p_kind<>'coin' or coin_id=p_coin_id)
      and (p_kind<>'gift' or virtual_gift_id=p_virtual_gift_id)
      and (p_kind<>'gift_collection' or gift_collection=p_gift_collection);
  end if;
  return jsonb_build_object('enabled',p_enabled,'alreadyInState',p_enabled=v_exists);
end;
$$;

-- Service-role-only mutation surface.
revoke execute on function public.grant_virtual_reward_v200(uuid,text,integer,jsonb,text,uuid) from public,anon,authenticated;
revoke execute on function public.refresh_profile_energy_v200(uuid) from public,anon,authenticated;
revoke execute on function public.equip_profile_item_v200(uuid,text) from public,anon,authenticated;
revoke execute on function public.monetization_snapshot_v200(uuid) from public,anon,authenticated;
revoke execute on function public.claim_premium_daily_v200(uuid) from public,anon,authenticated;
revoke execute on function public.finalize_star_purchase_v200(uuid,text,integer,bigint) from public,anon,authenticated;
revoke execute on function public.authorize_star_precheckout_v200(uuid,text,text,bigint,integer) from public,anon,authenticated;
revoke execute on function public.release_expired_star_authorizations_v200(integer) from public,anon,authenticated;
revoke execute on function public.mark_star_purchase_refunded_v200(uuid,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.store_purchase_eligibility_v200(uuid,text,jsonb) from public,anon,authenticated;
revoke execute on function public.case_snapshot_v200(uuid) from public,anon,authenticated;
revoke execute on function public.open_case_v200(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.season_snapshot_v200(uuid) from public,anon,authenticated;
revoke execute on function public.claim_season_reward_v200(uuid,integer,text) from public,anon,authenticated;
revoke execute on function public.creator_level_v200(uuid) from public,anon,authenticated;
revoke execute on function public.creator_fee_bps_v200(uuid) from public,anon,authenticated;
revoke execute on function public.coin_locked_tokens_v200(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.credit_vip_activity_v200(uuid,text,numeric,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.record_coin_fee_split_v200(uuid,uuid,uuid,uuid,text,numeric,numeric,integer,integer) from public,anon,authenticated;
revoke execute on function public.buy_coin_v2(uuid,uuid,numeric,numeric) from public,anon,authenticated,service_role;
revoke execute on function public.sell_coin_v2(uuid,uuid,numeric,numeric) from public,anon,authenticated,service_role;
revoke execute on function public.sell_coin_all_v2(uuid,uuid,numeric) from public,anon,authenticated,service_role;
revoke execute on function public.execute_coin_trade_v3(uuid,uuid,uuid,text,numeric,boolean,numeric) from public,anon,authenticated;
revoke execute on function public.create_coin_v200(uuid,uuid,text,text,text,text,numeric,numeric,numeric) from public,anon,authenticated;
revoke execute on function public.create_coin_with_image(uuid,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.coin_economy_snapshot_v200(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.creator_dashboard_v200(uuid) from public,anon,authenticated;
revoke execute on function public.referral_partner_status_v200(uuid) from public,anon,authenticated;
revoke execute on function public.credit_referral_bonus_v046(uuid,text,numeric,uuid) from public,anon,authenticated;
revoke execute on function public.claim_collection_bonus_v200(uuid,text) from public,anon,authenticated;
revoke execute on function public.collection_bonus_status_v200(uuid,text) from public,anon,authenticated;
revoke execute on function public.ensure_current_season_v200() from public,anon,authenticated;
revoke execute on function public.purchase_with_mxm_v200(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.set_watchlist_v200(uuid,text,boolean,integer,uuid,text,uuid) from public,anon,authenticated;

grant execute on function public.equip_profile_item_v200(uuid,text),public.monetization_snapshot_v200(uuid),
  public.claim_premium_daily_v200(uuid),public.finalize_star_purchase_v200(uuid,text,integer,bigint),
  public.authorize_star_precheckout_v200(uuid,text,text,bigint,integer),
  public.release_expired_star_authorizations_v200(integer),
  public.mark_star_purchase_refunded_v200(uuid,text,text,jsonb),
  public.store_purchase_eligibility_v200(uuid,text,jsonb),
  public.case_snapshot_v200(uuid),public.open_case_v200(uuid,text,uuid),public.season_snapshot_v200(uuid),
  public.claim_season_reward_v200(uuid,integer,text),public.execute_coin_trade_v3(uuid,uuid,uuid,text,numeric,boolean,numeric),
  public.create_coin_v200(uuid,uuid,text,text,text,text,numeric,numeric,numeric),public.coin_economy_snapshot_v200(uuid,uuid),
  public.creator_dashboard_v200(uuid),public.referral_partner_status_v200(uuid),
  public.claim_collection_bonus_v200(uuid,text) to service_role;

grant execute on function public.grant_virtual_reward_v200(uuid,text,integer,jsonb,text,uuid),
  public.refresh_profile_energy_v200(uuid),public.ensure_current_season_v200(),
  public.creator_level_v200(uuid),public.creator_fee_bps_v200(uuid),public.coin_locked_tokens_v200(uuid,uuid),
  public.record_coin_fee_split_v200(uuid,uuid,uuid,uuid,text,numeric,numeric,integer,integer),
  public.create_coin_with_image(uuid,text,text,text,text),
  public.credit_referral_bonus_v046(uuid,text,numeric,uuid),public.collection_bonus_status_v200(uuid,text),
  public.purchase_with_mxm_v200(uuid,uuid,text),public.set_watchlist_v200(uuid,text,boolean,integer,uuid,text,uuid) to service_role;

commit;
