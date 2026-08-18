begin;

-- MXM v0.5: strict Telegram Gift sync diagnostics + denser market data.

-- ---------------------------------------------------------------------------
-- 1. Telegram Gift source health / sync diagnostics.
-- ---------------------------------------------------------------------------

alter table public.gift_assets
  add column if not exists symbol_is_animated boolean not null default false,
  add column if not exists symbol_is_video boolean not null default false,
  add column if not exists is_burned boolean not null default false,
  add column if not exists telegram_payload jsonb not null default '{}'::jsonb,
  add column if not exists last_seen_at timestamptz not null default now();

create table if not exists public.gift_sync_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  telegram_id bigint not null,
  status text not null check (status in ('running','succeeded','failed')),
  pages_fetched integer not null default 0 check (pages_fetched >= 0),
  telegram_total_count integer check (telegram_total_count is null or telegram_total_count >= 0),
  unique_received integer not null default 0 check (unique_received >= 0),
  unique_imported integer not null default 0 check (unique_imported >= 0),
  assets_updated integer not null default 0 check (assets_updated >= 0),
  virtual_created integer not null default 0 check (virtual_created >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists gift_sync_runs_profile_started_idx on public.gift_sync_runs(profile_id, started_at desc);
create index if not exists gift_sync_runs_status_started_idx on public.gift_sync_runs(status, started_at desc);
create index if not exists gift_assets_active_collection_v05_idx on public.gift_assets(base_name, gift_number) where is_burned=false;
create index if not exists gift_offers_buyer_pending_v05_idx on public.gift_offers(buyer_profile_id, amount) where status='pending';
create index if not exists gift_offers_gift_pending_v05_idx on public.gift_offers(virtual_gift_id, amount desc) where status='pending';


-- Market offer changes are announced through the public-safe market_events stream.
-- gift_offers itself remains private and is never exposed through Realtime/RLS.
alter table public.market_events drop constraint if exists market_events_kind_check;
alter table public.market_events drop constraint if exists market_events_check;
alter table public.market_events drop constraint if exists market_events_entity_check_v05;
alter table public.market_events
  add constraint market_events_kind_check check (kind in ('launch','listing','offer')),
  add constraint market_events_entity_check_v05 check (
    (kind='launch' and coin_id is not null and virtual_gift_id is null)
    or (kind in ('listing','offer') and virtual_gift_id is not null and coin_id is null)
  );
alter table public.gift_sync_runs enable row level security;

-- Server-only diagnostics table. service_role bypasses RLS; no anon/authenticated policy is created.
revoke all on table public.gift_sync_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Gift candles: persist completed virtual sales at minute resolution.
-- ---------------------------------------------------------------------------

delete from public.gift_collection_candles;
insert into public.gift_collection_candles(base_name,bucket_start,open,high,low,close,volume)
select
  ga.base_name,
  date_trunc('minute', gt.created_at) as bucket_start,
  (array_agg(gt.price order by gt.created_at asc, gt.id asc))[1] as open,
  max(gt.price) as high,
  min(gt.price) as low,
  (array_agg(gt.price order by gt.created_at desc, gt.id desc))[1] as close,
  sum(gt.price) as volume
from public.gift_trades gt
join public.gift_assets ga on ga.id = gt.asset_id
group by ga.base_name, date_trunc('minute', gt.created_at);

create or replace function public.record_gift_collection_candle(p_base_name text, p_price numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_bucket timestamptz := date_trunc('minute', now());
begin
  if p_base_name is null or char_length(trim(p_base_name)) = 0 then raise exception 'Gift collection is required'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Gift sale price must be positive'; end if;
  insert into public.gift_collection_candles(base_name,bucket_start,open,high,low,close,volume)
  values (p_base_name,v_bucket,p_price,p_price,p_price,p_price,p_price)
  on conflict (base_name,bucket_start) do update set
    high = greatest(public.gift_collection_candles.high, excluded.high),
    low = least(public.gift_collection_candles.low, excluded.low),
    close = excluded.close,
    volume = public.gift_collection_candles.volume + excluded.volume;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Offers reserve virtual cash so one user cannot overcommit many offers.
-- ---------------------------------------------------------------------------

create or replace function public.pending_gift_offer_total(p_profile_id uuid, p_exclude_virtual_gift_id uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(go.amount),0)
  from public.gift_offers go
  where go.buyer_profile_id = p_profile_id
    and go.status = 'pending'
    and (p_exclude_virtual_gift_id is null or go.virtual_gift_id <> p_exclude_virtual_gift_id);
$$;

-- Spend operations also honor cash reserved by pending Gift offers.
create or replace function public.buy_coin(p_profile_id uuid, p_coin_id uuid, p_quote_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles; v_coin public.coins; v_fee_rate numeric := 0.005;
  v_quote_net numeric; v_k numeric; v_new_quote numeric; v_new_token numeric;
  v_token_out numeric; v_exec_price numeric; v_reserved numeric;
begin
  if p_quote_amount is null or p_quote_amount < 0.01 then raise exception 'Minimum buy is $0.01'; end if;
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  v_reserved := public.pending_gift_offer_total(p_profile_id, null);
  if v_profile.balance - v_reserved < p_quote_amount then raise exception 'Insufficient available balance'; end if;
  select * into v_coin from public.coins where id = p_coin_id and status = 'active' for update;
  if not found then raise exception 'Coin is not tradeable'; end if;

  v_quote_net := p_quote_amount * (1 - v_fee_rate);
  v_k := v_coin.token_reserve * v_coin.quote_reserve;
  v_new_quote := v_coin.quote_reserve + v_quote_net;
  v_new_token := v_k / v_new_quote;
  v_token_out := v_coin.token_reserve - v_new_token;
  if v_token_out <= 0 then raise exception 'Trade too small'; end if;
  v_exec_price := p_quote_amount / v_token_out;

  update public.profiles set balance = balance - p_quote_amount where id = p_profile_id;
  insert into public.holdings(profile_id, coin_id, quantity, cost_basis)
  values (p_profile_id, p_coin_id, v_token_out, p_quote_amount)
  on conflict (profile_id, coin_id) do update set
    quantity = public.holdings.quantity + excluded.quantity,
    cost_basis = public.holdings.cost_basis + excluded.cost_basis,
    updated_at = now();

  update public.coins set
    token_reserve = v_new_token,
    quote_reserve = v_new_quote,
    current_price = v_new_quote / v_new_token,
    market_cap = (v_new_quote / v_new_token) * total_supply,
    updated_at = now()
  where id = p_coin_id returning * into v_coin;

  insert into public.trades(profile_id, coin_id, side, quote_amount, token_amount, price, realized_pnl)
  values (p_profile_id, p_coin_id, 'buy', p_quote_amount, v_token_out, v_exec_price, 0);
  perform public.record_candle(p_coin_id, v_coin.current_price, p_quote_amount);
  perform public.bump_mission(p_profile_id, 'coin_trade', 1);
  return jsonb_build_object('side','buy','quoteAmount',p_quote_amount,'tokenAmount',v_token_out,'executionPrice',v_exec_price,'newPrice',v_coin.current_price);
end;
$$;

create or replace function public.create_coin(p_profile_id uuid, p_name text, p_symbol text, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles; v_coin public.coins; v_launch_fee numeric := 50; v_reserved numeric;
begin
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  v_reserved := public.pending_gift_offer_total(p_profile_id, null);
  if v_profile.balance - v_reserved < v_launch_fee then raise exception 'You need $50 available virtual cash to launch a coin'; end if;
  if char_length(trim(p_name)) < 2 or char_length(trim(p_name)) > 32 then raise exception 'Invalid coin name'; end if;
  if upper(trim(p_symbol)) !~ '^[A-Z0-9]{2,8}$' then raise exception 'Invalid ticker'; end if;
  update public.profiles set balance = balance - v_launch_fee where id = p_profile_id;
  insert into public.coins(creator_profile_id, name, symbol, description)
  values (p_profile_id, trim(p_name), upper(trim(p_symbol)), left(coalesce(trim(p_description),''),180))
  returning * into v_coin;
  insert into public.candles(coin_id,bucket_start,open,high,low,close,volume)
  values (v_coin.id,date_trunc('minute',now()),v_coin.current_price,v_coin.current_price,v_coin.current_price,v_coin.current_price,0);
  insert into public.market_events(actor_profile_id,kind,coin_id) values(p_profile_id,'launch',v_coin.id);
  perform public.bump_mission(p_profile_id, 'create_coin', 1);
  return jsonb_build_object('id',v_coin.id,'name',v_coin.name,'symbol',v_coin.symbol);
exception when unique_violation then raise exception 'Ticker already exists';
end;
$$;

create or replace function public.list_virtual_gift(p_profile_id uuid, p_virtual_gift_id uuid, p_price numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_gift public.virtual_gifts; v_asset public.gift_assets;
begin
  select * into v_gift from public.virtual_gifts where id = p_virtual_gift_id for update;
  if not found then raise exception 'Gift not found'; end if;
  if v_gift.owner_profile_id is distinct from p_profile_id then raise exception 'You do not own this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
  if not found then raise exception 'Gift asset is missing'; end if;
  if v_asset.is_burned then raise exception 'Telegram marks this Gift as burned'; end if;
  if p_price is null then
    update public.virtual_gifts set status='owned', listing_price=null where id=p_virtual_gift_id;
    return jsonb_build_object('status','owned');
  end if;
  if p_price < 0.01 or p_price > 1000000000 then raise exception 'Invalid listing price'; end if;
  update public.virtual_gifts set status='listed', listing_price=p_price where id=p_virtual_gift_id;
  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount) values(p_profile_id,'listing',p_virtual_gift_id,p_price);
  perform public.bump_mission(p_profile_id, 'gift_list', 1);
  return jsonb_build_object('status','listed','price',p_price);
end;
$$;

create or replace function public.create_gift_offer(p_buyer_id uuid, p_virtual_gift_id uuid, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_gift public.virtual_gifts; v_asset public.gift_assets; v_buyer public.profiles; v_offer public.gift_offers; v_reserved numeric;
begin
  if p_amount is null or p_amount < 0.01 or p_amount > 1000000000 then raise exception 'Invalid offer amount'; end if;
  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id for share;
  if not found then raise exception 'Gift not found'; end if;
  if v_gift.owner_profile_id = p_buyer_id then raise exception 'You already own this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
  if not found then raise exception 'Gift asset is missing'; end if;
  if v_asset.is_burned then raise exception 'Telegram marks this Gift as burned'; end if;
  select * into v_buyer from public.profiles where id=p_buyer_id for update;
  if not found then raise exception 'Buyer not found'; end if;
  v_reserved := public.pending_gift_offer_total(p_buyer_id, p_virtual_gift_id);
  if v_buyer.balance - v_reserved < p_amount then raise exception 'Insufficient available balance for this offer'; end if;
  insert into public.gift_offers(virtual_gift_id,buyer_profile_id,amount)
  values(p_virtual_gift_id,p_buyer_id,p_amount)
  on conflict (virtual_gift_id,buyer_profile_id) where status='pending'
  do update set amount=excluded.amount,updated_at=now()
  returning * into v_offer;
  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount)
  values(p_buyer_id,'offer',p_virtual_gift_id,v_offer.amount);
  perform public.bump_mission(p_buyer_id,'gift_offer',1);
  return jsonb_build_object('id',v_offer.id,'amount',v_offer.amount,'reservedTotal',v_reserved + v_offer.amount);
end;
$$;

create or replace function public.buy_virtual_gift(p_buyer_id uuid, p_virtual_gift_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_gift public.virtual_gifts; v_asset public.gift_assets; v_buyer public.profiles;
  v_price numeric; v_seller uuid; v_realized numeric; v_reserved numeric;
begin
  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id for update;
  if not found or v_gift.status <> 'listed' or v_gift.listing_price is null then raise exception 'Gift is not listed'; end if;
  v_price := v_gift.listing_price; v_seller := v_gift.owner_profile_id;
  if v_seller = p_buyer_id then raise exception 'You already own this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
  if not found then raise exception 'Gift asset is missing'; end if;
  if v_asset.is_burned then raise exception 'Telegram marks this Gift as burned'; end if;
  select * into v_buyer from public.profiles where id=p_buyer_id for update;
  if not found then raise exception 'Buyer not found'; end if;
  v_reserved := public.pending_gift_offer_total(p_buyer_id, p_virtual_gift_id);
  if v_buyer.balance - v_reserved < v_price then raise exception 'Insufficient available balance'; end if;
  perform 1 from public.profiles where id=v_seller for update;
  v_realized := v_price - v_gift.acquired_price;
  update public.profiles set balance=balance-v_price where id=p_buyer_id;
  update public.profiles set balance=balance+v_price where id=v_seller;
  update public.virtual_gifts set owner_profile_id=p_buyer_id, acquired_price=v_price, last_sale_price=v_price, listing_price=null, status='owned' where id=p_virtual_gift_id;
  update public.gift_offers set status='rejected' where virtual_gift_id=p_virtual_gift_id and status='pending';
  insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl)
  values(p_virtual_gift_id,v_gift.asset_id,p_buyer_id,v_seller,v_price,v_realized);
  perform public.record_gift_collection_candle(v_asset.base_name,v_price);
  perform public.bump_mission(p_buyer_id,'gift_buy',1);
  perform public.bump_mission(v_seller,'gift_sell',1);
  if v_realized > 0 then perform public.bump_mission(v_seller,'profitable_gift_sale',1); end if;
  return jsonb_build_object('price',v_price,'virtualGiftId',p_virtual_gift_id,'sellerRealizedPnl',v_realized);
end;
$$;

create or replace function public.resolve_gift_offer(p_owner_id uuid, p_offer_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer public.gift_offers; v_gift public.virtual_gifts; v_asset public.gift_assets;
  v_buyer public.profiles; v_realized numeric; v_reserved_other numeric;
begin
  if p_action not in ('accept','reject') then raise exception 'Invalid action'; end if;
  select * into v_offer from public.gift_offers where id=p_offer_id for update;
  if not found or v_offer.status <> 'pending' then raise exception 'Offer is no longer pending'; end if;
  select * into v_gift from public.virtual_gifts where id=v_offer.virtual_gift_id for update;
  if not found or v_gift.owner_profile_id is distinct from p_owner_id then raise exception 'You do not own this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
  if not found then raise exception 'Gift asset is missing'; end if;
  if v_asset.is_burned then raise exception 'Telegram marks this Gift as burned'; end if;
  if p_action='reject' then
    update public.gift_offers set status='rejected' where id=p_offer_id;
    insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount)
    values(p_owner_id,'offer',v_gift.id,null);
    return jsonb_build_object('status','rejected');
  end if;
  perform 1 from public.profiles where id=p_owner_id for update;
  select * into v_buyer from public.profiles where id=v_offer.buyer_profile_id for update;
  if not found then raise exception 'Buyer not found'; end if;
  v_reserved_other := public.pending_gift_offer_total(v_offer.buyer_profile_id, v_gift.id);
  if v_buyer.balance - v_reserved_other < v_offer.amount then raise exception 'Buyer no longer has enough available balance'; end if;
  v_realized := v_offer.amount - v_gift.acquired_price;
  update public.profiles set balance=balance-v_offer.amount where id=v_offer.buyer_profile_id;
  update public.profiles set balance=balance+v_offer.amount where id=p_owner_id;
  update public.virtual_gifts set owner_profile_id=v_offer.buyer_profile_id, acquired_price=v_offer.amount, last_sale_price=v_offer.amount, listing_price=null,status='owned' where id=v_gift.id;
  update public.gift_offers set status=case when id=p_offer_id then 'accepted' else 'rejected' end where virtual_gift_id=v_gift.id and status='pending';
  insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl)
  values(v_gift.id,v_gift.asset_id,v_offer.buyer_profile_id,p_owner_id,v_offer.amount,v_realized);
  perform public.record_gift_collection_candle(v_asset.base_name,v_offer.amount);
  perform public.bump_mission(v_offer.buyer_profile_id,'gift_buy',1);
  perform public.bump_mission(p_owner_id,'gift_sell',1);
  if v_realized > 0 then perform public.bump_mission(p_owner_id,'profitable_gift_sale',1); end if;
  return jsonb_build_object('status','accepted','price',v_offer.amount,'virtualGiftId',v_gift.id,'sellerRealizedPnl',v_realized);
end;
$$;

create or replace function public.cancel_gift_offer(p_buyer_id uuid, p_offer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_virtual_gift_id uuid;
begin
  update public.gift_offers
  set status='cancelled'
  where id=p_offer_id and buyer_profile_id=p_buyer_id and status='pending'
  returning virtual_gift_id into v_virtual_gift_id;
  if not found then raise exception 'Pending offer not found'; end if;
  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount)
  values(p_buyer_id,'offer',v_virtual_gift_id,null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rebuild market views with offer depth and separate PnL boards.
-- ---------------------------------------------------------------------------

drop view if exists public.leaderboard;
drop view if exists public.gift_collection_overview;
drop view if exists public.gift_market_overview;

create or replace view public.gift_market_overview with (security_invoker=true) as
select
  ga.id as asset_id,vg.id as virtual_gift_id,ga.telegram_name,ga.gift_id,ga.base_name,ga.gift_number,
  ga.model_name,ga.model_rarity_per_mille,ga.model_rarity,ga.model_file_id,ga.model_thumb_file_id,ga.model_is_animated,ga.model_is_video,
  ga.symbol_name,ga.symbol_rarity_per_mille,ga.symbol_file_id,ga.symbol_thumb_file_id,ga.symbol_is_animated,ga.symbol_is_video,
  ga.backdrop_name,ga.backdrop_rarity_per_mille,ga.backdrop_center_color,ga.backdrop_edge_color,ga.backdrop_symbol_color,ga.backdrop_text_color,
  ga.is_premium,ga.is_from_blockchain,ga.is_burned,ga.telegram_payload,ga.last_seen_at,
  vg.owner_profile_id,coalesce(nullif(op.username,''),op.first_name) as owner_name,vg.acquired_price,vg.listing_price,vg.last_sale_price,vg.status,vg.created_at,
  case when vals.value_count=0 then null else vals.value_sum/vals.value_count end as estimated_value,
  offers.best_offer,
  offers.offer_count
from public.gift_assets ga
join public.virtual_gifts vg on vg.asset_id=ga.id
join public.profiles op on op.id=vg.owner_profile_id
left join lateral (
  select
    (case when cf.v is null then 0 else cf.v end + case when mf.v is null then 0 else mf.v end + case when bf.v is null then 0 else bf.v end + case when sf.v is null then 0 else sf.v end + case when ls.v is null then 0 else ls.v end) as value_sum,
    ((cf.v is not null)::int + (mf.v is not null)::int + (bf.v is not null)::int + (sf.v is not null)::int + (ls.v is not null)::int) as value_count
  from
    lateral (select min(vg2.listing_price) v from public.virtual_gifts vg2 join public.gift_assets ga2 on ga2.id=vg2.asset_id where ga2.base_name=ga.base_name and ga2.is_burned=false and vg2.status='listed') cf,
    lateral (select min(vg2.listing_price) v from public.virtual_gifts vg2 join public.gift_assets ga2 on ga2.id=vg2.asset_id where ga2.base_name=ga.base_name and ga2.model_name=ga.model_name and ga2.is_burned=false and vg2.status='listed') mf,
    lateral (select min(vg2.listing_price) v from public.virtual_gifts vg2 join public.gift_assets ga2 on ga2.id=vg2.asset_id where ga2.base_name=ga.base_name and ga2.backdrop_name=ga.backdrop_name and ga2.is_burned=false and vg2.status='listed') bf,
    lateral (select min(vg2.listing_price) v from public.virtual_gifts vg2 join public.gift_assets ga2 on ga2.id=vg2.asset_id where ga2.base_name=ga.base_name and ga2.symbol_name=ga.symbol_name and ga2.is_burned=false and vg2.status='listed') sf,
    lateral (select gt.price v from public.gift_trades gt join public.gift_assets ga2 on ga2.id=gt.asset_id where ga2.base_name=ga.base_name order by gt.created_at desc,gt.id desc limit 1) ls
) vals on true
left join lateral (
  select max(go.amount) as best_offer, count(*)::bigint as offer_count
  from public.gift_offers go
  where go.virtual_gift_id=vg.id and go.status='pending'
) offers on true;

create or replace view public.gift_collection_overview with (security_invoker=true) as
select
  ga.base_name,
  count(*)::bigint as item_count,
  count(distinct vg.owner_profile_id)::bigint as holder_count,
  count(*) filter (where vg.status='listed')::bigint as listed_count,
  min(vg.listing_price) filter (where vg.status='listed') as floor_price,
  (select gt.price from public.gift_trades gt join public.gift_assets ga2 on ga2.id=gt.asset_id where ga2.base_name=ga.base_name order by gt.created_at desc,gt.id desc limit 1) as last_sale_price,
  coalesce((select sum(gt.price) from public.gift_trades gt join public.gift_assets ga2 on ga2.id=gt.asset_id where ga2.base_name=ga.base_name and gt.created_at>=now()-interval '24 hours'),0) as volume_24h,
  coalesce((select count(*) from public.gift_trades gt join public.gift_assets ga2 on ga2.id=gt.asset_id where ga2.base_name=ga.base_name and gt.created_at>=now()-interval '24 hours'),0) as trade_count_24h,
  coalesce((
    select case when first_c.open=0 then 0 else ((last_c.close/first_c.open)-1)*100 end
    from lateral (select gcc.open from public.gift_collection_candles gcc where gcc.base_name=ga.base_name and gcc.bucket_start>=now()-interval '24 hours' order by gcc.bucket_start asc limit 1) first_c,
         lateral (select gcc.close from public.gift_collection_candles gcc where gcc.base_name=ga.base_name and gcc.bucket_start>=now()-interval '24 hours' order by gcc.bucket_start desc limit 1) last_c
  ),0) as change_24h
from public.gift_assets ga
join public.virtual_gifts vg on vg.asset_id=ga.id
where ga.is_burned=false
group by ga.base_name;

create or replace view public.leaderboard with (security_invoker=true) as
select
  p.id,p.telegram_id,p.username,p.first_name,p.photo_url,p.balance,
  coalesce((select sum(h.quantity*c.current_price) from public.holdings h join public.coins c on c.id=h.coin_id where h.profile_id=p.id),0) as coin_value,
  coalesce((select sum(coalesce(gmo.estimated_value,0)) from public.gift_market_overview gmo where gmo.owner_profile_id=p.id and gmo.is_burned=false),0) as gift_value,
  p.balance
    + coalesce((select sum(h.quantity*c.current_price) from public.holdings h join public.coins c on c.id=h.coin_id where h.profile_id=p.id),0)
    + coalesce((select sum(coalesce(gmo.estimated_value,0)) from public.gift_market_overview gmo where gmo.owner_profile_id=p.id and gmo.is_burned=false),0) as net_worth,
  coalesce((select sum(t.realized_pnl) from public.trades t where t.profile_id=p.id),0) as coin_realized_pnl,
  coalesce((select sum(gt.realized_pnl) from public.gift_trades gt where gt.seller_profile_id=p.id),0) as gift_realized_pnl,
  coalesce((select sum(t.realized_pnl) from public.trades t where t.profile_id=p.id),0)
    + coalesce((select sum(gt.realized_pnl) from public.gift_trades gt where gt.seller_profile_id=p.id),0) as realized_pnl,
  coalesce((select count(*) from public.trades t where t.profile_id=p.id),0) as coin_trade_count,
  coalesce((select count(*) from public.gift_trades gt where gt.buyer_profile_id=p.id or gt.seller_profile_id=p.id),0) as gift_trade_count,
  coalesce((select count(*) from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id where vg.owner_profile_id=p.id and ga.is_burned=false),0) as gift_count,
  coalesce((select sum(c.market_cap) from public.coins c where c.creator_profile_id=p.id and c.status='active'),0) as created_coin_market_cap
from public.profiles p;

-- More event-driven missions. Existing progress is preserved by key.
insert into public.missions(key,period,title,description,reward,target,action_type,sort_order) values
  ('daily_gift_buy','daily','Collector fill','Complete one Gift purchase today.',8,1,'gift_buy',115),
  ('daily_gift_sell','daily','Close a listing','Sell one Gift today.',10,1,'gift_sell',125),
  ('weekly_offers','weekly','Price hunter','Place 8 Gift offers this week.',25,8,'gift_offer',215),
  ('weekly_listings','weekly','Market maker','Create 6 Gift listings this week.',25,6,'gift_list',225)
on conflict (key) do update set
  period=excluded.period,title=excluded.title,description=excluded.description,reward=excluded.reward,target=excluded.target,
  action_type=excluded.action_type,sort_order=excluded.sort_order,active=true;

revoke execute on function public.pending_gift_offer_total(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.record_gift_collection_candle(text,numeric) from public, anon, authenticated;
revoke execute on function public.buy_coin(uuid,uuid,numeric) from public, anon, authenticated;
revoke execute on function public.create_coin(uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.list_virtual_gift(uuid,uuid,numeric) from public, anon, authenticated;
revoke execute on function public.create_gift_offer(uuid,uuid,numeric) from public, anon, authenticated;
revoke execute on function public.buy_virtual_gift(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.resolve_gift_offer(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.cancel_gift_offer(uuid,uuid) from public, anon, authenticated;

grant execute on function public.pending_gift_offer_total(uuid,uuid) to service_role;
grant execute on function public.record_gift_collection_candle(text,numeric) to service_role;
grant execute on function public.buy_coin(uuid,uuid,numeric) to service_role;
grant execute on function public.create_coin(uuid,text,text,text) to service_role;
grant execute on function public.list_virtual_gift(uuid,uuid,numeric) to service_role;
grant execute on function public.create_gift_offer(uuid,uuid,numeric) to service_role;
grant execute on function public.buy_virtual_gift(uuid,uuid) to service_role;
grant execute on function public.resolve_gift_offer(uuid,uuid,text) to service_role;
grant execute on function public.cancel_gift_offer(uuid,uuid) to service_role;
grant select on public.gift_market_overview, public.gift_collection_overview, public.leaderboard to service_role;

commit;
