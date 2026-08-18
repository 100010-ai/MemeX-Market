begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null,
  last_name text,
  photo_url text,
  balance numeric(24,8) not null default 100 check (balance >= 0),
  last_gift_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coins (
  id uuid primary key default gen_random_uuid(),
  creator_profile_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 32),
  symbol text not null unique check (symbol ~ '^[A-Z0-9]{2,8}$'),
  description text not null default '' check (char_length(description) <= 180),
  total_supply numeric(30,8) not null default 1000000000,
  token_reserve numeric(30,8) not null default 1000000000 check (token_reserve > 0),
  quote_reserve numeric(24,8) not null default 100 check (quote_reserve > 0),
  current_price numeric(30,16) not null default 0.0000001 check (current_price > 0),
  market_cap numeric(30,8) not null default 100 check (market_cap >= 0),
  status text not null default 'active' check (status in ('active','dead','graduated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.holdings (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  coin_id uuid not null references public.coins(id) on delete cascade,
  quantity numeric(30,8) not null default 0 check (quantity >= 0),
  cost_basis numeric(24,8) not null default 0 check (cost_basis >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, coin_id)
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  coin_id uuid not null references public.coins(id) on delete cascade,
  side text not null check (side in ('buy','sell')),
  quote_amount numeric(24,8) not null check (quote_amount > 0),
  token_amount numeric(30,8) not null check (token_amount > 0),
  price numeric(30,16) not null check (price > 0),
  realized_pnl numeric(24,8) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists trades_coin_created_idx on public.trades(coin_id, created_at desc);
create index if not exists trades_profile_created_idx on public.trades(profile_id, created_at desc);

create table if not exists public.candles (
  coin_id uuid not null references public.coins(id) on delete cascade,
  bucket_start timestamptz not null,
  open numeric(30,16) not null,
  high numeric(30,16) not null,
  low numeric(30,16) not null,
  close numeric(30,16) not null,
  volume numeric(24,8) not null default 0,
  primary key (coin_id, bucket_start)
);
create index if not exists candles_coin_bucket_idx on public.candles(coin_id, bucket_start desc);

create table if not exists public.gift_assets (
  id uuid primary key default gen_random_uuid(),
  telegram_name text not null unique,
  gift_id text,
  base_name text not null,
  gift_number integer not null check (gift_number > 0),
  model_name text not null,
  model_rarity_per_mille integer not null check (model_rarity_per_mille >= 0),
  model_rarity text,
  model_file_id text not null,
  model_thumb_file_id text,
  model_is_animated boolean not null default false,
  model_is_video boolean not null default false,
  symbol_name text not null,
  symbol_rarity_per_mille integer not null check (symbol_rarity_per_mille >= 0),
  symbol_file_id text not null,
  symbol_thumb_file_id text,
  backdrop_name text not null,
  backdrop_rarity_per_mille integer not null check (backdrop_rarity_per_mille >= 0),
  backdrop_center_color integer not null check (backdrop_center_color between 0 and 16777215),
  backdrop_edge_color integer not null check (backdrop_edge_color between 0 and 16777215),
  backdrop_symbol_color integer not null check (backdrop_symbol_color between 0 and 16777215),
  backdrop_text_color integer not null check (backdrop_text_color between 0 and 16777215),
  is_premium boolean not null default false,
  is_from_blockchain boolean not null default false,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (base_name, gift_number)
);
create index if not exists gift_assets_collection_idx on public.gift_assets(base_name, gift_number);
create index if not exists gift_assets_traits_idx on public.gift_assets(base_name, model_name, backdrop_name, symbol_name);

create table if not exists public.virtual_gifts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.gift_assets(id) on delete cascade,
  source_owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  acquired_price numeric(24,8) not null default 0 check (acquired_price >= 0),
  listing_price numeric(24,8) check (listing_price is null or listing_price > 0),
  last_sale_price numeric(24,8) check (last_sale_price is null or last_sale_price > 0),
  status text not null default 'owned' check (status in ('owned','listed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'listed' and listing_price is not null) or (status = 'owned' and listing_price is null))
);
create index if not exists virtual_gifts_market_idx on public.virtual_gifts(status, listing_price);
create index if not exists virtual_gifts_owner_idx on public.virtual_gifts(owner_profile_id, status);

create table if not exists public.gift_trades (
  id uuid primary key default gen_random_uuid(),
  virtual_gift_id uuid not null references public.virtual_gifts(id) on delete cascade,
  asset_id uuid not null references public.gift_assets(id) on delete cascade,
  buyer_profile_id uuid not null references public.profiles(id) on delete cascade,
  seller_profile_id uuid references public.profiles(id) on delete set null,
  price numeric(24,8) not null check (price > 0),
  realized_pnl numeric(24,8) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists gift_trades_asset_created_idx on public.gift_trades(asset_id, created_at desc);
create index if not exists gift_trades_virtual_created_idx on public.gift_trades(virtual_gift_id, created_at desc);
create index if not exists gift_trades_buyer_created_idx on public.gift_trades(buyer_profile_id, created_at desc);
create index if not exists gift_trades_seller_created_idx on public.gift_trades(seller_profile_id, created_at desc);

create table if not exists public.gift_offers (
  id uuid primary key default gen_random_uuid(),
  virtual_gift_id uuid not null references public.virtual_gifts(id) on delete cascade,
  buyer_profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(24,8) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists gift_offers_one_pending_idx on public.gift_offers(virtual_gift_id, buyer_profile_id) where status = 'pending';
create index if not exists gift_offers_gift_created_idx on public.gift_offers(virtual_gift_id, created_at desc);

create table if not exists public.gift_collection_candles (
  base_name text not null,
  bucket_start timestamptz not null,
  open numeric(24,8) not null,
  high numeric(24,8) not null,
  low numeric(24,8) not null,
  close numeric(24,8) not null,
  volume numeric(24,8) not null default 0,
  primary key (base_name, bucket_start)
);

create table if not exists public.market_events (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('launch','listing')),
  coin_id uuid references public.coins(id) on delete cascade,
  virtual_gift_id uuid references public.virtual_gifts(id) on delete cascade,
  amount numeric(24,8),
  created_at timestamptz not null default now(),
  check ((kind='launch' and coin_id is not null and virtual_gift_id is null) or (kind='listing' and virtual_gift_id is not null and coin_id is null))
);
create index if not exists market_events_created_idx on public.market_events(created_at desc);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  period text not null default 'onboarding' check (period in ('onboarding','daily','weekly')),
  title text not null,
  description text not null,
  reward numeric(18,8) not null check (reward >= 0),
  target integer not null check (target > 0),
  action_type text not null,
  sort_order integer not null default 100,
  active boolean not null default true
);

create table if not exists public.user_missions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  period_key text not null,
  progress integer not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, mission_id, period_key)
);

alter table public.profiles enable row level security;
alter table public.coins enable row level security;
alter table public.holdings enable row level security;
alter table public.trades enable row level security;
alter table public.candles enable row level security;
alter table public.gift_assets enable row level security;
alter table public.virtual_gifts enable row level security;
alter table public.gift_trades enable row level security;
alter table public.gift_offers enable row level security;
alter table public.gift_collection_candles enable row level security;
alter table public.market_events enable row level security;
alter table public.missions enable row level security;
alter table public.user_missions enable row level security;

-- Realtime clients may observe only public market mutation tables. All writes still go through authenticated Next.js routes.
drop policy if exists "public coin realtime" on public.coins;
create policy "public coin realtime" on public.coins for select to anon, authenticated using (true);
drop policy if exists "public trade realtime" on public.trades;
create policy "public trade realtime" on public.trades for select to anon, authenticated using (true);
drop policy if exists "public gift realtime" on public.virtual_gifts;
create policy "public gift realtime" on public.virtual_gifts for select to anon, authenticated using (true);
drop policy if exists "public gift trade realtime" on public.gift_trades;
create policy "public gift trade realtime" on public.gift_trades for select to anon, authenticated using (true);
drop policy if exists "public event realtime" on public.market_events;
create policy "public event realtime" on public.market_events for select to anon, authenticated using (true);

grant select on public.coins, public.trades, public.virtual_gifts, public.gift_trades, public.market_events to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='coins') then alter publication supabase_realtime add table public.coins; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trades') then alter publication supabase_realtime add table public.trades; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='virtual_gifts') then alter publication supabase_realtime add table public.virtual_gifts; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gift_trades') then alter publication supabase_realtime add table public.gift_trades; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='market_events') then alter publication supabase_realtime add table public.market_events; end if;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace trigger profiles_touch_updated before update on public.profiles for each row execute function public.touch_updated_at();
create or replace trigger coins_touch_updated before update on public.coins for each row execute function public.touch_updated_at();
create or replace trigger holdings_touch_updated before update on public.holdings for each row execute function public.touch_updated_at();
create or replace trigger gift_assets_touch_updated before update on public.gift_assets for each row execute function public.touch_updated_at();
create or replace trigger virtual_gifts_touch_updated before update on public.virtual_gifts for each row execute function public.touch_updated_at();
create or replace trigger gift_offers_touch_updated before update on public.gift_offers for each row execute function public.touch_updated_at();
create or replace trigger user_missions_touch_updated before update on public.user_missions for each row execute function public.touch_updated_at();

create or replace function public.mission_period_key(p_period text)
returns text language sql stable as $$
  select case p_period
    when 'daily' then to_char(current_date, 'YYYY-MM-DD')
    when 'weekly' then to_char(current_date, 'IYYY-"W"IW')
    else 'once'
  end;
$$;

create or replace function public.ensure_user_missions(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_missions(profile_id, mission_id, period_key, progress)
  select p_profile_id, m.id, public.mission_period_key(m.period), 0
  from public.missions m
  where m.active = true
  on conflict (profile_id, mission_id, period_key) do nothing;
end;
$$;

create or replace function public.bump_mission(p_profile_id uuid, p_action_type text, p_amount integer default 1)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_user_missions(p_profile_id);
  update public.user_missions um
  set progress = least(m.target, um.progress + greatest(0, p_amount)), updated_at = now()
  from public.missions m
  where um.profile_id = p_profile_id
    and um.mission_id = m.id
    and um.period_key = public.mission_period_key(m.period)
    and m.active = true
    and m.action_type = p_action_type
    and um.claimed_at is null;
end;
$$;

create or replace function public.sync_telegram_profile(
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_photo_url text
)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles;
begin
  if p_first_name is null or char_length(trim(p_first_name)) = 0 then raise exception 'Telegram first_name is required'; end if;
  insert into public.profiles(telegram_id, username, first_name, last_name, photo_url)
  values (p_telegram_id, nullif(p_username,''), trim(p_first_name), nullif(p_last_name,''), nullif(p_photo_url,''))
  on conflict (telegram_id) do update set
    username = excluded.username,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    photo_url = excluded.photo_url,
    updated_at = now()
  returning * into v_profile;
  perform public.ensure_user_missions(v_profile.id);
  perform public.bump_mission(v_profile.id, 'open_app', 1);
  return v_profile;
end;
$$;

create or replace function public.record_candle(p_coin_id uuid, p_price numeric, p_volume numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_bucket timestamptz := date_trunc('minute', now());
begin
  insert into public.candles(coin_id, bucket_start, open, high, low, close, volume)
  values (p_coin_id, v_bucket, p_price, p_price, p_price, p_price, p_volume)
  on conflict (coin_id, bucket_start) do update set
    high = greatest(public.candles.high, excluded.high),
    low = least(public.candles.low, excluded.low),
    close = excluded.close,
    volume = public.candles.volume + excluded.volume;
end;
$$;

create or replace function public.buy_coin(p_profile_id uuid, p_coin_id uuid, p_quote_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles; v_coin public.coins; v_fee_rate numeric := 0.005;
  v_quote_net numeric; v_k numeric; v_new_quote numeric; v_new_token numeric;
  v_token_out numeric; v_exec_price numeric;
begin
  if p_quote_amount is null or p_quote_amount < 0.01 then raise exception 'Minimum buy is $0.01'; end if;
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.balance < p_quote_amount then raise exception 'Insufficient balance'; end if;
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

create or replace function public.sell_coin(p_profile_id uuid, p_coin_id uuid, p_token_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_coin public.coins; v_holding public.holdings; v_fee_rate numeric := 0.005;
  v_k numeric; v_new_token numeric; v_new_quote numeric; v_quote_gross numeric;
  v_quote_out numeric; v_exec_price numeric; v_cost_reduction numeric; v_realized numeric;
begin
  if p_token_amount is null or p_token_amount <= 0 then raise exception 'Invalid sell amount'; end if;
  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into v_holding from public.holdings where profile_id = p_profile_id and coin_id = p_coin_id for update;
  if not found or v_holding.quantity < p_token_amount then raise exception 'Insufficient token balance'; end if;
  select * into v_coin from public.coins where id = p_coin_id and status = 'active' for update;
  if not found then raise exception 'Coin is not tradeable'; end if;

  v_k := v_coin.token_reserve * v_coin.quote_reserve;
  v_new_token := v_coin.token_reserve + p_token_amount;
  v_new_quote := v_k / v_new_token;
  v_quote_gross := v_coin.quote_reserve - v_new_quote;
  v_quote_out := v_quote_gross * (1 - v_fee_rate);
  if v_quote_out < 0.000001 then raise exception 'Trade too small'; end if;
  v_exec_price := v_quote_out / p_token_amount;
  v_cost_reduction := v_holding.cost_basis * (p_token_amount / v_holding.quantity);
  v_realized := v_quote_out - v_cost_reduction;

  update public.profiles set balance = balance + v_quote_out where id = p_profile_id;
  update public.holdings set
    quantity = greatest(0, quantity - p_token_amount),
    cost_basis = greatest(0, cost_basis - v_cost_reduction),
    updated_at = now()
  where profile_id = p_profile_id and coin_id = p_coin_id;

  update public.coins set
    token_reserve = v_new_token,
    quote_reserve = v_new_quote,
    current_price = v_new_quote / v_new_token,
    market_cap = (v_new_quote / v_new_token) * total_supply,
    updated_at = now()
  where id = p_coin_id returning * into v_coin;

  insert into public.trades(profile_id, coin_id, side, quote_amount, token_amount, price, realized_pnl)
  values (p_profile_id, p_coin_id, 'sell', v_quote_out, p_token_amount, v_exec_price, v_realized);
  perform public.record_candle(p_coin_id, v_coin.current_price, v_quote_out);
  perform public.bump_mission(p_profile_id, 'coin_trade', 1);
  if v_realized > 0 then perform public.bump_mission(p_profile_id, 'profitable_trade', 1); end if;
  return jsonb_build_object('side','sell','quoteAmount',v_quote_out,'tokenAmount',p_token_amount,'executionPrice',v_exec_price,'newPrice',v_coin.current_price,'realizedPnl',v_realized);
end;
$$;

create or replace function public.create_coin(p_profile_id uuid, p_name text, p_symbol text, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles; v_coin public.coins; v_launch_fee numeric := 50;
begin
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.balance < v_launch_fee then raise exception 'You need $50 virtual cash to launch a coin'; end if;
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

create or replace function public.record_gift_collection_candle(p_base_name text, p_price numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_bucket timestamptz := date_trunc('hour', now());
begin
  insert into public.gift_collection_candles(base_name,bucket_start,open,high,low,close,volume)
  values (p_base_name,v_bucket,p_price,p_price,p_price,p_price,p_price)
  on conflict (base_name,bucket_start) do update set
    high = greatest(public.gift_collection_candles.high, excluded.high),
    low = least(public.gift_collection_candles.low, excluded.low),
    close = excluded.close,
    volume = public.gift_collection_candles.volume + excluded.volume;
end;
$$;

create or replace function public.list_virtual_gift(p_profile_id uuid, p_virtual_gift_id uuid, p_price numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_gift public.virtual_gifts;
begin
  select * into v_gift from public.virtual_gifts where id = p_virtual_gift_id for update;
  if not found then raise exception 'Gift not found'; end if;
  if v_gift.owner_profile_id is distinct from p_profile_id then raise exception 'You do not own this virtual gift'; end if;
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

create or replace function public.buy_virtual_gift(p_buyer_id uuid, p_virtual_gift_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_gift public.virtual_gifts; v_asset public.gift_assets; v_buyer public.profiles;
  v_price numeric; v_seller uuid; v_realized numeric;
begin
  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id for update;
  if not found or v_gift.status <> 'listed' or v_gift.listing_price is null then raise exception 'Gift is not listed'; end if;
  v_price := v_gift.listing_price; v_seller := v_gift.owner_profile_id;
  if v_seller = p_buyer_id then raise exception 'You already own this gift'; end if;
  select * into v_buyer from public.profiles where id=p_buyer_id for update;
  if not found then raise exception 'Buyer not found'; end if;
  if v_buyer.balance < v_price then raise exception 'Insufficient balance'; end if;
  perform 1 from public.profiles where id=v_seller for update;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
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

create or replace function public.create_gift_offer(p_buyer_id uuid, p_virtual_gift_id uuid, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_gift public.virtual_gifts; v_buyer public.profiles; v_offer public.gift_offers;
begin
  if p_amount is null or p_amount < 0.01 then raise exception 'Invalid offer amount'; end if;
  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id;
  if not found then raise exception 'Gift not found'; end if;
  if v_gift.owner_profile_id = p_buyer_id then raise exception 'You already own this gift'; end if;
  select * into v_buyer from public.profiles where id=p_buyer_id;
  if not found or v_buyer.balance < p_amount then raise exception 'Insufficient balance for this offer'; end if;
  insert into public.gift_offers(virtual_gift_id,buyer_profile_id,amount)
  values(p_virtual_gift_id,p_buyer_id,p_amount)
  on conflict (virtual_gift_id,buyer_profile_id) where status='pending'
  do update set amount=excluded.amount,updated_at=now()
  returning * into v_offer;
  perform public.bump_mission(p_buyer_id,'gift_offer',1);
  return jsonb_build_object('id',v_offer.id,'amount',v_offer.amount);
end;
$$;

create or replace function public.resolve_gift_offer(p_owner_id uuid, p_offer_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer public.gift_offers; v_gift public.virtual_gifts; v_asset public.gift_assets;
  v_buyer public.profiles; v_realized numeric;
begin
  if p_action not in ('accept','reject') then raise exception 'Invalid action'; end if;
  select * into v_offer from public.gift_offers where id=p_offer_id for update;
  if not found or v_offer.status <> 'pending' then raise exception 'Offer is no longer pending'; end if;
  select * into v_gift from public.virtual_gifts where id=v_offer.virtual_gift_id for update;
  if not found or v_gift.owner_profile_id is distinct from p_owner_id then raise exception 'You do not own this gift'; end if;
  if p_action='reject' then
    update public.gift_offers set status='rejected' where id=p_offer_id;
    return jsonb_build_object('status','rejected');
  end if;
  perform 1 from public.profiles where id=p_owner_id for update;
  select * into v_buyer from public.profiles where id=v_offer.buyer_profile_id for update;
  if not found or v_buyer.balance < v_offer.amount then raise exception 'Buyer no longer has enough balance'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
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
  return jsonb_build_object('status','accepted','price',v_offer.amount,'sellerRealizedPnl',v_realized);
end;
$$;

create or replace function public.cancel_gift_offer(p_buyer_id uuid, p_offer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.gift_offers set status='cancelled' where id=p_offer_id and buyer_profile_id=p_buyer_id and status='pending';
  if not found then raise exception 'Pending offer not found'; end if;
end;
$$;

create or replace function public.claim_mission(p_profile_id uuid, p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_um public.user_missions; v_mission public.missions; v_key text;
begin
  select * into v_mission from public.missions where id=p_mission_id and active=true;
  if not found then raise exception 'Mission not available'; end if;
  v_key := public.mission_period_key(v_mission.period);
  select * into v_um from public.user_missions where profile_id=p_profile_id and mission_id=p_mission_id and period_key=v_key for update;
  if not found then raise exception 'Mission not found'; end if;
  if v_um.claimed_at is not null then raise exception 'Reward already claimed'; end if;
  if v_um.progress < v_mission.target then raise exception 'Mission is not complete'; end if;
  update public.user_missions set claimed_at=now() where profile_id=p_profile_id and mission_id=p_mission_id and period_key=v_key;
  update public.profiles set balance=balance+v_mission.reward where id=p_profile_id;
  return jsonb_build_object('reward',v_mission.reward);
end;
$$;

create or replace view public.market_overview with (security_invoker=true) as
select
  c.id,c.creator_profile_id,c.name,c.symbol,c.description,c.current_price,c.market_cap,c.status,c.created_at,
  coalesce((select sum(t.quote_amount) from public.trades t where t.coin_id=c.id and t.created_at>=now()-interval '24 hours'),0) as volume_24h,
  case when fc.open is null or fc.open=0 then 0 else ((c.current_price/fc.open)-1)*100 end as change_24h,
  coalesce((select count(*) from public.holdings h where h.coin_id=c.id and h.quantity>0),0) as holder_count,
  coalesce((select count(*) from public.trades t where t.coin_id=c.id and t.created_at>=now()-interval '24 hours'),0) as trade_count_24h,
  coalesce(nullif(p.username,''),p.first_name) as creator_name
from public.coins c
left join public.profiles p on p.id=c.creator_profile_id
left join lateral (
  select ca.open from public.candles ca where ca.coin_id=c.id and ca.bucket_start>=now()-interval '24 hours' order by ca.bucket_start asc limit 1
) fc on true;

create or replace view public.gift_market_overview with (security_invoker=true) as
select
  ga.id as asset_id,vg.id as virtual_gift_id,ga.telegram_name,ga.gift_id,ga.base_name,ga.gift_number,
  ga.model_name,ga.model_rarity_per_mille,ga.model_rarity,ga.model_file_id,ga.model_thumb_file_id,ga.model_is_animated,ga.model_is_video,
  ga.symbol_name,ga.symbol_rarity_per_mille,ga.symbol_file_id,ga.symbol_thumb_file_id,
  ga.backdrop_name,ga.backdrop_rarity_per_mille,ga.backdrop_center_color,ga.backdrop_edge_color,ga.backdrop_symbol_color,ga.backdrop_text_color,
  ga.is_premium,ga.is_from_blockchain,
  vg.owner_profile_id,coalesce(nullif(op.username,''),op.first_name) as owner_name,vg.acquired_price,vg.listing_price,vg.last_sale_price,vg.status,vg.created_at,
  case when vals.value_count=0 then null else vals.value_sum/vals.value_count end as estimated_value
from public.gift_assets ga
join public.virtual_gifts vg on vg.asset_id=ga.id
join public.profiles op on op.id=vg.owner_profile_id
left join lateral (
  select
    (case when cf.v is null then 0 else cf.v end + case when mf.v is null then 0 else mf.v end + case when bf.v is null then 0 else bf.v end + case when sf.v is null then 0 else sf.v end + case when ls.v is null then 0 else ls.v end) as value_sum,
    ((cf.v is not null)::int + (mf.v is not null)::int + (bf.v is not null)::int + (sf.v is not null)::int + (ls.v is not null)::int) as value_count
  from
    lateral (select min(vg2.listing_price) v from public.virtual_gifts vg2 join public.gift_assets ga2 on ga2.id=vg2.asset_id where ga2.base_name=ga.base_name and vg2.status='listed') cf,
    lateral (select min(vg2.listing_price) v from public.virtual_gifts vg2 join public.gift_assets ga2 on ga2.id=vg2.asset_id where ga2.base_name=ga.base_name and ga2.model_name=ga.model_name and vg2.status='listed') mf,
    lateral (select min(vg2.listing_price) v from public.virtual_gifts vg2 join public.gift_assets ga2 on ga2.id=vg2.asset_id where ga2.base_name=ga.base_name and ga2.backdrop_name=ga.backdrop_name and vg2.status='listed') bf,
    lateral (select min(vg2.listing_price) v from public.virtual_gifts vg2 join public.gift_assets ga2 on ga2.id=vg2.asset_id where ga2.base_name=ga.base_name and ga2.symbol_name=ga.symbol_name and vg2.status='listed') sf,
    lateral (select gt.price v from public.gift_trades gt join public.gift_assets ga2 on ga2.id=gt.asset_id where ga2.base_name=ga.base_name order by gt.created_at desc limit 1) ls
) vals on true;

create or replace view public.gift_collection_overview with (security_invoker=true) as
select
  ga.base_name,
  count(*) filter (where vg.status='listed')::bigint as listed_count,
  min(vg.listing_price) filter (where vg.status='listed') as floor_price,
  (select gt.price from public.gift_trades gt join public.gift_assets ga2 on ga2.id=gt.asset_id where ga2.base_name=ga.base_name order by gt.created_at desc limit 1) as last_sale_price,
  coalesce((select sum(gt.price) from public.gift_trades gt join public.gift_assets ga2 on ga2.id=gt.asset_id where ga2.base_name=ga.base_name and gt.created_at>=now()-interval '24 hours'),0) as volume_24h,
  coalesce((select count(*) from public.gift_trades gt join public.gift_assets ga2 on ga2.id=gt.asset_id where ga2.base_name=ga.base_name and gt.created_at>=now()-interval '24 hours'),0) as trade_count_24h,
  coalesce((
    select case when first_c.open=0 then 0 else ((last_c.close/first_c.open)-1)*100 end
    from lateral (select gcc.open from public.gift_collection_candles gcc where gcc.base_name=ga.base_name and gcc.bucket_start>=now()-interval '24 hours' order by gcc.bucket_start asc limit 1) first_c,
         lateral (select gcc.close from public.gift_collection_candles gcc where gcc.base_name=ga.base_name and gcc.bucket_start>=now()-interval '24 hours' order by gcc.bucket_start desc limit 1) last_c
  ),0) as change_24h
from public.gift_assets ga
join public.virtual_gifts vg on vg.asset_id=ga.id
group by ga.base_name;

create or replace view public.leaderboard with (security_invoker=true) as
select
  p.id,p.telegram_id,p.username,p.first_name,p.photo_url,p.balance,
  coalesce((select sum(h.quantity*c.current_price) from public.holdings h join public.coins c on c.id=h.coin_id where h.profile_id=p.id),0) as coin_value,
  coalesce((select sum(coalesce(gmo.estimated_value,0)) from public.gift_market_overview gmo where gmo.owner_profile_id=p.id),0) as gift_value,
  p.balance
    + coalesce((select sum(h.quantity*c.current_price) from public.holdings h join public.coins c on c.id=h.coin_id where h.profile_id=p.id),0)
    + coalesce((select sum(coalesce(gmo.estimated_value,0)) from public.gift_market_overview gmo where gmo.owner_profile_id=p.id),0) as net_worth,
  coalesce((select sum(t.realized_pnl) from public.trades t where t.profile_id=p.id),0)
    + coalesce((select sum(gt.realized_pnl) from public.gift_trades gt where gt.seller_profile_id=p.id),0) as realized_pnl,
  coalesce((select count(*) from public.trades t where t.profile_id=p.id),0) as coin_trade_count,
  coalesce((select count(*) from public.gift_trades gt where gt.buyer_profile_id=p.id or gt.seller_profile_id=p.id),0) as gift_trade_count,
  coalesce((select count(*) from public.virtual_gifts vg where vg.owner_profile_id=p.id),0) as gift_count,
  coalesce((select sum(c.market_cap) from public.coins c where c.creator_profile_id=p.id and c.status='active'),0) as created_coin_market_cap
from public.profiles p;

create or replace view public.user_missions_view with (security_invoker=true) as
select um.profile_id,um.mission_id,m.key,m.period,m.title,m.description,m.reward,m.target,m.action_type,m.sort_order,um.progress,(um.claimed_at is not null) as claimed
from public.user_missions um join public.missions m on m.id=um.mission_id
where m.active=true and um.period_key=public.mission_period_key(m.period);

insert into public.missions(key,period,title,description,reward,target,action_type,sort_order) values
  ('open_app','onboarding','Enter MXM','Open MemeX Market from Telegram.',5,1,'open_app',10),
  ('sync_gifts','onboarding','Sync collectibles','Import your unique Telegram Gifts into the virtual market.',10,1,'sync_gift',20),
  ('first_coin_trade','onboarding','First fill','Complete your first meme-coin trade.',10,1,'coin_trade',30),
  ('first_gift_buy','onboarding','First collectible','Buy your first virtual Telegram Gift.',15,1,'gift_buy',40),
  ('daily_trades','daily','Three fills','Complete 3 meme-coin trades today.',8,3,'coin_trade',100),
  ('daily_offer','daily','Make an offer','Place an offer on another player’s Gift.',6,1,'gift_offer',110),
  ('daily_listing','daily','Open a listing','List one of your Gifts for sale.',6,1,'gift_list',120),
  ('daily_profit','daily','Close green','Close one profitable meme-coin position.',10,1,'profitable_trade',130),
  ('weekly_market','weekly','Market regular','Complete 20 meme-coin trades this week.',35,20,'coin_trade',200),
  ('weekly_collector','weekly','Collector run','Buy 4 Gifts this week.',40,4,'gift_buy',210),
  ('weekly_creator','weekly','Launch a meme','Create one meme coin this week.',25,1,'create_coin',220),
  ('weekly_flip','weekly','Gift flipper','Sell 2 Gifts above your acquisition price.',40,2,'profitable_gift_sale',230)
on conflict (key) do update set
  period=excluded.period,title=excluded.title,description=excluded.description,reward=excluded.reward,target=excluded.target,
  action_type=excluded.action_type,sort_order=excluded.sort_order,active=true;

revoke execute on function public.ensure_user_missions(uuid) from public, anon, authenticated;
revoke execute on function public.bump_mission(uuid,text,integer) from public, anon, authenticated;
revoke execute on function public.sync_telegram_profile(bigint,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.record_candle(uuid,numeric,numeric) from public, anon, authenticated;
revoke execute on function public.buy_coin(uuid,uuid,numeric) from public, anon, authenticated;
revoke execute on function public.sell_coin(uuid,uuid,numeric) from public, anon, authenticated;
revoke execute on function public.create_coin(uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.record_gift_collection_candle(text,numeric) from public, anon, authenticated;
revoke execute on function public.list_virtual_gift(uuid,uuid,numeric) from public, anon, authenticated;
revoke execute on function public.buy_virtual_gift(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.create_gift_offer(uuid,uuid,numeric) from public, anon, authenticated;
revoke execute on function public.resolve_gift_offer(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.cancel_gift_offer(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.claim_mission(uuid,uuid) from public, anon, authenticated;

grant execute on function public.ensure_user_missions(uuid) to service_role;
grant execute on function public.bump_mission(uuid,text,integer) to service_role;
grant execute on function public.sync_telegram_profile(bigint,text,text,text,text) to service_role;
grant execute on function public.record_candle(uuid,numeric,numeric) to service_role;
grant execute on function public.buy_coin(uuid,uuid,numeric) to service_role;
grant execute on function public.sell_coin(uuid,uuid,numeric) to service_role;
grant execute on function public.create_coin(uuid,text,text,text) to service_role;
grant execute on function public.record_gift_collection_candle(text,numeric) to service_role;
grant execute on function public.list_virtual_gift(uuid,uuid,numeric) to service_role;
grant execute on function public.buy_virtual_gift(uuid,uuid) to service_role;
grant execute on function public.create_gift_offer(uuid,uuid,numeric) to service_role;
grant execute on function public.resolve_gift_offer(uuid,uuid,text) to service_role;
grant execute on function public.cancel_gift_offer(uuid,uuid) to service_role;
grant execute on function public.claim_mission(uuid,uuid) to service_role;

commit;
