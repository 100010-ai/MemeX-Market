begin;

-- MXM v0.46 — Stars purchases, referrals and broader market economy.
-- All TON values below are internal MXM balance, never on-chain TON.

alter table public.economy_settings
  add column if not exists referral_bonus_bps integer not null default 500 check(referral_bonus_bps between 0 and 2000);
update public.economy_settings set
  schema_version=46,
  rewarded_ad_daily_limit=5,
  referral_bonus_bps=coalesce(referral_bonus_bps,500),
  updated_at=now()
where singleton=true;
alter table public.economy_settings alter column schema_version set default 46;
alter table public.economy_settings drop constraint if exists economy_settings_rewarded_ad_daily_limit_v046_check;
alter table public.economy_settings add constraint economy_settings_rewarded_ad_daily_limit_v046_check
  check(rewarded_ad_daily_limit between 0 and 5);

-- Expand economy ledger kinds without breaking existing history.
alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events add constraint economy_events_kind_check
  check(kind in ('rewarded_ad','coin_launch','coin_trade_fee','mission','admin','system','stars','referral'));

-- Referral graph. One account can have only one referrer and can never refer itself.
alter table public.profiles add column if not exists referrer_profile_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_v046_uidx on public.profiles(referral_code) where referral_code is not null;
create index if not exists profiles_referrer_v046_idx on public.profiles(referrer_profile_id) where referrer_profile_id is not null;

update public.profiles
set referral_code=lower(substr(md5(id::text||':mxm-v046'),1,10))
where referral_code is null;

create or replace function public.ensure_referral_code_v046()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.referral_code is null or length(trim(new.referral_code))<6 then
    new.referral_code:=lower(substr(md5(new.id::text||':'||coalesce(new.telegram_id::text,'')||':mxm-v046'),1,10));
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_referral_code_v046 on public.profiles;
create trigger profiles_referral_code_v046 before insert or update of referral_code on public.profiles
for each row execute function public.ensure_referral_code_v046();

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_profile_id uuid not null references public.profiles(id) on delete cascade,
  referred_profile_id uuid not null references public.profiles(id) on delete cascade,
  source_kind text not null check(source_kind in ('rewarded_ad','mission','stars')),
  source_amount numeric(24,8) not null check(source_amount>0),
  reward_amount numeric(24,8) not null check(reward_amount>0),
  reference_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists referral_rewards_referrer_created_v046_idx on public.referral_rewards(referrer_profile_id,created_at desc);
create unique index if not exists referral_rewards_once_v046_uidx
  on public.referral_rewards(referrer_profile_id,referred_profile_id,source_kind,reference_id)
  where reference_id is not null;
alter table public.referral_rewards enable row level security;
revoke all on public.referral_rewards from public,anon,authenticated;
grant all on public.referral_rewards to service_role;

create or replace function public.attach_referrer_v046(p_profile_id uuid,p_referral_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_referrer uuid; v_current uuid; v_created timestamptz;
begin
  if p_referral_code is null or p_referral_code !~ '^[a-zA-Z0-9_-]{6,32}$' then
    return jsonb_build_object('status','invalid');
  end if;
  select referrer_profile_id,created_at into v_current,v_created from public.profiles where id=p_profile_id for update;
  if not found then return jsonb_build_object('status','missing_profile'); end if;
  if v_current is not null then return jsonb_build_object('status','already_attached','referrerId',v_current); end if;
  -- Referral links are intentionally bound only during the first week of an account.
  if v_created < now()-interval '7 days' then return jsonb_build_object('status','too_late'); end if;
  select id into v_referrer from public.profiles
  where lower(referral_code)=lower(p_referral_code) and id<>p_profile_id and coalesce(is_system,false)=false
  limit 1;
  if v_referrer is null then return jsonb_build_object('status','not_found'); end if;
  update public.profiles set referrer_profile_id=v_referrer,updated_at=now() where id=p_profile_id;
  perform public.bump_mission(v_referrer,'referral_join',1);
  return jsonb_build_object('status','attached','referrerId',v_referrer);
end;
$$;

create or replace function public.credit_referral_bonus_v046(
  p_referred_profile_id uuid,
  p_source_kind text,
  p_source_amount numeric,
  p_reference_id uuid default null
)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_referrer uuid; v_bps integer; v_reward numeric;
begin
  if p_source_amount is null or p_source_amount<=0 or p_source_kind not in ('rewarded_ad','mission','stars') then return 0; end if;
  select referrer_profile_id into v_referrer from public.profiles where id=p_referred_profile_id;
  if v_referrer is null then return 0; end if;
  select referral_bonus_bps into v_bps from public.economy_settings where singleton=true;
  v_reward:=round(p_source_amount*coalesce(v_bps,500)/10000.0,8);
  if v_reward<=0 then return 0; end if;
  if p_reference_id is not null and exists(
    select 1 from public.referral_rewards
    where referrer_profile_id=v_referrer and referred_profile_id=p_referred_profile_id
      and source_kind=p_source_kind and reference_id=p_reference_id
  ) then return 0; end if;
  update public.profiles set balance=balance+v_reward,updated_at=now() where id=v_referrer;
  insert into public.referral_rewards(referrer_profile_id,referred_profile_id,source_kind,source_amount,reward_amount,reference_id)
  values(v_referrer,p_referred_profile_id,p_source_kind,p_source_amount,v_reward,p_reference_id)
  on conflict do nothing;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_referrer,'referral',v_reward,p_reference_id,jsonb_build_object('referredProfileId',p_referred_profile_id,'sourceKind',p_source_kind,'sourceAmount',p_source_amount));
  return v_reward;
end;
$$;

-- Re-define mission claim so referral rewards are paid only on true system emissions,
-- not on trade turnover (which would be farmable).
create or replace function public.claim_mission(p_profile_id uuid,p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_um public.user_missions; v_mission public.missions; v_key text; v_balance numeric; v_ref numeric;
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
  v_ref:=public.credit_referral_bonus_v046(p_profile_id,'mission',v_mission.reward,p_mission_id);
  return jsonb_build_object('reward',v_mission.reward,'balance',v_balance,'referralReward',v_ref);
end;
$$;

-- Re-define rewarded-ad finalizer: 5/day from economy_settings + referral bonus.
create or replace function public.finalize_rewarded_ad_v045(p_session_id uuid,p_verification_source text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_session public.rewarded_ad_sessions; v_settings public.economy_settings;
  v_claimed integer:=0; v_last_claim timestamptz; v_balance numeric; v_ref numeric;
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
  select count(*)::integer,max(claimed_at) into v_claimed,v_last_claim from public.rewarded_ad_sessions
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
  update public.rewarded_ad_sessions set status='claimed',claimed_at=now(),verified_at=now(),verification_source=p_verification_source,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verification',p_verification_source) where id=p_session_id;
  update public.profiles set balance=balance+v_session.reward,updated_at=now() where id=v_session.profile_id returning balance into v_balance;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_session.profile_id,'rewarded_ad',v_session.reward,p_session_id,jsonb_build_object('provider',v_session.provider,'verification',p_verification_source));
  v_ref:=public.credit_referral_bonus_v046(v_session.profile_id,'rewarded_ad',v_session.reward,p_session_id);
  return jsonb_build_object('status','claimed','reward',v_session.reward,'balance',v_balance,'alreadyClaimed',false,'referralReward',v_ref);
end;
$$;


-- Complete filter dictionaries come from the full listed market, not just the first 24 cards.
create or replace function public.gift_market_filter_options_v046()
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'collections',coalesce((select jsonb_agg(x order by x) from (select distinct base_name as x from public.gift_market_overview where base_name is not null and status='listed' and listing_price is not null and (listing_expires_at is null or listing_expires_at>now())) q),'[]'::jsonb),
    'models',coalesce((select jsonb_agg(x order by x) from (select distinct model_name as x from public.gift_market_overview where model_name is not null and status='listed' and listing_price is not null and (listing_expires_at is null or listing_expires_at>now())) q),'[]'::jsonb),
    'backdrops',coalesce((select jsonb_agg(x order by x) from (select distinct backdrop_name as x from public.gift_market_overview where backdrop_name is not null and status='listed' and listing_price is not null and (listing_expires_at is null or listing_expires_at>now())) q),'[]'::jsonb),
    'symbols',coalesce((select jsonb_agg(x order by x) from (select distinct symbol_name as x from public.gift_market_overview where symbol_name is not null and status='listed' and listing_price is not null and (listing_expires_at is null or listing_expires_at>now())) q),'[]'::jsonb)
  );
$$;
revoke execute on function public.gift_market_filter_options_v046() from public,anon,authenticated;
grant execute on function public.gift_market_filter_options_v046() to service_role;

-- Telegram Stars purchases. Client can create invoices but only Telegram webhook can finalize one.
create table if not exists public.star_purchases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  stars integer not null check(stars between 1 and 100000),
  ton_reward numeric(24,8) not null check(ton_reward>0),
  status text not null default 'pending' check(status in ('pending','paid','cancelled','expired')),
  invoice_payload text not null unique,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists star_purchases_profile_created_v046_idx on public.star_purchases(profile_id,created_at desc);
alter table public.star_purchases enable row level security;
revoke all on public.star_purchases from public,anon,authenticated;
grant all on public.star_purchases to service_role;

create or replace function public.finalize_star_purchase_v046(
  p_purchase_id uuid,p_charge_id text,p_stars integer
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_purchase public.star_purchases; v_balance numeric; v_ref numeric;
begin
  select * into v_purchase from public.star_purchases where id=p_purchase_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if v_purchase.status='paid' then return jsonb_build_object('status','paid','reward',v_purchase.ton_reward,'alreadyPaid',true); end if;
  if v_purchase.status<>'pending' then return jsonb_build_object('status',v_purchase.status); end if;
  if p_stars<>v_purchase.stars then raise exception 'Star amount mismatch'; end if;
  if p_charge_id is null or length(trim(p_charge_id))<4 then raise exception 'Payment charge id missing'; end if;
  update public.star_purchases set status='paid',telegram_payment_charge_id=p_charge_id,paid_at=now(),updated_at=now() where id=p_purchase_id;
  update public.profiles set balance=balance+v_purchase.ton_reward,updated_at=now() where id=v_purchase.profile_id returning balance into v_balance;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_purchase.profile_id,'stars',v_purchase.ton_reward,v_purchase.id,jsonb_build_object('stars',v_purchase.stars,'chargeId',p_charge_id));
  v_ref:=public.credit_referral_bonus_v046(v_purchase.profile_id,'stars',v_purchase.ton_reward,v_purchase.id);
  return jsonb_build_object('status','paid','reward',v_purchase.ton_reward,'balance',v_balance,'referralReward',v_ref,'alreadyPaid',false);
end;
$$;

-- Referrals are earned from reward emissions only. This prevents self-farming by circular trades.
insert into public.missions(key,period,title,description,reward,target,action_type,sort_order,active)
values('invite_friend','weekly','Пригласить друга','Пригласи нового игрока по своей ссылке.',15,1,'referral_join',240,true)
on conflict(key) do update set title=excluded.title,description=excluded.description,reward=excluded.reward,target=excluded.target,action_type=excluded.action_type,sort_order=excluded.sort_order,active=true;

revoke execute on function public.attach_referrer_v046(uuid,text) from public,anon,authenticated;
revoke execute on function public.credit_referral_bonus_v046(uuid,text,numeric,uuid) from public,anon,authenticated;
revoke execute on function public.finalize_star_purchase_v046(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.attach_referrer_v046(uuid,text) to service_role;
grant execute on function public.credit_referral_bonus_v046(uuid,text,numeric,uuid) to service_role;
grant execute on function public.finalize_star_purchase_v046(uuid,text,integer) to service_role;

commit;
