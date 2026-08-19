begin;

-- MXM v0.45 — controlled virtual-TON economy + rewarded ads.
-- IMPORTANT: every TON amount in MXM is an internal, non-withdrawable game balance.

create table if not exists public.economy_settings (
  singleton boolean primary key default true check(singleton),
  schema_version integer not null default 45,
  rewarded_ad_reward numeric(18,8) not null default 50 check(rewarded_ad_reward between 1 and 500),
  rewarded_ad_daily_limit integer not null default 2 check(rewarded_ad_daily_limit between 0 and 20),
  rewarded_ad_cooldown_minutes integer not null default 30 check(rewarded_ad_cooldown_minutes between 0 and 1440),
  coin_launch_fee numeric(18,8) not null default 150 check(coin_launch_fee between 0 and 100000),
  coin_launch_cooldown_hours integer not null default 12 check(coin_launch_cooldown_hours between 1 and 168),
  coin_max_active integer not null default 2 check(coin_max_active between 1 and 20),
  gift_fee_bps integer not null default 250 check(gift_fee_bps between 0 and 1000),
  updated_at timestamptz not null default now()
);
alter table public.economy_settings add column if not exists schema_version integer not null default 44;
insert into public.economy_settings(singleton) values(true) on conflict(singleton) do nothing;
-- If an unreleased v0.44 migration was applied manually, converge it to the v0.45 defaults.
update public.economy_settings set
  schema_version=45,
  rewarded_ad_reward=50,
  rewarded_ad_daily_limit=2,
  rewarded_ad_cooldown_minutes=30,
  coin_launch_fee=150,
  coin_launch_cooldown_hours=12,
  coin_max_active=2,
  gift_fee_bps=250,
  updated_at=now()
where singleton=true and schema_version<45;
alter table public.economy_settings alter column schema_version set default 45;
alter table public.economy_settings enable row level security;
revoke all on public.economy_settings from public,anon,authenticated;
grant select,update on public.economy_settings to service_role;

create table if not exists public.economy_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  kind text not null check(kind in ('rewarded_ad','coin_launch','coin_trade_fee','mission','admin','system')),
  amount numeric(24,8) not null,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists economy_events_profile_created_v045_idx on public.economy_events(profile_id,created_at desc);
create index if not exists economy_events_kind_created_v045_idx on public.economy_events(kind,created_at desc);
alter table public.economy_events enable row level security;
revoke all on public.economy_events from public,anon,authenticated;
grant all on public.economy_events to service_role;

-- Converge the ledger constraint if an unreleased v0.45 draft was applied earlier.
alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events add constraint economy_events_kind_check
  check(kind in ('rewarded_ad','coin_launch','coin_trade_fee','mission','admin','system'));

-- AMM fees are burned by the trading functions. Record that sink automatically
-- from the immutable trade row so the admin economy monitor sees real net flow.
create or replace function public.log_coin_trade_fee_v045()
returns trigger language plpgsql set search_path=public as $$
declare v_rate numeric:=0.005; v_fee numeric;
begin
  v_fee:=case
    when new.side='buy' then round(new.quote_amount*v_rate,8)
    else round((new.quote_amount*v_rate)/(1-v_rate),8)
  end;
  if v_fee>0 then
    insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
    values(new.profile_id,'coin_trade_fee',-v_fee,new.id,jsonb_build_object('coinId',new.coin_id,'side',new.side,'rate',v_rate));
  end if;
  return new;
end;
$$;
drop trigger if exists trades_economy_fee_v045 on public.trades;
create trigger trades_economy_fee_v045 after insert on public.trades
for each row execute function public.log_coin_trade_fee_v045();
revoke execute on function public.log_coin_trade_fee_v045() from public,anon,authenticated;

create table if not exists public.rewarded_ad_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'adsgram' check(provider in ('adsgram','monetag')),
  reward numeric(18,8) not null check(reward>0),
  status text not null default 'created' check(status in ('created','claimed','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '15 minutes'),
  claimed_at timestamptz,
  client_completed_at timestamptz,
  verified_at timestamptz,
  verification_source text,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.rewarded_ad_sessions add column if not exists client_completed_at timestamptz;
alter table public.rewarded_ad_sessions add column if not exists verified_at timestamptz;
alter table public.rewarded_ad_sessions add column if not exists verification_source text;
alter table public.rewarded_ad_sessions add column if not exists metadata jsonb not null default '{}'::jsonb;
update public.rewarded_ad_sessions set status='expired' where status='created' and expires_at<=now();
with ranked as (
  select id,row_number() over(partition by profile_id order by created_at desc,id desc) as rn
  from public.rewarded_ad_sessions where status='created'
)
update public.rewarded_ad_sessions s set status='expired' from ranked r where s.id=r.id and r.rn>1;
create index if not exists rewarded_ad_sessions_profile_created_v045_idx on public.rewarded_ad_sessions(profile_id,created_at desc);
create index if not exists rewarded_ad_sessions_claimed_v045_idx on public.rewarded_ad_sessions(profile_id,claimed_at desc) where status='claimed';
create unique index if not exists rewarded_ad_sessions_one_open_v045_idx on public.rewarded_ad_sessions(profile_id) where status='created';
alter table public.rewarded_ad_sessions enable row level security;
revoke all on public.rewarded_ad_sessions from public,anon,authenticated;
grant all on public.rewarded_ad_sessions to service_role;

-- Treasury receives market fees and is excluded from player circulation/leaderboards.
do $$
declare v_treasury uuid; v_fee integer;
begin
  insert into public.profiles(telegram_id,username,first_name,last_name,photo_url,balance,is_system,hidden_from_leaderboard)
  values(-900000000000000050,null,'MXM Treasury',null,null,0,true,true)
  on conflict(telegram_id) do update set is_system=true,hidden_from_leaderboard=true,first_name='MXM Treasury',updated_at=now()
  returning id into v_treasury;

  select gift_fee_bps into v_fee from public.economy_settings where singleton=true;
  update public.market_settings
  set gift_fee_bps=coalesce(v_fee,250),treasury_profile_id=v_treasury,updated_at=now()
  where singleton=true;
end $$;

-- Rewards are intentionally smaller than the ad cap. Ads are meaningful, while normal activity still matters.
insert into public.missions(key,period,title,description,reward,target,action_type,sort_order,active) values
  ('open_app','onboarding','Добро пожаловать','Открой MXM из Telegram.',10,1,'open_app',10,true),
  ('sync_gifts','onboarding','Подключить подарки','Импортируй свои уникальные подарки Telegram.',20,1,'sync_gift',20,true),
  ('first_coin_trade','onboarding','Первая сделка','Совершить первую сделку с мемкоином.',10,1,'coin_trade',30,true),
  ('first_gift_buy','onboarding','Первый подарок','Купить первый виртуальный Telegram Gift.',20,1,'gift_buy',40,true),
  ('daily_trades','daily','Три сделки','Совершить 3 сделки с мемкоинами сегодня.',4,3,'coin_trade',100,true),
  ('daily_offer','daily','Сделать оффер','Предложить цену за подарок другого игрока.',2,1,'gift_offer',110,true),
  ('daily_listing','daily','Выставить подарок','Выставить один свой подарок на продажу.',2,1,'gift_list',120,true),
  ('daily_profit','daily','Закрыть в плюс','Закрыть одну прибыльную позицию по мемкоину.',4,1,'profitable_trade',130,true),
  ('weekly_market','weekly','Активный трейдер','Совершить 20 сделок с мемкоинами за неделю.',20,20,'coin_trade',200,true),
  ('weekly_collector','weekly','Коллекционер','Купить 4 подарка за неделю.',20,4,'gift_buy',210,true),
  ('weekly_creator','weekly','Запустить мемкоин','Создать один мемкоин за неделю.',15,1,'create_coin',220,true),
  ('weekly_flip','weekly','Перепродажа','Продать 2 подарка дороже цены приобретения.',25,2,'profitable_gift_sale',230,true)
on conflict(key) do update set
  period=excluded.period,title=excluded.title,description=excluded.description,reward=excluded.reward,target=excluded.target,
  action_type=excluded.action_type,sort_order=excluded.sort_order,active=excluded.active;

-- PnL must mean realized trading PnL. Emissions, admin grants and launch fees must not masquerade as profit/loss.
create or replace function public.profile_snapshot_v040(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'balance',p.balance,
    'reservedBalance',coalesce(public.pending_gift_offer_total(p.id,null),0),
    'coinValue',coalesce(f.coin_value,0),
    'giftValue',coalesce(f.gift_value,0),
    'netWorth',coalesce(f.net_worth,p.balance),
    'realizedPnl',coalesce(f.realized_pnl,0)
  )
  from public.profiles p
  left join public.profile_financial_overview f on f.id=p.id
  where p.id=p_profile_id;
$$;
revoke execute on function public.profile_snapshot_v040(uuid) from public,anon,authenticated;
grant execute on function public.profile_snapshot_v040(uuid) to service_role;

create or replace function public.session_profile_snapshot_v040(p_telegram_id bigint)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'id',p.id,
    'telegram_id',p.telegram_id,
    'username',p.username,
    'first_name',p.first_name,
    'last_name',p.last_name,
    'photo_url',p.photo_url,
    'balance',p.balance,
    'xp',p.xp,
    'last_gift_sync_at',p.last_gift_sync_at,
    'is_banned',p.is_banned,
    'banned_until',p.banned_until,
    'created_at',p.created_at,
    'reserved_balance',coalesce(public.pending_gift_offer_total(p.id,null),0),
    'coin_value',coalesce(f.coin_value,0),
    'gift_value',coalesce(f.gift_value,0),
    'net_worth',coalesce(f.net_worth,p.balance),
    'realized_pnl',coalesce(f.realized_pnl,0)
  )
  from public.profiles p
  left join public.profile_financial_overview f on f.id=p.id
  where p.telegram_id=p_telegram_id;
$$;
revoke execute on function public.session_profile_snapshot_v040(bigint) from public,anon,authenticated;
grant execute on function public.session_profile_snapshot_v040(bigint) to service_role;

create or replace function public.rewarded_ad_status_v045(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_settings public.economy_settings;
  v_claimed integer:=0;
  v_last_claim timestamptz;
  v_next timestamptz;
  v_remaining integer:=0;
  v_open uuid;
  v_utc_day timestamptz := (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC');
begin
  select * into v_settings from public.economy_settings where singleton=true;
  if not found then raise exception 'Настройки экономики не найдены'; end if;

  update public.rewarded_ad_sessions
  set status='expired'
  where profile_id=p_profile_id and status='created' and expires_at<=now();

  select count(*)::integer,max(claimed_at) into v_claimed,v_last_claim
  from public.rewarded_ad_sessions
  where profile_id=p_profile_id and status='claimed' and claimed_at>=v_utc_day;

  select id into v_open from public.rewarded_ad_sessions
  where profile_id=p_profile_id and status='created' and expires_at>now()
  order by created_at desc limit 1;

  v_remaining:=greatest(0,v_settings.rewarded_ad_daily_limit-v_claimed);
  if v_last_claim is not null then
    v_next:=v_last_claim+make_interval(mins=>v_settings.rewarded_ad_cooldown_minutes);
  end if;

  return jsonb_build_object(
    'reward',v_settings.rewarded_ad_reward,
    'dailyLimit',v_settings.rewarded_ad_daily_limit,
    'claimedToday',v_claimed,
    'remainingToday',v_remaining,
    'cooldownMinutes',v_settings.rewarded_ad_cooldown_minutes,
    'nextAvailableAt',case when v_next is not null and v_next>now() then v_next else null end,
    'activeSessionId',v_open,
    'canStart',v_remaining>0 and (v_next is null or v_next<=now()) and v_open is null
  );
end;
$$;

create or replace function public.create_rewarded_ad_session_v045(p_profile_id uuid,p_provider text default 'adsgram')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_status jsonb;
  v_reward numeric;
  v_id uuid;
  v_exp timestamptz;
  v_existing public.rewarded_ad_sessions;
begin
  if p_provider not in ('adsgram','monetag') then raise exception 'Неизвестная рекламная сеть'; end if;
  perform 1 from public.profiles where id=p_profile_id and coalesce(is_system,false)=false for update;
  if not found then raise exception 'Профиль не найден'; end if;

  update public.rewarded_ad_sessions set status='expired'
  where profile_id=p_profile_id and status='created' and expires_at<=now();

  select * into v_existing from public.rewarded_ad_sessions
  where profile_id=p_profile_id and status='created' and expires_at>now()
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object('sessionId',v_existing.id,'reward',v_existing.reward,'expiresAt',v_existing.expires_at,'reused',true);
  end if;

  v_status:=public.rewarded_ad_status_v045(p_profile_id);
  if coalesce((v_status->>'remainingToday')::integer,0)<=0 then raise exception 'Лимит рекламы на сегодня исчерпан'; end if;
  if not coalesce((v_status->>'canStart')::boolean,false) then raise exception 'Следующая реклама будет доступна позже'; end if;

  select rewarded_ad_reward into v_reward from public.economy_settings where singleton=true;
  v_exp:=now()+interval '15 minutes';
  insert into public.rewarded_ad_sessions(profile_id,provider,reward,expires_at)
  values(p_profile_id,p_provider,v_reward,v_exp)
  returning id into v_id;

  return jsonb_build_object('sessionId',v_id,'reward',v_reward,'expiresAt',v_exp,'reused',false);
exception when unique_violation then
  raise exception 'Рекламная сессия уже запущена';
end;
$$;

-- Only server-side functions below are allowed to credit a rewarded-ad session.
create or replace function public.finalize_rewarded_ad_v045(p_session_id uuid,p_verification_source text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_session public.rewarded_ad_sessions;
  v_settings public.economy_settings;
  v_claimed integer:=0;
  v_last_claim timestamptz;
  v_balance numeric;
  v_utc_day timestamptz := (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC');
begin
  if p_verification_source not in ('adsgram_server','client_fallback') then raise exception 'Некорректный источник подтверждения'; end if;

  select * into v_session from public.rewarded_ad_sessions where id=p_session_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if v_session.status='claimed' then
    select balance into v_balance from public.profiles where id=v_session.profile_id;
    return jsonb_build_object('status','claimed','reward',v_session.reward,'balance',v_balance,'alreadyClaimed',true);
  end if;
  if v_session.status<>'created' or v_session.expires_at<=now() then
    update public.rewarded_ad_sessions set status='expired' where id=p_session_id and status='created';
    return jsonb_build_object('status','expired');
  end if;

  select * into v_settings from public.economy_settings where singleton=true;
  select count(*)::integer,max(claimed_at) into v_claimed,v_last_claim
  from public.rewarded_ad_sessions
  where profile_id=v_session.profile_id and status='claimed' and claimed_at>=v_utc_day and id<>p_session_id;
  if v_claimed>=v_settings.rewarded_ad_daily_limit then
    update public.rewarded_ad_sessions set status='expired' where id=p_session_id;
    return jsonb_build_object('status','limit');
  end if;
  if v_last_claim is not null and v_last_claim>now()-make_interval(mins=>v_settings.rewarded_ad_cooldown_minutes) then
    update public.rewarded_ad_sessions set status='expired' where id=p_session_id;
    return jsonb_build_object('status','cooldown');
  end if;

  perform 1 from public.profiles where id=v_session.profile_id and coalesce(is_system,false)=false for update;
  if not found then return jsonb_build_object('status','missing_profile'); end if;

  update public.rewarded_ad_sessions
  set status='claimed',claimed_at=now(),verified_at=now(),verification_source=p_verification_source,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verification',p_verification_source)
  where id=p_session_id;
  update public.profiles set balance=balance+v_session.reward,updated_at=now()
  where id=v_session.profile_id returning balance into v_balance;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_session.profile_id,'rewarded_ad',v_session.reward,p_session_id,jsonb_build_object('provider',v_session.provider,'verification',p_verification_source));

  return jsonb_build_object('status','claimed','reward',v_session.reward,'balance',v_balance,'alreadyClaimed',false);
end;
$$;

create or replace function public.claim_rewarded_ad_by_telegram_v045(p_telegram_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile_id uuid;
  v_session_id uuid;
begin
  select id into v_profile_id from public.profiles
  where telegram_id=p_telegram_id and coalesce(is_system,false)=false limit 1;
  if v_profile_id is null then return jsonb_build_object('status','missing_profile'); end if;

  update public.rewarded_ad_sessions set status='expired'
  where profile_id=v_profile_id and status='created' and expires_at<=now();

  select id into v_session_id from public.rewarded_ad_sessions
  where profile_id=v_profile_id and provider='adsgram' and status='created' and expires_at>now()
  order by created_at desc limit 1;
  if v_session_id is null then return jsonb_build_object('status','no_open_session'); end if;

  return public.finalize_rewarded_ad_v045(v_session_id,'adsgram_server');
end;
$$;

-- Development/small-publisher fallback. The HTTP layer keeps this disabled unless explicitly opted in.
create or replace function public.claim_rewarded_ad_session_client_v045(p_profile_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_session public.rewarded_ad_sessions;
begin
  select * into v_session from public.rewarded_ad_sessions where id=p_session_id and profile_id=p_profile_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if v_session.created_at>now()-interval '5 seconds' then return jsonb_build_object('status','pending'); end if;
  update public.rewarded_ad_sessions set client_completed_at=coalesce(client_completed_at,now()) where id=p_session_id;
  return public.finalize_rewarded_ad_v045(p_session_id,'client_fallback');
end;
$$;

-- Missions are logged in the same economy ledger so the admin can see true emission.
create or replace function public.claim_mission(p_profile_id uuid,p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_um public.user_missions; v_mission public.missions; v_key text; v_balance numeric;
begin
  select * into v_mission from public.missions where id=p_mission_id and active=true;
  if not found then raise exception 'Задание недоступно'; end if;
  v_key:=public.mission_period_key(v_mission.period);
  select * into v_um from public.user_missions where profile_id=p_profile_id and mission_id=p_mission_id and period_key=v_key for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if v_um.claimed_at is not null then raise exception 'Награда уже получена'; end if;
  if v_um.progress<v_mission.target then raise exception 'Задание ещё не выполнено'; end if;
  update public.user_missions set claimed_at=now() where profile_id=p_profile_id and mission_id=p_mission_id and period_key=v_key;
  update public.profiles set balance=balance+v_mission.reward,updated_at=now() where id=p_profile_id returning balance into v_balance;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'mission',v_mission.reward,p_mission_id,jsonb_build_object('key',v_mission.key,'period',v_mission.period));
  return jsonb_build_object('reward',v_mission.reward,'balance',v_balance);
end;
$$;

-- Coin creation uses the same live settings as the admin economy console.
create or replace function public.create_coin_with_image(
  p_profile_id uuid,p_name text,p_symbol text,p_description text,p_image_url text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_coin public.coins;
  v_launch_fee numeric;
  v_cooldown integer;
  v_max_active integer;
  v_reserved numeric;
  v_active_count integer;
  v_last_launch timestamptz;
begin
  select coin_launch_fee,coin_launch_cooldown_hours,coin_max_active
  into v_launch_fee,v_cooldown,v_max_active
  from public.economy_settings where singleton=true;
  v_launch_fee:=coalesce(v_launch_fee,150);
  v_cooldown:=coalesce(v_cooldown,12);
  v_max_active:=coalesce(v_max_active,2);

  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Профиль не найден'; end if;
  if v_profile.is_banned and (v_profile.banned_until is null or v_profile.banned_until>now()) then raise exception 'Аккаунт заблокирован'; end if;

  select count(*)::integer,max(created_at) into v_active_count,v_last_launch
  from public.coins where creator_profile_id=p_profile_id and status='active';
  if v_active_count>=v_max_active then raise exception 'Достигнут лимит активных мемкоинов'; end if;
  if v_last_launch is not null and v_last_launch>now()-make_interval(hours=>v_cooldown) then raise exception 'Новый мемкоин пока на перезарядке'; end if;

  v_reserved:=public.pending_gift_offer_total(p_profile_id,null);
  if v_profile.balance-v_reserved<v_launch_fee then raise exception 'Недостаточно виртуальных TON для запуска'; end if;
  if char_length(trim(p_name))<2 or char_length(trim(p_name))>32 then raise exception 'Некорректное название'; end if;
  if upper(trim(p_symbol)) !~ '^[A-Z0-9]{2,8}$' then raise exception 'Некорректный тикер'; end if;
  if char_length(coalesce(p_description,''))>180 then raise exception 'Описание слишком длинное'; end if;

  update public.profiles set balance=balance-v_launch_fee,updated_at=now() where id=p_profile_id;
  insert into public.coins(creator_profile_id,name,symbol,description,image_url,status,hidden_from_market)
  values(p_profile_id,trim(p_name),upper(trim(p_symbol)),left(coalesce(trim(p_description),''),180),nullif(trim(coalesce(p_image_url,'')),''),'active',false)
  returning * into v_coin;
  insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
  values(v_coin.id,date_trunc('minute',now()),v_coin.current_price,v_coin.current_price,v_coin.current_price,v_coin.current_price,0);
  insert into public.market_events(actor_profile_id,kind,coin_id) values(p_profile_id,'launch',v_coin.id);
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'coin_launch',-v_launch_fee,v_coin.id,jsonb_build_object('symbol',v_coin.symbol));
  perform public.bump_mission(p_profile_id,'create_coin',1);

  return jsonb_build_object('id',v_coin.id,'name',v_coin.name,'symbol',v_coin.symbol,'imageUrl',v_coin.image_url,'launchFee',v_launch_fee,'status',v_coin.status);
exception when unique_violation then raise exception 'Такой тикер уже существует';
end;
$$;

create or replace function public.create_coin(p_profile_id uuid,p_name text,p_symbol text,p_description text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.create_coin_with_image(p_profile_id,p_name,p_symbol,p_description,null);
end;
$$;


-- Admin economy updates must keep the source-of-truth settings and marketplace fee in sync atomically.
create or replace function public.update_economy_settings_v045(
  p_rewarded_ad_reward numeric,
  p_rewarded_ad_daily_limit integer,
  p_rewarded_ad_cooldown_minutes integer,
  p_coin_launch_fee numeric,
  p_coin_launch_cooldown_hours integer,
  p_coin_max_active integer,
  p_gift_fee_bps integer
)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_rewarded_ad_reward is null or p_rewarded_ad_reward<1 or p_rewarded_ad_reward>500
    or p_rewarded_ad_daily_limit<0 or p_rewarded_ad_daily_limit>20
    or p_rewarded_ad_cooldown_minutes<0 or p_rewarded_ad_cooldown_minutes>1440
    or p_coin_launch_fee is null or p_coin_launch_fee<0 or p_coin_launch_fee>100000
    or p_coin_launch_cooldown_hours<1 or p_coin_launch_cooldown_hours>168
    or p_coin_max_active<1 or p_coin_max_active>20
    or p_gift_fee_bps<0 or p_gift_fee_bps>1000 then
    raise exception 'Некорректные параметры экономики';
  end if;

  update public.economy_settings set
    schema_version=45,
    rewarded_ad_reward=p_rewarded_ad_reward,
    rewarded_ad_daily_limit=p_rewarded_ad_daily_limit,
    rewarded_ad_cooldown_minutes=p_rewarded_ad_cooldown_minutes,
    coin_launch_fee=p_coin_launch_fee,
    coin_launch_cooldown_hours=p_coin_launch_cooldown_hours,
    coin_max_active=p_coin_max_active,
    gift_fee_bps=p_gift_fee_bps,
    updated_at=now()
  where singleton=true;

  if not found then raise exception 'Настройки экономики не найдены'; end if;

  update public.market_settings
  set gift_fee_bps=p_gift_fee_bps,updated_at=now()
  where singleton=true;
  if not found then raise exception 'Настройки рынка не найдены'; end if;

  return jsonb_build_object(
    'rewardedAdReward',p_rewarded_ad_reward,
    'rewardedAdDailyLimit',p_rewarded_ad_daily_limit,
    'rewardedAdCooldownMinutes',p_rewarded_ad_cooldown_minutes,
    'coinLaunchFee',p_coin_launch_fee,
    'coinLaunchCooldownHours',p_coin_launch_cooldown_hours,
    'coinMaxActive',p_coin_max_active,
    'giftFeeBps',p_gift_fee_bps
  );
end;
$$;

-- Remove the unreleased v0.44 RPCs if they exist, preventing an old forgeable claim path from surviving an upgrade.
drop function if exists public.rewarded_ad_status_v044(uuid);
drop function if exists public.create_rewarded_ad_session_v044(uuid,text);
drop function if exists public.claim_rewarded_ad_session_v044(uuid,uuid);

revoke execute on function public.rewarded_ad_status_v045(uuid) from public,anon,authenticated;
revoke execute on function public.create_rewarded_ad_session_v045(uuid,text) from public,anon,authenticated;
revoke execute on function public.finalize_rewarded_ad_v045(uuid,text) from public,anon,authenticated;
revoke execute on function public.claim_rewarded_ad_by_telegram_v045(bigint) from public,anon,authenticated;
revoke execute on function public.claim_rewarded_ad_session_client_v045(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.update_economy_settings_v045(numeric,integer,integer,numeric,integer,integer,integer) from public,anon,authenticated;
revoke execute on function public.claim_mission(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.create_coin_with_image(uuid,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.create_coin(uuid,text,text,text) from public,anon,authenticated;

grant execute on function public.rewarded_ad_status_v045(uuid) to service_role;
grant execute on function public.create_rewarded_ad_session_v045(uuid,text) to service_role;
grant execute on function public.finalize_rewarded_ad_v045(uuid,text) to service_role;
grant execute on function public.claim_rewarded_ad_by_telegram_v045(bigint) to service_role;
grant execute on function public.claim_rewarded_ad_session_client_v045(uuid,uuid) to service_role;
grant execute on function public.update_economy_settings_v045(numeric,integer,integer,numeric,integer,integer,integer) to service_role;
grant execute on function public.claim_mission(uuid,uuid) to service_role;
grant execute on function public.create_coin_with_image(uuid,text,text,text,text) to service_role;
grant execute on function public.create_coin(uuid,text,text,text) to service_role;

commit;
