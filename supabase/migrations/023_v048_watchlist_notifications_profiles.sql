begin;

-- MXM v0.48 — watchlist 2.0, price alerts, notifications, reputation,
-- achievements and portfolio history foundation.
-- TON values remain internal MXM balances; nothing in this migration is on-chain.

-- ---------------------------------------------------------------------------
-- Watchlist 2.0: individual Gifts in addition to coins and collections.
-- ---------------------------------------------------------------------------
alter table public.user_watchlist add column if not exists virtual_gift_id uuid references public.virtual_gifts(id) on delete cascade;
alter table public.user_watchlist drop constraint if exists user_watchlist_kind_check;
alter table public.user_watchlist drop constraint if exists user_watchlist_check;
alter table public.user_watchlist add constraint user_watchlist_kind_check check (kind in ('coin','gift_collection','gift'));
alter table public.user_watchlist add constraint user_watchlist_shape_v048_check check (
  (kind='coin' and coin_id is not null and gift_collection is null and virtual_gift_id is null)
  or (kind='gift_collection' and coin_id is null and gift_collection is not null and char_length(trim(gift_collection))>0 and virtual_gift_id is null)
  or (kind='gift' and coin_id is null and gift_collection is null and virtual_gift_id is not null)
);
create unique index if not exists user_watchlist_gift_v048_uidx on public.user_watchlist(profile_id, virtual_gift_id) where kind='gift';

-- ---------------------------------------------------------------------------
-- Price alerts. A row is re-armed after the target moves away from the trigger.
-- ---------------------------------------------------------------------------
create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('coin','gift','gift_collection')),
  coin_id uuid references public.coins(id) on delete cascade,
  virtual_gift_id uuid references public.virtual_gifts(id) on delete cascade,
  gift_collection text,
  direction text not null check(direction in ('below','above')),
  target_price numeric(24,8) not null check(target_price>0),
  enabled boolean not null default true,
  last_triggered_at timestamptz,
  is_triggered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (kind='coin' and coin_id is not null and virtual_gift_id is null and gift_collection is null)
    or (kind='gift' and coin_id is null and virtual_gift_id is not null and gift_collection is null)
    or (kind='gift_collection' and coin_id is null and virtual_gift_id is null and gift_collection is not null and char_length(trim(gift_collection))>0)
  )
);
create index if not exists price_alerts_profile_v048_idx on public.price_alerts(profile_id, created_at desc);
create index if not exists price_alerts_active_v048_idx on public.price_alerts(kind, enabled) where enabled=true;
alter table public.price_alerts enable row level security;
revoke all on public.price_alerts from public,anon,authenticated;
grant all on public.price_alerts to service_role;

-- ---------------------------------------------------------------------------
-- Notification center + per-user preferences.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  gift_sold boolean not null default true,
  gift_offer boolean not null default true,
  offer_resolved boolean not null default true,
  price_alert boolean not null default true,
  coin_move boolean not null default false,
  sponsored_task boolean not null default true,
  referral_reward boolean not null default true,
  promo boolean not null default true,
  telegram_push boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('gift_sold','gift_offer','offer_resolved','price_alert','coin_move','sponsored_task','referral_reward','promo','system')),
  title text not null,
  body text not null default '',
  href text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  telegram_sent_at timestamptz,
  telegram_error text,
  created_at timestamptz not null default now()
);
create index if not exists user_notifications_profile_v048_idx on public.user_notifications(profile_id, created_at desc);
create index if not exists user_notifications_unread_v048_idx on public.user_notifications(profile_id, created_at desc) where read_at is null;
alter table public.notification_preferences enable row level security;
alter table public.user_notifications enable row level security;
revoke all on public.notification_preferences from public,anon,authenticated;
revoke all on public.user_notifications from public,anon,authenticated;
grant all on public.notification_preferences to service_role;
grant all on public.user_notifications to service_role;

insert into public.notification_preferences(profile_id)
select id from public.profiles
on conflict(profile_id) do nothing;

create or replace function public.ensure_notification_preferences_v048()
returns trigger language plpgsql set search_path=public as $$
begin
  insert into public.notification_preferences(profile_id) values(new.id) on conflict(profile_id) do nothing;
  return new;
end;
$$;
drop trigger if exists profiles_notification_preferences_v048 on public.profiles;
create trigger profiles_notification_preferences_v048 after insert on public.profiles
for each row execute function public.ensure_notification_preferences_v048();

create or replace function public.push_notification_v048(
  p_profile_id uuid,
  p_kind text,
  p_title text,
  p_body text default '',
  p_href text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_enabled boolean:=true;
begin
  if p_profile_id is null then return null; end if;
  select case p_kind
    when 'gift_sold' then gift_sold
    when 'gift_offer' then gift_offer
    when 'offer_resolved' then offer_resolved
    when 'price_alert' then price_alert
    when 'coin_move' then coin_move
    when 'sponsored_task' then sponsored_task
    when 'referral_reward' then referral_reward
    when 'promo' then promo
    else true end
  into v_enabled from public.notification_preferences where profile_id=p_profile_id;
  if v_enabled is false then return null; end if;
  insert into public.user_notifications(profile_id,kind,title,body,href,metadata)
  values(p_profile_id,p_kind,p_title,coalesce(p_body,''),p_href,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return v_id;
end;
$$;

-- Notify sellers when an offer is placed.
create or replace function public.notify_gift_offer_v048()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_owner uuid; v_name text; v_number bigint;
begin
  if new.status<>'pending' then return new; end if;
  select vg.owner_profile_id,ga.base_name,ga.gift_number into v_owner,v_name,v_number
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id where vg.id=new.virtual_gift_id;
  if v_owner is not null and v_owner<>new.buyer_profile_id then
    perform public.push_notification_v048(v_owner,'gift_offer','Новый оффер',
      format('%s #%s · %s TON',coalesce(v_name,'Gift'),coalesce(v_number,0),trim(to_char(new.amount,'FM9999999990.00'))),
      '/gifts/'||new.virtual_gift_id::text,jsonb_build_object('offerId',new.id,'amount',new.amount));
  end if;
  return new;
end;
$$;
drop trigger if exists gift_offers_notify_v048 on public.gift_offers;
create trigger gift_offers_notify_v048 after insert on public.gift_offers
for each row execute function public.notify_gift_offer_v048();

-- Notify buyer/seller after a completed Gift trade.
create or replace function public.notify_gift_trade_v048()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_name text; v_number bigint;
begin
  select ga.base_name,ga.gift_number into v_name,v_number
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id where vg.id=new.virtual_gift_id;
  if new.seller_profile_id is not null then
    perform public.push_notification_v048(new.seller_profile_id,'gift_sold','Gift продан',
      format('%s #%s · %s TON',coalesce(v_name,'Gift'),coalesce(v_number,0),trim(to_char(new.price,'FM9999999990.00'))),
      '/gifts/'||new.virtual_gift_id::text,jsonb_build_object('tradeId',new.id,'price',new.price));
  end if;
  if new.buyer_profile_id is not null then
    perform public.push_notification_v048(new.buyer_profile_id,'system','Покупка завершена',
      format('%s #%s теперь в вашем портфеле',coalesce(v_name,'Gift'),coalesce(v_number,0)),
      '/gifts/'||new.virtual_gift_id::text,jsonb_build_object('tradeId',new.id,'price',new.price));
  end if;
  return new;
end;
$$;
drop trigger if exists gift_trades_notify_v048 on public.gift_trades;
create trigger gift_trades_notify_v048 after insert on public.gift_trades
for each row execute function public.notify_gift_trade_v048();

create or replace function public.notify_offer_resolved_v048()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_name text; v_number bigint;
begin
  if old.status='pending' and new.status in ('accepted','rejected','cancelled') and new.status<>old.status then
    select ga.base_name,ga.gift_number into v_name,v_number
    from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id where vg.id=new.virtual_gift_id;
    if new.buyer_profile_id is not null then
      perform public.push_notification_v048(new.buyer_profile_id,'offer_resolved',
        case new.status when 'accepted' then 'Оффер принят' when 'rejected' then 'Оффер отклонён' else 'Оффер отменён' end,
        format('%s #%s · %s TON',coalesce(v_name,'Gift'),coalesce(v_number,0),trim(to_char(new.amount,'FM9999999990.00'))),
        '/gifts/'||new.virtual_gift_id::text,jsonb_build_object('offerId',new.id,'status',new.status,'amount',new.amount));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists gift_offers_resolved_notify_v048 on public.gift_offers;
create trigger gift_offers_resolved_notify_v048 after update of status on public.gift_offers
for each row execute function public.notify_offer_resolved_v048();

-- Referral income notification.
create or replace function public.notify_referral_reward_v048()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.push_notification_v048(new.referrer_profile_id,'referral_reward','Доход от реферала',
    format('+%s TON',trim(to_char(new.reward_amount,'FM9999999990.00'))),'/referrals',
    jsonb_build_object('rewardId',new.id,'sourceKind',new.source_kind,'amount',new.reward_amount));
  return new;
end;
$$;
drop trigger if exists referral_rewards_notify_v048 on public.referral_rewards;
create trigger referral_rewards_notify_v048 after insert on public.referral_rewards
for each row execute function public.notify_referral_reward_v048();

create or replace function public.notify_sponsored_claim_v048()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_title text;
begin
  if new.status='claimed' and (tg_op='INSERT' or old.status is distinct from new.status) then
    select title into v_title from public.sponsored_campaigns where id=new.campaign_id;
    perform public.push_notification_v048(new.profile_id,'sponsored_task','Задание одобрено',coalesce(v_title,'Рекламное задание'),'/tasks',jsonb_build_object('campaignId',new.campaign_id));
  end if;
  return new;
end;
$$;
drop trigger if exists sponsored_claims_notify_v048 on public.sponsored_task_claims;
create trigger sponsored_claims_notify_v048 after insert or update of status on public.sponsored_task_claims
for each row execute function public.notify_sponsored_claim_v048();

create or replace function public.notify_promo_redeemed_v048()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_code text;
begin
  select code into v_code from public.promo_codes where id=new.promo_code_id;
  perform public.push_notification_v048(new.profile_id,'promo','Промокод активирован',coalesce(v_code,'Промокод')||' · +'||trim(to_char(new.reward,'FM9999999990.00'))||' TON','/profile',jsonb_build_object('promoCodeId',new.promo_code_id,'reward',new.reward));
  return new;
end;
$$;
drop trigger if exists promo_redemptions_notify_v048 on public.promo_code_redemptions;
create trigger promo_redemptions_notify_v048 after insert on public.promo_code_redemptions
for each row execute function public.notify_promo_redeemed_v048();

-- ---------------------------------------------------------------------------
-- Achievements + reputation.
-- ---------------------------------------------------------------------------
create table if not exists public.achievements (
  key text primary key,
  title text not null,
  description text not null,
  icon text not null default 'award',
  xp_reward integer not null default 0 check(xp_reward>=0),
  sort_order integer not null default 100,
  active boolean not null default true
);
create table if not exists public.user_achievements (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null references public.achievements(key) on delete cascade,
  unlocked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key(profile_id,achievement_key)
);
create table if not exists public.profile_reputation (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  score integer not null default 50 check(score between 0 and 100),
  trade_score integer not null default 0,
  age_score integer not null default 0,
  activity_score integer not null default 0,
  trust_score integer not null default 50,
  updated_at timestamptz not null default now()
);
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.profile_reputation enable row level security;
revoke all on public.achievements from public,anon,authenticated;
revoke all on public.user_achievements from public,anon,authenticated;
revoke all on public.profile_reputation from public,anon,authenticated;
grant all on public.achievements to service_role;
grant all on public.user_achievements to service_role;
grant all on public.profile_reputation to service_role;

insert into public.achievements(key,title,description,icon,xp_reward,sort_order) values
  ('first_trade','Первая сделка','Совершить первую покупку или продажу.','handshake',15,10),
  ('ten_sales','10 продаж','Продать 10 Gifts или мемкоинов.','receipt',35,20),
  ('volume_10k','Объём 10K','Наторговать на 10 000 TON.','chart',75,30),
  ('collector_10','Коллекционер','Собрать 10 Gifts.','gem',40,40),
  ('early_user','Early User','Аккаунт создан до запуска v0.50.','sparkles',25,50),
  ('coin_creator','Создатель','Запустить собственный мемкоин.','rocket',30,60)
on conflict(key) do update set title=excluded.title,description=excluded.description,icon=excluded.icon,xp_reward=excluded.xp_reward,sort_order=excluded.sort_order;

insert into public.profile_reputation(profile_id)
select id from public.profiles on conflict(profile_id) do nothing;

create or replace function public.refresh_profile_meta_v048(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_created timestamptz; v_coin_trades integer:=0; v_gift_trades integer:=0; v_sales integer:=0;
  v_gifts integer:=0; v_volume numeric:=0; v_coins integer:=0; v_age integer:=0; v_trade integer:=0; v_activity integer:=0; v_score integer:=50;
  v_key text; v_xp integer;
begin
  select created_at into v_created from public.profiles where id=p_profile_id;
  if v_created is null then raise exception 'Profile not found'; end if;
  select count(*)::integer,coalesce(sum(quote_amount),0) into v_coin_trades,v_volume from public.trades where profile_id=p_profile_id;
  select count(*)::integer into v_gift_trades from public.gift_trades where buyer_profile_id=p_profile_id or seller_profile_id=p_profile_id;
  select count(*)::integer into v_sales from public.gift_trades where seller_profile_id=p_profile_id;
  select count(*)::integer into v_gifts from public.virtual_gifts where owner_profile_id=p_profile_id;
  select count(*)::integer into v_coins from public.coins where creator_profile_id=p_profile_id;
  select v_volume + coalesce(sum(price),0) into v_volume from public.gift_trades where buyer_profile_id=p_profile_id or seller_profile_id=p_profile_id;
  v_age:=least(20,greatest(0,floor(extract(epoch from (now()-v_created))/86400/15)::integer));
  v_trade:=least(45,(v_coin_trades+v_gift_trades)*2);
  v_activity:=least(20,(v_gifts+v_coins*3));
  v_score:=least(100,greatest(0,35+v_age+v_trade+v_activity));
  insert into public.profile_reputation(profile_id,score,trade_score,age_score,activity_score,trust_score,updated_at)
  values(p_profile_id,v_score,v_trade,v_age,v_activity,50,now())
  on conflict(profile_id) do update set score=excluded.score,trade_score=excluded.trade_score,age_score=excluded.age_score,activity_score=excluded.activity_score,updated_at=now();

  for v_key in select key from public.achievements where active=true and (
    (key='first_trade' and v_coin_trades+v_gift_trades>=1) or
    (key='ten_sales' and v_sales>=10) or
    (key='volume_10k' and v_volume>=10000) or
    (key='collector_10' and v_gifts>=10) or
    (key='early_user' and v_created<'2026-09-01'::timestamptz) or
    (key='coin_creator' and v_coins>=1)
  ) loop
    if not exists(select 1 from public.user_achievements where profile_id=p_profile_id and achievement_key=v_key) then
      insert into public.user_achievements(profile_id,achievement_key) values(p_profile_id,v_key) on conflict do nothing;
      select xp_reward into v_xp from public.achievements where key=v_key;
      if coalesce(v_xp,0)>0 then perform public.award_profile_xp(p_profile_id,'achievement:'||v_key,v_xp); end if;
    end if;
  end loop;
  return jsonb_build_object('score',v_score,'tradeScore',v_trade,'ageScore',v_age,'activityScore',v_activity);
end;
$$;

-- ---------------------------------------------------------------------------
-- Portfolio history. API writes one snapshot per hour with an idempotent key.
-- ---------------------------------------------------------------------------
create table if not exists public.portfolio_snapshots (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  bucket_start timestamptz not null,
  balance numeric(24,8) not null default 0,
  coin_value numeric(24,8) not null default 0,
  gift_value numeric(24,8) not null default 0,
  net_worth numeric(24,8) not null default 0,
  realized_pnl numeric(24,8) not null default 0,
  primary key(profile_id,bucket_start)
);
create index if not exists portfolio_snapshots_profile_v048_idx on public.portfolio_snapshots(profile_id,bucket_start desc);
alter table public.portfolio_snapshots enable row level security;
revoke all on public.portfolio_snapshots from public,anon,authenticated;
grant all on public.portfolio_snapshots to service_role;

-- Explicit grants for functions; all app calls go through service_role.
revoke execute on function public.push_notification_v048(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.refresh_profile_meta_v048(uuid) from public,anon,authenticated;
grant execute on function public.push_notification_v048(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.refresh_profile_meta_v048(uuid) to service_role;

grant select,insert,delete on public.user_watchlist to service_role;

commit;
