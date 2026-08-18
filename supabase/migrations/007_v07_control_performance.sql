begin;

-- MXM v0.7 — performance, security, local control panel and coin media.
-- Additive migration. No market data is seeded or fabricated.

alter table public.profiles add column if not exists is_system boolean not null default false;
alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists hidden_from_leaderboard boolean not null default false;
create index if not exists profiles_ban_idx on public.profiles(is_banned, banned_until);
create index if not exists profiles_leaderboard_visibility_idx on public.profiles(hidden_from_leaderboard, is_system);

alter table public.coins add column if not exists image_url text;
alter table public.coins add column if not exists hidden_from_market boolean not null default false;
create index if not exists coins_market_status_idx on public.coins(status, hidden_from_market, created_at desc);
create index if not exists virtual_gifts_listing_scan_v07_idx on public.virtual_gifts(status, listing_price) where status='listed';
create index if not exists gift_assets_collection_model_v07_idx on public.gift_assets(base_name,model_name) where is_burned=false;
create index if not exists gift_assets_collection_backdrop_v07_idx on public.gift_assets(base_name,backdrop_name) where is_burned=false;
create index if not exists gift_assets_collection_symbol_v07_idx on public.gift_assets(base_name,symbol_name) where is_burned=false;

alter table public.missions add column if not exists updated_at timestamptz not null default now();
drop trigger if exists missions_touch_updated on public.missions;
create trigger missions_touch_updated before update on public.missions for each row execute function public.touch_updated_at();

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target_type text,
  target_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit_log(created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select, insert on public.admin_audit_log to service_role;

create table if not exists public.api_rate_limits (
  key text primary key,
  hits integer not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  v_hits integer;
  v_started timestamptz;
begin
  if p_key is null or char_length(p_key) < 8 then raise exception 'Invalid rate-limit key'; end if;
  if p_limit < 1 or p_window_seconds < 1 then raise exception 'Invalid rate-limit configuration'; end if;

  insert into public.api_rate_limits(key,hits,window_started_at,updated_at)
  values (p_key,1,now(),now())
  on conflict (key) do update set
    hits = case
      when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else public.api_rate_limits.hits + 1
    end,
    window_started_at = case
      when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else public.api_rate_limits.window_started_at
    end,
    updated_at = now()
  returning hits,window_started_at into v_hits,v_started;

  return v_hits <= p_limit;
end;
$$;
revoke execute on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;

-- Private financial view used by authenticated profile screens. It deliberately
-- contains hidden leaderboard users so hiding yourself never breaks the app.
create or replace view public.profile_financial_overview with (security_invoker=true) as
with holding_value as (
  select h.profile_id,coalesce(sum(h.quantity*c.current_price),0) as coin_value
  from public.holdings h join public.coins c on c.id=h.coin_id
  where h.quantity>0 group by h.profile_id
), gift_value as (
  select owner_profile_id,coalesce(sum(coalesce(estimated_value,0)),0) as gift_value
  from public.gift_market_overview where is_burned=false group by owner_profile_id
), coin_stats as (
  select profile_id,coalesce(sum(realized_pnl),0) as coin_realized_pnl,count(*)::bigint as coin_trade_count
  from public.trades group by profile_id
), gift_sell_stats as (
  select seller_profile_id as profile_id,coalesce(sum(realized_pnl),0) as gift_realized_pnl
  from public.gift_trades where seller_profile_id is not null group by seller_profile_id
), gift_trade_people as (
  select buyer_profile_id as profile_id from public.gift_trades
  union all
  select seller_profile_id from public.gift_trades where seller_profile_id is not null
), gift_trade_stats as (
  select profile_id,count(*)::bigint as gift_trade_count from gift_trade_people group by profile_id
), gift_counts as (
  select vg.owner_profile_id as profile_id,count(*)::bigint as gift_count
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false group by vg.owner_profile_id
), creator_caps as (
  select creator_profile_id as profile_id,coalesce(sum(market_cap),0) as created_coin_market_cap
  from public.coins where creator_profile_id is not null and status='active' group by creator_profile_id
)
select
  p.id,p.telegram_id,p.username,p.first_name,p.photo_url,p.balance,
  coalesce(h.coin_value,0) as coin_value,
  coalesce(g.gift_value,0) as gift_value,
  p.balance+coalesce(h.coin_value,0)+coalesce(g.gift_value,0) as net_worth,
  coalesce(cs.coin_realized_pnl,0) as coin_realized_pnl,
  coalesce(gs.gift_realized_pnl,0) as gift_realized_pnl,
  coalesce(cs.coin_realized_pnl,0)+coalesce(gs.gift_realized_pnl,0) as realized_pnl,
  coalesce(cs.coin_trade_count,0) as coin_trade_count,
  coalesce(gt.gift_trade_count,0) as gift_trade_count,
  coalesce(gc.gift_count,0) as gift_count,
  coalesce(cc.created_coin_market_cap,0) as created_coin_market_cap
from public.profiles p
left join holding_value h on h.profile_id=p.id
left join gift_value g on g.owner_profile_id=p.id
left join coin_stats cs on cs.profile_id=p.id
left join gift_sell_stats gs on gs.profile_id=p.id
left join gift_trade_stats gt on gt.profile_id=p.id
left join gift_counts gc on gc.profile_id=p.id
left join creator_caps cc on cc.profile_id=p.id;
grant select on public.profile_financial_overview to service_role;

-- Public leaderboard honours moderation visibility and ban state.
create or replace view public.leaderboard with (security_invoker=true) as
select
  f.id,f.telegram_id,f.username,f.first_name,f.photo_url,f.balance,
  f.coin_value,f.gift_value,f.net_worth,f.coin_realized_pnl,f.gift_realized_pnl,
  f.realized_pnl,f.coin_trade_count,f.gift_trade_count,f.gift_count,f.created_coin_market_cap
from public.profile_financial_overview f
join public.profiles p on p.id=f.id
where p.is_system=false
  and p.hidden_from_leaderboard=false
  and not (p.is_banned=true and (p.banned_until is null or p.banned_until > now()));
grant select on public.leaderboard to service_role;

-- Keep the existing market overview contract and append image_url. Hidden coins
-- are omitted from public market queries without deleting their historical data.
create or replace view public.market_overview with (security_invoker=true) as
with trade_stats as (
  select
    coin_id,
    coalesce(sum(quote_amount),0) as all_time_volume,
    coalesce(sum(quote_amount) filter (where created_at>=now()-interval '24 hours'),0) as volume_24h,
    coalesce(sum(quote_amount) filter (where side='buy' and created_at>=now()-interval '24 hours'),0) as buy_volume_24h,
    coalesce(sum(quote_amount) filter (where side='sell' and created_at>=now()-interval '24 hours'),0) as sell_volume_24h,
    count(*) filter (where created_at>=now()-interval '24 hours')::bigint as trade_count_24h
  from public.trades
  group by coin_id
), holding_stats as (
  select coin_id,count(*) filter (where quantity>0)::bigint as holder_count
  from public.holdings
  group by coin_id
), candle_stats as (
  select coin_id,max(high) as ath_price
  from public.candles
  group by coin_id
), first_24 as (
  select distinct on (coin_id) coin_id,open
  from public.candles
  where bucket_start>=now()-interval '24 hours'
  order by coin_id,bucket_start asc
)
select
  c.id,c.creator_profile_id,c.name,c.symbol,c.description,c.current_price,c.market_cap,c.status,c.created_at,
  coalesce(ts.volume_24h,0) as volume_24h,
  case when f.open is null or f.open=0 then 0 else ((c.current_price/f.open)-1)*100 end as change_24h,
  coalesce(hs.holder_count,0) as holder_count,
  coalesce(ts.trade_count_24h,0) as trade_count_24h,
  coalesce(nullif(p.username,''),p.first_name) as creator_name,
  c.quote_reserve * 2 as liquidity,
  coalesce(ts.all_time_volume,0) as all_time_volume,
  coalesce(cs.ath_price,c.current_price) as ath_price,
  coalesce(ts.buy_volume_24h,0) as buy_volume_24h,
  coalesce(ts.sell_volume_24h,0) as sell_volume_24h,
  c.image_url
from public.coins c
left join public.profiles p on p.id=c.creator_profile_id
left join trade_stats ts on ts.coin_id=c.id
left join holding_stats hs on hs.coin_id=c.id
left join candle_stats cs on cs.coin_id=c.id
left join first_24 f on f.coin_id=c.id
where c.hidden_from_market=false;
grant select on public.market_overview to service_role;

-- Replace Gift valuation lateral scans with grouped floor/offer aggregates.
create or replace view public.gift_market_overview with (security_invoker=true) as
with collection_floor as (
  select ga.base_name,min(vg.listing_price) as v
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false and vg.status='listed'
  group by ga.base_name
), model_floor as (
  select ga.base_name,ga.model_name,min(vg.listing_price) as v
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false and vg.status='listed'
  group by ga.base_name,ga.model_name
), backdrop_floor as (
  select ga.base_name,ga.backdrop_name,min(vg.listing_price) as v
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false and vg.status='listed'
  group by ga.base_name,ga.backdrop_name
), symbol_floor as (
  select ga.base_name,ga.symbol_name,min(vg.listing_price) as v
  from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false and vg.status='listed'
  group by ga.base_name,ga.symbol_name
), last_sale as (
  select distinct on (ga.base_name) ga.base_name,gt.price as v
  from public.gift_trades gt join public.gift_assets ga on ga.id=gt.asset_id
  order by ga.base_name,gt.created_at desc,gt.id desc
), offer_stats as (
  select virtual_gift_id,max(amount) as best_offer,count(*)::bigint as offer_count
  from public.gift_offers where status='pending' group by virtual_gift_id
)
select
  ga.id as asset_id,vg.id as virtual_gift_id,ga.telegram_name,ga.gift_id,ga.base_name,ga.gift_number,
  ga.model_name,ga.model_rarity_per_mille,ga.model_rarity,ga.model_file_id,ga.model_thumb_file_id,ga.model_is_animated,ga.model_is_video,
  ga.symbol_name,ga.symbol_rarity_per_mille,ga.symbol_file_id,ga.symbol_thumb_file_id,ga.symbol_is_animated,ga.symbol_is_video,
  ga.backdrop_name,ga.backdrop_rarity_per_mille,ga.backdrop_center_color,ga.backdrop_edge_color,ga.backdrop_symbol_color,ga.backdrop_text_color,
  ga.is_premium,ga.is_from_blockchain,ga.is_burned,ga.telegram_payload,ga.last_seen_at,
  vg.owner_profile_id,coalesce(nullif(op.username,''),op.first_name) as owner_name,vg.acquired_price,vg.listing_price,vg.last_sale_price,vg.status,vg.created_at,
  case
    when ((cf.v is not null)::int+(mf.v is not null)::int+(bf.v is not null)::int+(sf.v is not null)::int+(ls.v is not null)::int)=0 then null
    else (coalesce(cf.v,0)+coalesce(mf.v,0)+coalesce(bf.v,0)+coalesce(sf.v,0)+coalesce(ls.v,0)) /
         ((cf.v is not null)::int+(mf.v is not null)::int+(bf.v is not null)::int+(sf.v is not null)::int+(ls.v is not null)::int)
  end as estimated_value,
  os.best_offer,
  coalesce(os.offer_count,0)::bigint as offer_count
from public.gift_assets ga
join public.virtual_gifts vg on vg.asset_id=ga.id
join public.profiles op on op.id=vg.owner_profile_id
left join collection_floor cf on cf.base_name=ga.base_name
left join model_floor mf on mf.base_name=ga.base_name and mf.model_name=ga.model_name
left join backdrop_floor bf on bf.base_name=ga.base_name and bf.backdrop_name=ga.backdrop_name
left join symbol_floor sf on sf.base_name=ga.base_name and sf.symbol_name=ga.symbol_name
left join last_sale ls on ls.base_name=ga.base_name
left join offer_stats os on os.virtual_gift_id=vg.id;
grant select on public.gift_market_overview to service_role;

-- Replace the old per-collection correlated subqueries with grouped scans.
create or replace view public.gift_collection_overview with (security_invoker=true) as
with collection_base as (
  select ga.base_name,
         count(*)::bigint as item_count,
         count(distinct vg.owner_profile_id)::bigint as holder_count,
         count(*) filter (where vg.status='listed')::bigint as listed_count,
         min(vg.listing_price) filter (where vg.status='listed') as floor_price
  from public.gift_assets ga
  join public.virtual_gifts vg on vg.asset_id=ga.id
  where ga.is_burned=false
  group by ga.base_name
), trade_24 as (
  select ga.base_name,
         coalesce(sum(gt.price) filter (where gt.created_at>=now()-interval '24 hours'),0) as volume_24h,
         count(*) filter (where gt.created_at>=now()-interval '24 hours')::bigint as trade_count_24h
  from public.gift_trades gt
  join public.gift_assets ga on ga.id=gt.asset_id
  group by ga.base_name
), last_sale as (
  select distinct on (ga.base_name) ga.base_name,gt.price as last_sale_price
  from public.gift_trades gt
  join public.gift_assets ga on ga.id=gt.asset_id
  order by ga.base_name,gt.created_at desc,gt.id desc
), first_candle as (
  select distinct on (base_name) base_name,open
  from public.gift_collection_candles
  where bucket_start>=now()-interval '24 hours'
  order by base_name,bucket_start asc
), last_candle as (
  select distinct on (base_name) base_name,close
  from public.gift_collection_candles
  where bucket_start>=now()-interval '24 hours'
  order by base_name,bucket_start desc
)
select b.base_name,b.item_count,b.holder_count,b.listed_count,b.floor_price,
       ls.last_sale_price,
       coalesce(t.volume_24h,0) as volume_24h,
       coalesce(t.trade_count_24h,0) as trade_count_24h,
       case when fc.open is null or fc.open=0 or lc.close is null then 0 else ((lc.close/fc.open)-1)*100 end as change_24h
from collection_base b
left join trade_24 t on t.base_name=b.base_name
left join last_sale ls on ls.base_name=b.base_name
left join first_candle fc on fc.base_name=b.base_name
left join last_candle lc on lc.base_name=b.base_name;
grant select on public.gift_collection_overview to service_role;

create or replace function public.create_coin_with_image(
  p_profile_id uuid,
  p_name text,
  p_symbol text,
  p_description text,
  p_image_url text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_coin public.coins;
  v_launch_fee numeric := 50;
  v_reserved numeric;
begin
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_banned and (v_profile.banned_until is null or v_profile.banned_until > now()) then raise exception 'Account is banned'; end if;
  v_reserved := public.pending_gift_offer_total(p_profile_id,null);
  if v_profile.balance-v_reserved < v_launch_fee then raise exception 'You need $50 available virtual cash to launch a coin'; end if;
  if char_length(trim(p_name)) < 2 or char_length(trim(p_name)) > 32 then raise exception 'Invalid coin name'; end if;
  if upper(trim(p_symbol)) !~ '^[A-Z0-9]{2,8}$' then raise exception 'Invalid ticker'; end if;
  if char_length(coalesce(p_description,'')) > 180 then raise exception 'Description is too long'; end if;

  update public.profiles set balance=balance-v_launch_fee where id=p_profile_id;
  insert into public.coins(creator_profile_id,name,symbol,description,image_url)
  values (p_profile_id,trim(p_name),upper(trim(p_symbol)),left(coalesce(trim(p_description),''),180),nullif(trim(coalesce(p_image_url,'')),''))
  returning * into v_coin;

  insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
  values(v_coin.id,date_trunc('minute',now()),v_coin.current_price,v_coin.current_price,v_coin.current_price,v_coin.current_price,0);
  insert into public.market_events(actor_profile_id,kind,coin_id) values(p_profile_id,'launch',v_coin.id);
  perform public.bump_mission(p_profile_id,'create_coin',1);
  return jsonb_build_object('id',v_coin.id,'name',v_coin.name,'symbol',v_coin.symbol,'imageUrl',v_coin.image_url);
exception when unique_violation then raise exception 'Ticker already exists';
end;
$$;
revoke execute on function public.create_coin_with_image(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_coin_with_image(uuid,text,text,text,text) to service_role;

create or replace function public.admin_adjust_balance(p_profile_id uuid,p_delta numeric,p_actor text,p_reason text)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_balance numeric;
begin
  if p_delta is null or abs(p_delta) > 1000000000000 then raise exception 'Invalid balance delta'; end if;
  update public.profiles
  set balance=balance+p_delta,updated_at=now()
  where id=p_profile_id and balance+p_delta>=0
  returning balance into v_balance;
  if v_balance is null then raise exception 'Profile not found or resulting balance is negative'; end if;
  insert into public.admin_audit_log(actor,action,target_type,target_id,payload)
  values(p_actor,'balance.adjust','profile',p_profile_id::text,jsonb_build_object('delta',p_delta,'balance',v_balance,'reason',coalesce(p_reason,'')));
  return v_balance;
end;
$$;
revoke execute on function public.admin_adjust_balance(uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.admin_adjust_balance(uuid,numeric,text,text) to service_role;

create or replace function public.admin_create_coin(
  p_creator_profile_id uuid,
  p_name text,
  p_symbol text,
  p_description text,
  p_image_url text,
  p_actor text
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_coin public.coins;
begin
  if char_length(trim(p_name)) < 2 or char_length(trim(p_name)) > 32 then raise exception 'Invalid coin name'; end if;
  if upper(trim(p_symbol)) !~ '^[A-Z0-9]{2,8}$' then raise exception 'Invalid ticker'; end if;
  if p_creator_profile_id is not null and not exists(select 1 from public.profiles where id=p_creator_profile_id) then raise exception 'Creator profile not found'; end if;
  insert into public.coins(creator_profile_id,name,symbol,description,image_url)
  values(p_creator_profile_id,trim(p_name),upper(trim(p_symbol)),left(coalesce(trim(p_description),''),180),nullif(trim(coalesce(p_image_url,'')),''))
  returning * into v_coin;
  insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
  values(v_coin.id,date_trunc('minute',now()),v_coin.current_price,v_coin.current_price,v_coin.current_price,v_coin.current_price,0);
  if p_creator_profile_id is not null then
    insert into public.market_events(actor_profile_id,kind,coin_id) values(p_creator_profile_id,'launch',v_coin.id);
  end if;
  insert into public.admin_audit_log(actor,action,target_type,target_id,payload)
  values(p_actor,'coin.create','coin',v_coin.id::text,jsonb_build_object('name',v_coin.name,'symbol',v_coin.symbol,'creatorProfileId',p_creator_profile_id));
  return v_coin.id;
exception when unique_violation then raise exception 'Ticker already exists';
end;
$$;
revoke execute on function public.admin_create_coin(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_create_coin(uuid,text,text,text,text,text) to service_role;


create or replace function public.is_known_gift_file(p_file_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.gift_assets
    where model_file_id=p_file_id
       or model_thumb_file_id=p_file_id
       or symbol_file_id=p_file_id
       or symbol_thumb_file_id=p_file_id
  );
$$;
revoke execute on function public.is_known_gift_file(text) from public,anon,authenticated;
grant execute on function public.is_known_gift_file(text) to service_role;

-- Transactional local-control transfer. Keeps offer/listing state consistent and
-- writes the audit record inside the same database transaction.
create or replace function public.admin_transfer_virtual_gift(
  p_virtual_gift_id uuid,
  p_owner_profile_id uuid,
  p_actor text
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_gift public.virtual_gifts;
begin
  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id for update;
  if not found then raise exception 'Gift not found'; end if;
  if not exists(select 1 from public.profiles where id=p_owner_profile_id) then raise exception 'Owner profile not found'; end if;

  update public.gift_offers
     set status='rejected', updated_at=now()
   where virtual_gift_id=p_virtual_gift_id and status='pending';

  update public.virtual_gifts
     set owner_profile_id=p_owner_profile_id,
         status='owned',
         listing_price=null,
         acquired_price=0,
         updated_at=now()
   where id=p_virtual_gift_id;


  insert into public.admin_audit_log(actor,action,target_type,target_id,payload)
  values(p_actor,'gift.transfer','virtual_gift',p_virtual_gift_id::text,jsonb_build_object('ownerProfileId',p_owner_profile_id));
end;
$$;
revoke execute on function public.admin_transfer_virtual_gift(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_transfer_virtual_gift(uuid,uuid,text) to service_role;

-- Storage bucket for user-selected memecoin images. Writes are server-only;
-- public read keeps market avatars fast and CDN-cacheable.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $q$
      insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('coin-media','coin-media',true,2097152,array['image/png','image/jpeg','image/webp'])
      on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/png','image/jpeg','image/webp']
    $q$;
  end if;
end $$;

-- Russian missions. Personal Telegram Gift sync is no longer part of the main
-- gameplay loop, so the old sync mission is disabled instead of being faked.
update public.missions set active=false,updated_at=now() where key='sync_gifts';
update public.missions set title='Добро пожаловать',description='Открой MXM в Telegram.',updated_at=now() where key='open_app';
update public.missions set title='Первая сделка',description='Соверши первую сделку с мемкоином.',updated_at=now() where key='first_coin_trade';
update public.missions set title='Первая покупка подарка',description='Купи первый виртуальный Telegram Gift на рынке MXM.',updated_at=now() where key='first_gift_buy';
update public.missions set title='Три сделки за день',description='Соверши 3 сделки с мемкоинами сегодня.',updated_at=now() where key='daily_trades';
update public.missions set title='Сделай оффер',description='Предложи цену за виртуальный Telegram Gift.',updated_at=now() where key='daily_offer';
update public.missions set title='Выставь подарок',description='Выставь один виртуальный Telegram Gift на продажу.',updated_at=now() where key='daily_listing';
update public.missions set title='Закрой сделку в плюс',description='Зафиксируй прибыль по мемкоину.',updated_at=now() where key='daily_profit';
update public.missions set title='Постоянный трейдер',description='Соверши 20 сделок с мемкоинами за неделю.',updated_at=now() where key='weekly_market';
update public.missions set title='Коллекционер',description='Купи 4 виртуальных Telegram Gifts за неделю.',updated_at=now() where key='weekly_collector';
update public.missions set title='Создатель мемов',description='Запусти один мемкоин за неделю.',updated_at=now() where key='weekly_creator';
update public.missions set title='Флиппер подарков',description='Продай 2 подарка дороже цены покупки.',updated_at=now() where key='weekly_flip';
update public.missions set title='Покупка дня',description='Купи один виртуальный Telegram Gift сегодня.',updated_at=now() where key='daily_gift_buy';
update public.missions set title='Продажа дня',description='Продай один виртуальный Telegram Gift сегодня.',updated_at=now() where key='daily_gift_sell';
update public.missions set title='Охотник за ценой',description='Сделай 8 офферов за неделю.',updated_at=now() where key='weekly_offers';
update public.missions set title='Маркет-мейкер',description='Создай 6 лотов с подарками за неделю.',updated_at=now() where key='weekly_listings';

commit;
