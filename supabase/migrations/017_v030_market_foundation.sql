begin;

-- MXM v0.30 — market reliability, real price provenance and hardened trading.

alter table public.virtual_gifts add column if not exists listed_at timestamptz;
alter table public.virtual_gifts add column if not exists listing_updated_at timestamptz;
alter table public.virtual_gifts add column if not exists listing_expires_at timestamptz;
alter table public.gift_offers add column if not exists expires_at timestamptz;

update public.virtual_gifts
set listed_at=coalesce(listed_at,updated_at,created_at),
    listing_updated_at=coalesce(listing_updated_at,updated_at,created_at),
    listing_expires_at=coalesce(listing_expires_at,now()+interval '7 days')
where status='listed';
update public.gift_offers set expires_at=coalesce(expires_at,created_at+interval '72 hours') where status='pending';

create index if not exists virtual_gifts_listing_expiry_v030_idx on public.virtual_gifts(status,listing_expires_at) where status='listed';
create index if not exists gift_offers_pending_expiry_v030_idx on public.gift_offers(virtual_gift_id,amount desc,expires_at) where status='pending';

create table if not exists public.market_settings (
  singleton boolean primary key default true check(singleton),
  gift_fee_bps integer not null default 0 check(gift_fee_bps between 0 and 1000),
  listing_days integer not null default 7 check(listing_days between 1 and 30),
  offer_hours integer not null default 72 check(offer_hours between 1 and 168),
  external_quote_hours integer not null default 12 check(external_quote_hours between 1 and 168),
  treasury_profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.market_settings add column if not exists external_quote_hours integer not null default 12 check(external_quote_hours between 1 and 168);
insert into public.market_settings(singleton) values(true) on conflict(singleton) do nothing;
alter table public.market_settings enable row level security;
revoke all on public.market_settings from public,anon,authenticated;
grant select,update on public.market_settings to service_role;

-- System-owned Genesis inventory is finite, but it should not silently
-- disappear merely because a user listing TTL elapsed. It remains available
-- until purchased or until its authoritative external quote becomes stale.
update public.virtual_gifts vg
set listing_expires_at=null,
    listing_updated_at=coalesce(vg.listing_updated_at,now())
from public.profiles p
where p.id=vg.owner_profile_id and p.is_system=true and vg.status='listed';

-- Only a recent native-TON quote may drive Genesis/NPC inventory. A stale
-- TonAPI observation is treated as "no price" rather than being presented as
-- a current market listing.
create or replace function public.reconcile_npc_external_prices()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_repriced integer:=0;
  v_hidden integer:=0;
begin
  update public.virtual_gifts vg
  set listing_price=ga.telegram_resale_price_ton,
      acquired_price=case when vg.last_sale_price is null then ga.telegram_resale_price_ton else vg.acquired_price end,
      status='listed',listing_expires_at=null,listing_updated_at=now()
  from public.gift_assets ga,public.profiles p,public.market_settings ms
  where ms.singleton=true
    and vg.asset_id=ga.id and p.id=vg.owner_profile_id and p.is_system=true
    and ga.is_burned=false
    and ga.telegram_resale_price_ton is not null and ga.telegram_resale_price_ton>0
    and ga.resale_seen_at is not null
    and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
    and (vg.status<>'listed' or vg.listing_price is distinct from ga.telegram_resale_price_ton or vg.listing_expires_at is not null);
  get diagnostics v_repriced = row_count;

  update public.virtual_gifts vg
  set listing_price=null,status='owned',listing_expires_at=null,listing_updated_at=now()
  from public.gift_assets ga,public.profiles p,public.market_settings ms
  where ms.singleton=true
    and vg.asset_id=ga.id and p.id=vg.owner_profile_id and p.is_system=true and vg.status='listed'
    and (
      ga.is_burned=true
      or ga.telegram_resale_price_ton is null
      or ga.telegram_resale_price_ton<=0
      or ga.resale_seen_at is null
      or ga.resale_seen_at<now()-make_interval(hours=>ms.external_quote_hours)
    );
  get diagnostics v_hidden = row_count;

  return jsonb_build_object('repriced',v_repriced,'hidden',v_hidden);
end;
$$;

create or replace function public.initialize_gift_genesis_pool()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_seed text;
  v_started timestamptz;
  v_completed timestamptz;
  v_total integer;
  v_released integer;
  v_quote_hours integer:=12;
begin
  select seed,started_at,completed_at into v_seed,v_started,v_completed
  from public.gift_genesis_state where singleton=true for update;
  select external_quote_hours into v_quote_hours from public.market_settings where singleton=true;
  v_quote_hours:=coalesce(v_quote_hours,12);

  delete from public.gift_genesis_pool gp
  using public.gift_assets ga
  where gp.asset_id=ga.id and gp.released_at is null
    and (
      ga.is_burned=true
      or ga.telegram_resale_price_ton is null
      or ga.telegram_resale_price_ton<=0
      or ga.resale_seen_at is null
      or ga.resale_seen_at<now()-make_interval(hours=>v_quote_hours)
    );

  if v_completed is null then
    insert into public.gift_genesis_pool(asset_id,release_key,rarity_tier)
    select ga.id,md5(v_seed||':'||ga.id::text),
      case
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=5 then 'legendary'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=20 then 'epic'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=60 then 'rare'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=180 then 'uncommon'
        else 'common'
      end
    from public.gift_assets ga
    where ga.catalog_source in ('bot_catalog','tonapi')
      and ga.is_burned=false and ga.telegram_name is not null
      and ga.telegram_resale_price_ton is not null and ga.telegram_resale_price_ton>0
      and ga.resale_seen_at is not null and ga.resale_seen_at>=now()-make_interval(hours=>v_quote_hours)
      and (
        (ga.catalog_source='bot_catalog' and ga.model_file_id is not null and ga.symbol_file_id is not null)
        or (ga.catalog_source='tonapi' and ga.chain_verified=true and (ga.model_media_url is not null or ga.model_preview_url is not null))
      )
    on conflict(asset_id) do nothing;

    if v_started is null then
      update public.gift_genesis_state set started_at=now(),updated_at=now() where singleton=true;
    end if;
  end if;

  update public.gift_genesis_pool gp
  set virtual_gift_id=vg.id,released_at=coalesce(gp.released_at,vg.created_at,now())
  from public.virtual_gifts vg
  where vg.asset_id=gp.asset_id and (gp.virtual_gift_id is distinct from vg.id or gp.released_at is null);

  select count(*)::integer,count(*) filter(where released_at is not null)::integer into v_total,v_released
  from public.gift_genesis_pool;
  update public.gift_genesis_state
  set snapshot_count=v_total,released_count=v_released,
      completed_at=case when v_total>0 and v_released>=v_total then coalesce(completed_at,now()) else null end,
      updated_at=now()
  where singleton=true;

  return jsonb_build_object('total',v_total,'released',v_released,'remaining',greatest(0,v_total-v_released),
    'completed',v_total>0 and v_released>=v_total,'seed',v_seed);
end;
$$;

create or replace function public.genesis_market_candidates(p_limit integer default 24)
returns table(
  asset_id uuid,base_name text,gift_number integer,model_rarity_per_mille integer,
  symbol_rarity_per_mille integer,backdrop_rarity_per_mille integer,last_seen_at timestamptz,
  rarity_tier text,release_key text
) language sql security definer set search_path=public stable as $$
  with settings as (
    select external_quote_hours from public.market_settings where singleton=true
  ), ranked as (
    select ga.id as asset_id,ga.base_name,ga.gift_number,ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,
      ga.backdrop_rarity_per_mille,ga.last_seen_at,gp.rarity_tier,gp.release_key,
      row_number() over(partition by gp.rarity_tier order by gp.release_key) as tier_row,
      case gp.rarity_tier when 'common' then 1 when 'uncommon' then 2 when 'rare' then 3 when 'epic' then 4 else 5 end as tier_order
    from public.gift_genesis_pool gp
    join public.gift_assets ga on ga.id=gp.asset_id
    cross join settings ms
    where gp.released_at is null and ga.is_burned=false
      and ga.telegram_resale_price_ton is not null and ga.telegram_resale_price_ton>0
      and ga.resale_seen_at is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
      and not exists(select 1 from public.virtual_gifts vg where vg.asset_id=ga.id)
  )
  select asset_id,base_name,gift_number,model_rarity_per_mille,symbol_rarity_per_mille,
    backdrop_rarity_per_mille,last_seen_at,rarity_tier,release_key
  from ranked order by tier_row,tier_order,release_key
  limit greatest(1,least(coalesce(p_limit,24),1000));
$$;

-- The database, not the browser, determines the Genesis price. Compatibility
-- price arguments remain in the signature, but are deliberately ignored.
create or replace function public.npc_seed_virtual_gift(
  p_asset_id uuid,p_price numeric,p_fair_price numeric,p_rarity_score numeric,p_pricing_mode text,p_desk integer default 0
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_asset public.gift_assets;
  v_profile public.profiles;
  v_id uuid;
  v_existing_system boolean;
  v_observed numeric;
  v_quote_hours integer:=12;
begin
  if p_rarity_score is null or p_rarity_score<0 or p_rarity_score>1 then raise exception 'Invalid NPC rarity score'; end if;
  select external_quote_hours into v_quote_hours from public.market_settings where singleton=true;
  v_quote_hours:=coalesce(v_quote_hours,12);
  select * into v_asset from public.gift_assets where id=p_asset_id for update;
  if not found then raise exception 'Gift asset not found'; end if;
  if v_asset.catalog_source not in ('bot_catalog','tonapi') then raise exception 'NPC can list only verified Telegram catalogue assets'; end if;
  if v_asset.catalog_source='tonapi' and not v_asset.chain_verified then raise exception 'Unverified TON NFT cannot enter Genesis'; end if;
  if v_asset.is_burned then raise exception 'Burned Gift cannot be listed'; end if;
  v_observed:=v_asset.telegram_resale_price_ton;
  if v_observed is null or v_observed<=0 or v_observed>1000000
     or v_asset.resale_seen_at is null
     or v_asset.resale_seen_at<now()-make_interval(hours=>v_quote_hours) then
    raise exception 'Fresh observed native TON listing price is required';
  end if;

  select vg.id,p.is_system into v_id,v_existing_system
  from public.virtual_gifts vg join public.profiles p on p.id=vg.owner_profile_id
  where vg.asset_id=p_asset_id limit 1 for update of vg;
  if v_id is not null then
    if v_existing_system then
      update public.virtual_gifts
      set acquired_price=case when last_sale_price is null then v_observed else acquired_price end,
          listing_price=v_observed,status='listed',listing_expires_at=null,listing_updated_at=now(),listed_at=coalesce(listed_at,now())
      where id=v_id;
    end if;
    update public.gift_genesis_pool set virtual_gift_id=v_id,released_at=coalesce(released_at,now()) where asset_id=p_asset_id;
    return v_id;
  end if;

  v_profile:=public.ensure_npc_market_maker(p_desk);
  insert into public.virtual_gifts(asset_id,source_owner_profile_id,owner_profile_id,acquired_price,listing_price,status,listed_at,listing_updated_at,listing_expires_at)
  values(p_asset_id,v_profile.id,v_profile.id,v_observed,v_observed,'listed',now(),now(),null) returning id into v_id;
  insert into public.npc_market_log(virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score)
  values(v_id,p_asset_id,v_profile.id,v_observed,v_observed,'normal',p_rarity_score);
  update public.gift_genesis_pool set virtual_gift_id=v_id,released_at=now() where asset_id=p_asset_id;
  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount) values(v_profile.id,'listing',v_id,v_observed);
  return v_id;
end;
$$;

create table if not exists public.gift_listing_events (
  id uuid primary key default gen_random_uuid(),
  virtual_gift_id uuid not null references public.virtual_gifts(id) on delete cascade,
  asset_id uuid not null references public.gift_assets(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  kind text not null check(kind in ('listed','repriced','unlisted','expired','sold','offer_accepted')),
  price numeric(24,8),
  previous_price numeric(24,8),
  created_at timestamptz not null default now()
);
create index if not exists gift_listing_events_gift_created_v030_idx on public.gift_listing_events(virtual_gift_id,created_at desc);
create index if not exists gift_listing_events_asset_created_v030_idx on public.gift_listing_events(asset_id,created_at desc);
alter table public.gift_listing_events enable row level security;
revoke all on public.gift_listing_events from public,anon,authenticated;
grant select,insert on public.gift_listing_events to service_role;

create table if not exists public.gift_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_profile_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null,
  virtual_gift_id uuid not null references public.virtual_gifts(id) on delete cascade,
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(buyer_profile_id,request_key)
);
create index if not exists gift_purchase_requests_created_v030_idx on public.gift_purchase_requests(buyer_profile_id,created_at desc);
alter table public.gift_purchase_requests enable row level security;
revoke all on public.gift_purchase_requests from public,anon,authenticated;
grant select,insert,update on public.gift_purchase_requests to service_role;

create table if not exists public.gift_cart_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_profile_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null,
  cart_key text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(buyer_profile_id,request_key)
);
create index if not exists gift_cart_purchase_requests_created_v030_idx on public.gift_cart_purchase_requests(buyer_profile_id,created_at desc);
alter table public.gift_cart_purchase_requests enable row level security;
revoke all on public.gift_cart_purchase_requests from public,anon,authenticated;
grant select,insert,update on public.gift_cart_purchase_requests to service_role;

create table if not exists public.gift_price_observations (
  id bigint generated always as identity primary key,
  asset_id uuid references public.gift_assets(id) on delete cascade,
  base_name text not null,
  source text not null check(source in ('tonapi','telegram','mxm')),
  kind text not null check(kind in ('listing','sale','floor')),
  currency text not null default 'TON',
  price_ton numeric(24,9) not null check(price_ton>0),
  source_ref text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists gift_price_observations_asset_v030_idx on public.gift_price_observations(asset_id,observed_at desc);
create index if not exists gift_price_observations_collection_v030_idx on public.gift_price_observations(base_name,kind,observed_at desc);
alter table public.gift_price_observations enable row level security;
revoke all on public.gift_price_observations from public,anon,authenticated;
grant select,insert,delete on public.gift_price_observations to service_role;

-- Expire stale market orders without deleting history.
create or replace function public.expire_market_orders()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_listings integer:=0; v_offers integer:=0;
begin
  with expired as (
    update public.virtual_gifts vg
    set status='owned',listing_price=null,listing_expires_at=null,listing_updated_at=now()
    where vg.status='listed' and vg.listing_expires_at is not null and vg.listing_expires_at<=now()
    returning vg.id,vg.asset_id,vg.owner_profile_id
  ), logged as (
    insert into public.gift_listing_events(virtual_gift_id,asset_id,actor_profile_id,kind)
    select id,asset_id,owner_profile_id,'expired' from expired returning 1
  ) select count(*)::integer into v_listings from logged;

  update public.gift_offers set status='cancelled',updated_at=now()
  where status='pending' and expires_at is not null and expires_at<=now();
  get diagnostics v_offers = row_count;

  -- Idempotency/rate-limit rows are operational state, not permanent market
  -- history. Bounded cleanup prevents a busy public beta from growing them
  -- forever while completed trades/listing events remain untouched.
  delete from public.gift_purchase_requests where created_at<now()-interval '30 days';
  delete from public.gift_cart_purchase_requests where created_at<now()-interval '30 days';
  delete from public.api_rate_limits where updated_at<now()-interval '2 days';
  return jsonb_build_object('listings',v_listings,'offers',v_offers);
end;
$$;

-- Reserved offer balance ignores expired offers.
create or replace function public.pending_gift_offer_total(p_profile_id uuid, p_exclude_virtual_gift_id uuid default null)
returns numeric language sql security definer set search_path=public stable as $$
  select coalesce(sum(amount),0)
  from public.gift_offers
  where buyer_profile_id=p_profile_id
    and status='pending'
    and (expires_at is null or expires_at>now())
    and (p_exclude_virtual_gift_id is null or virtual_gift_id<>p_exclude_virtual_gift_id);
$$;

create or replace function public.list_virtual_gift_v2(p_profile_id uuid,p_virtual_gift_id uuid,p_price numeric,p_duration_days integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_gift public.virtual_gifts; v_asset public.gift_assets; v_days integer; v_prev numeric; v_kind text;
begin
  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id for update;
  if not found then raise exception 'Gift not found'; end if;
  if v_gift.owner_profile_id is distinct from p_profile_id then raise exception 'You do not own this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
  if not found then raise exception 'Gift asset is missing'; end if;
  if v_asset.is_burned then raise exception 'Telegram marks this Gift as burned'; end if;
  v_prev:=v_gift.listing_price;
  if p_price is null then
    update public.virtual_gifts set status='owned',listing_price=null,listing_expires_at=null,listing_updated_at=now() where id=p_virtual_gift_id;
    if v_prev is not null then insert into public.gift_listing_events(virtual_gift_id,asset_id,actor_profile_id,kind,previous_price) values(p_virtual_gift_id,v_asset.id,p_profile_id,'unlisted',v_prev); end if;
    return jsonb_build_object('status','owned');
  end if;
  if p_price<0.01 or p_price>1000000000 then raise exception 'Invalid listing price'; end if;
  select coalesce(p_duration_days,listing_days) into v_days from public.market_settings where singleton=true;
  v_days:=greatest(1,least(coalesce(v_days,7),30));
  v_kind:=case when v_prev is null then 'listed' else 'repriced' end;
  update public.virtual_gifts
  set status='listed',listing_price=p_price,
      listed_at=case when v_prev is null then now() else coalesce(listed_at,now()) end,
      listing_updated_at=now(),listing_expires_at=now()+make_interval(days=>v_days)
  where id=p_virtual_gift_id;
  insert into public.gift_listing_events(virtual_gift_id,asset_id,actor_profile_id,kind,price,previous_price)
  values(p_virtual_gift_id,v_asset.id,p_profile_id,v_kind,p_price,v_prev);
  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount) values(p_profile_id,'listing',p_virtual_gift_id,p_price);
  perform public.bump_mission(p_profile_id,'gift_list',1);
  return jsonb_build_object('status','listed','price',p_price,'expiresAt',now()+make_interval(days=>v_days));
end;
$$;

create or replace function public.create_gift_offer_v2(p_buyer_id uuid,p_virtual_gift_id uuid,p_amount numeric,p_duration_hours integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_gift public.virtual_gifts; v_asset public.gift_assets; v_buyer public.profiles; v_offer public.gift_offers; v_reserved numeric; v_hours integer;
begin
  if p_amount is null or p_amount<0.01 or p_amount>1000000000 then raise exception 'Invalid offer amount'; end if;
  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id for share;
  if not found then raise exception 'Gift not found'; end if;
  if v_gift.owner_profile_id=p_buyer_id then raise exception 'You already own this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
  if not found then raise exception 'Gift asset is missing'; end if;
  if v_asset.is_burned then raise exception 'Telegram marks this Gift as burned'; end if;
  select * into v_buyer from public.profiles where id=p_buyer_id for update;
  if not found then raise exception 'Buyer not found'; end if;
  v_reserved:=public.pending_gift_offer_total(p_buyer_id,p_virtual_gift_id);
  if v_buyer.balance-v_reserved<p_amount then raise exception 'Insufficient available balance for this offer'; end if;
  select coalesce(p_duration_hours,offer_hours) into v_hours from public.market_settings where singleton=true;
  v_hours:=greatest(1,least(coalesce(v_hours,72),168));
  insert into public.gift_offers(virtual_gift_id,buyer_profile_id,amount,expires_at)
  values(p_virtual_gift_id,p_buyer_id,p_amount,now()+make_interval(hours=>v_hours))
  on conflict(virtual_gift_id,buyer_profile_id) where status='pending'
  do update set amount=excluded.amount,expires_at=excluded.expires_at,updated_at=now()
  returning * into v_offer;
  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount) values(p_buyer_id,'offer',p_virtual_gift_id,v_offer.amount);
  perform public.bump_mission(p_buyer_id,'gift_offer',1);
  return jsonb_build_object('id',v_offer.id,'amount',v_offer.amount,'expiresAt',v_offer.expires_at,'reservedTotal',v_reserved+v_offer.amount);
end;
$$;

create or replace function public.buy_virtual_gift_v2(p_buyer_id uuid,p_virtual_gift_id uuid,p_request_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_req public.gift_purchase_requests; v_gift public.virtual_gifts; v_asset public.gift_assets;
  v_buyer public.profiles; v_price numeric; v_seller uuid; v_reserved numeric; v_realized numeric;
  v_fee_bps integer:=0; v_fee numeric:=0; v_seller_net numeric; v_treasury uuid; v_result jsonb;
begin
  if p_request_key is null or char_length(p_request_key)<8 or char_length(p_request_key)>120 or p_request_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'Invalid purchase request key'; end if;
  insert into public.gift_purchase_requests(buyer_profile_id,request_key,virtual_gift_id)
  values(p_buyer_id,p_request_key,p_virtual_gift_id) on conflict(buyer_profile_id,request_key) do nothing;
  select * into v_req from public.gift_purchase_requests where buyer_profile_id=p_buyer_id and request_key=p_request_key for update;
  if v_req.virtual_gift_id<>p_virtual_gift_id then raise exception 'Purchase request key was already used for another Gift'; end if;
  if v_req.response is not null then return v_req.response; end if;

  select * into v_gift from public.virtual_gifts where id=p_virtual_gift_id for update;
  if not found or v_gift.status<>'listed' or v_gift.listing_price is null then raise exception 'Gift is not listed'; end if;
  if v_gift.listing_expires_at is not null and v_gift.listing_expires_at<=now() then
    -- The opportunistic market-maintenance RPC owns expiry cleanup. Raising
    -- here keeps the purchase transaction read-only on failure instead of
    -- performing writes that PostgreSQL would roll back with the exception.
    raise exception 'Gift listing expired';
  end if;
  v_price:=v_gift.listing_price; v_seller:=v_gift.owner_profile_id;
  if v_seller=p_buyer_id then raise exception 'You already own this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id;
  if not found then raise exception 'Gift asset is missing'; end if;
  if v_asset.is_burned then raise exception 'Telegram marks this Gift as burned'; end if;

  select gift_fee_bps,treasury_profile_id into v_fee_bps,v_treasury from public.market_settings where singleton=true;
  -- Lock every balance row in one deterministic UUID order, including the
  -- treasury when fees are enabled, to avoid cross-purchase deadlock cycles.
  perform 1 from public.profiles where id in (p_buyer_id,v_seller,v_treasury) order by id for update;
  select * into v_buyer from public.profiles where id=p_buyer_id;
  if not found then raise exception 'Buyer not found'; end if;
  v_reserved:=public.pending_gift_offer_total(p_buyer_id,p_virtual_gift_id);
  if v_buyer.balance-v_reserved<v_price then raise exception 'Insufficient available balance'; end if;
  -- Never silently burn a configured fee. Until a distinct treasury exists,
  -- the effective fee is zero and the seller receives the full sale price.
  v_fee:=case when v_treasury is null or v_treasury in (v_seller,p_buyer_id) then 0 else round(v_price*coalesce(v_fee_bps,0)/10000.0,8) end;
  v_seller_net:=v_price-v_fee;
  v_realized:=v_seller_net-v_gift.acquired_price;

  update public.profiles set balance=balance-v_price where id=p_buyer_id;
  update public.profiles set balance=balance+v_seller_net where id=v_seller;
  if v_fee>0 and v_treasury is not null and v_treasury<>v_seller and v_treasury<>p_buyer_id then update public.profiles set balance=balance+v_fee where id=v_treasury; end if;
  update public.virtual_gifts set owner_profile_id=p_buyer_id,acquired_price=v_price,last_sale_price=v_price,listing_price=null,status='owned',listing_expires_at=null,listing_updated_at=now() where id=p_virtual_gift_id;
  update public.gift_offers set status='rejected',updated_at=now() where virtual_gift_id=p_virtual_gift_id and status='pending';
  delete from public.market_cart_items where virtual_gift_id=p_virtual_gift_id;
  insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl) values(p_virtual_gift_id,v_gift.asset_id,p_buyer_id,v_seller,v_price,v_realized);
  insert into public.gift_listing_events(virtual_gift_id,asset_id,actor_profile_id,kind,price,previous_price) values(p_virtual_gift_id,v_gift.asset_id,p_buyer_id,'sold',v_price,v_price);
  insert into public.gift_price_observations(asset_id,base_name,source,kind,price_ton,source_ref) values(v_asset.id,v_asset.base_name,'mxm','sale',v_price,p_virtual_gift_id::text);
  perform public.record_gift_collection_candle(v_asset.base_name,v_price);
  perform public.bump_mission(p_buyer_id,'gift_buy',1); perform public.bump_mission(v_seller,'gift_sell',1);
  if v_realized>0 then perform public.bump_mission(v_seller,'profitable_gift_sale',1); end if;
  v_result:=jsonb_build_object('price',v_price,'fee',v_fee,'sellerNet',v_seller_net,'virtualGiftId',p_virtual_gift_id,'sellerRealizedPnl',v_realized,'requestKey',p_request_key);
  update public.gift_purchase_requests set response=v_result,completed_at=now() where id=v_req.id;
  return v_result;
end;
$$;

create or replace function public.buy_virtual_gift_cart_v2(p_buyer_id uuid,p_virtual_gift_ids uuid[],p_request_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ids uuid[]; v_cart_key text; v_req public.gift_cart_purchase_requests; v_gift public.virtual_gifts; v_asset public.gift_assets;
  v_buyer public.profiles; v_count integer:=0; v_total numeric:=0; v_reserved numeric:=0; v_realized numeric;
  v_fee_bps integer:=0; v_fee numeric:=0; v_total_fee numeric:=0; v_seller_net numeric; v_treasury uuid; v_results jsonb:='[]'::jsonb; v_result jsonb;
begin
  if p_request_key is null or char_length(p_request_key)<8 or char_length(p_request_key)>120 or p_request_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'Invalid cart request key'; end if;
  if p_virtual_gift_ids is null or cardinality(p_virtual_gift_ids)<1 or cardinality(p_virtual_gift_ids)>20 then raise exception 'Cart must contain between 1 and 20 Gifts'; end if;
  select array_agg(value order by value),count(distinct value)::integer into v_ids,v_count from unnest(p_virtual_gift_ids) as t(value);
  if v_count<>cardinality(p_virtual_gift_ids) then raise exception 'Cart contains duplicate Gifts'; end if;
  v_cart_key:=array_to_string(v_ids,',');

  insert into public.gift_cart_purchase_requests(buyer_profile_id,request_key,cart_key)
  values(p_buyer_id,p_request_key,v_cart_key) on conflict(buyer_profile_id,request_key) do nothing;
  select * into v_req from public.gift_cart_purchase_requests where buyer_profile_id=p_buyer_id and request_key=p_request_key for update;
  if v_req.cart_key<>v_cart_key then raise exception 'Cart request key was already used for another cart'; end if;
  if v_req.response is not null then return v_req.response; end if;

  v_count:=0;
  for v_gift in select * from public.virtual_gifts where id=any(v_ids) order by id for update loop
    v_count:=v_count+1;
    if v_gift.status<>'listed' or v_gift.listing_price is null then raise exception 'One or more Gifts are no longer listed'; end if;
    if v_gift.listing_expires_at is not null and v_gift.listing_expires_at<=now() then raise exception 'One or more Gift listings expired'; end if;
    if v_gift.owner_profile_id=p_buyer_id then raise exception 'Cart contains a Gift you already own'; end if;
    select * into v_asset from public.gift_assets where id=v_gift.asset_id;
    if not found then raise exception 'Gift asset is missing'; end if;
    if v_asset.is_burned then raise exception 'Cart contains a burned Gift'; end if;
    v_total:=v_total+v_gift.listing_price;
  end loop;
  if v_count<>cardinality(v_ids) then raise exception 'One or more Gifts do not exist'; end if;

  select gift_fee_bps,treasury_profile_id into v_fee_bps,v_treasury from public.market_settings where singleton=true;
  -- Lock every balance row after Gift rows, in one deterministic UUID order.
  perform 1 from public.profiles p
  where p.id=p_buyer_id
     or p.id=v_treasury
     or p.id in (select distinct vg.owner_profile_id from public.virtual_gifts vg where vg.id=any(v_ids))
  order by p.id for update;
  select * into v_buyer from public.profiles where id=p_buyer_id;
  if not found then raise exception 'Buyer not found'; end if;

  select coalesce(sum(go.amount),0) into v_reserved
  from public.gift_offers go
  where go.buyer_profile_id=p_buyer_id and go.status='pending'
    and (go.expires_at is null or go.expires_at>now())
    and not (go.virtual_gift_id=any(v_ids));
  if v_buyer.balance-v_reserved<v_total then raise exception 'Insufficient available balance'; end if;

  update public.profiles set balance=balance-v_total where id=p_buyer_id;
  for v_gift in select * from public.virtual_gifts where id=any(v_ids) order by id loop
    select * into v_asset from public.gift_assets where id=v_gift.asset_id;
    v_fee:=case when v_treasury is null or v_treasury in (v_gift.owner_profile_id,p_buyer_id) then 0 else round(v_gift.listing_price*coalesce(v_fee_bps,0)/10000.0,8) end;
    v_seller_net:=v_gift.listing_price-v_fee;
    v_total_fee:=v_total_fee+v_fee;
    v_realized:=v_seller_net-v_gift.acquired_price;

    update public.profiles set balance=balance+v_seller_net where id=v_gift.owner_profile_id;
    if v_fee>0 then update public.profiles set balance=balance+v_fee where id=v_treasury; end if;
    update public.virtual_gifts
      set owner_profile_id=p_buyer_id,acquired_price=v_gift.listing_price,last_sale_price=v_gift.listing_price,
          listing_price=null,status='owned',listing_expires_at=null,listing_updated_at=now()
      where id=v_gift.id;
    update public.gift_offers set status='rejected',updated_at=now() where virtual_gift_id=v_gift.id and status='pending';
    delete from public.market_cart_items where virtual_gift_id=v_gift.id;
    insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl)
      values(v_gift.id,v_gift.asset_id,p_buyer_id,v_gift.owner_profile_id,v_gift.listing_price,v_realized);
    insert into public.gift_listing_events(virtual_gift_id,asset_id,actor_profile_id,kind,price,previous_price)
      values(v_gift.id,v_gift.asset_id,p_buyer_id,'sold',v_gift.listing_price,v_gift.listing_price);
    insert into public.gift_price_observations(asset_id,base_name,source,kind,price_ton,source_ref)
      values(v_asset.id,v_asset.base_name,'mxm','sale',v_gift.listing_price,'cart:'||p_request_key);
    perform public.record_gift_collection_candle(v_asset.base_name,v_gift.listing_price);
    perform public.bump_mission(p_buyer_id,'gift_buy',1);
    perform public.bump_mission(v_gift.owner_profile_id,'gift_sell',1);
    if v_realized>0 then perform public.bump_mission(v_gift.owner_profile_id,'profitable_gift_sale',1); end if;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('virtualGiftId',v_gift.id,'price',v_gift.listing_price,'fee',v_fee,'sellerNet',v_seller_net));
  end loop;

  delete from public.market_cart_items where profile_id=p_buyer_id and virtual_gift_id=any(v_ids);
  v_result:=jsonb_build_object('itemCount',v_count,'total',v_total,'fee',v_total_fee,'items',v_results,'requestKey',p_request_key);
  update public.gift_cart_purchase_requests set response=v_result,completed_at=now() where id=v_req.id;
  return v_result;
end;
$$;

create or replace function public.resolve_gift_offer_v2(p_owner_id uuid,p_offer_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_offer public.gift_offers; v_gift public.virtual_gifts; v_asset public.gift_assets; v_buyer public.profiles;
  v_reserved numeric; v_realized numeric; v_fee_bps integer:=0; v_fee numeric:=0; v_seller_net numeric; v_treasury uuid;
begin
  if p_action not in ('accept','reject') then raise exception 'Invalid action'; end if;
  select * into v_offer from public.gift_offers where id=p_offer_id for update;
  if not found or v_offer.status<>'pending' then raise exception 'Offer is no longer pending'; end if;
  if v_offer.expires_at is not null and v_offer.expires_at<=now() then raise exception 'Offer expired'; end if;
  select * into v_gift from public.virtual_gifts where id=v_offer.virtual_gift_id for update;
  if not found or v_gift.owner_profile_id is distinct from p_owner_id then raise exception 'You do not own this Gift'; end if;
  select * into v_asset from public.gift_assets where id=v_gift.asset_id; if not found then raise exception 'Gift asset is missing'; end if;
  if v_asset.is_burned then raise exception 'Telegram marks this Gift as burned'; end if;
  if p_action='reject' then update public.gift_offers set status='rejected',updated_at=now() where id=p_offer_id; return jsonb_build_object('status','rejected'); end if;
  select gift_fee_bps,treasury_profile_id into v_fee_bps,v_treasury from public.market_settings where singleton=true;
  perform 1 from public.profiles where id in (p_owner_id,v_offer.buyer_profile_id,v_treasury) order by id for update;
  select * into v_buyer from public.profiles where id=v_offer.buyer_profile_id;
  v_reserved:=public.pending_gift_offer_total(v_offer.buyer_profile_id,v_gift.id);
  if v_buyer.balance-v_reserved<v_offer.amount then raise exception 'Buyer no longer has enough available balance'; end if;
  v_fee:=case when v_treasury is null or v_treasury in (p_owner_id,v_offer.buyer_profile_id) then 0 else round(v_offer.amount*coalesce(v_fee_bps,0)/10000.0,8) end;
  v_seller_net:=v_offer.amount-v_fee;
  v_realized:=v_seller_net-v_gift.acquired_price;
  update public.profiles set balance=balance-v_offer.amount where id=v_offer.buyer_profile_id;
  update public.profiles set balance=balance+v_seller_net where id=p_owner_id;
  if v_fee>0 and v_treasury is not null and v_treasury<>p_owner_id and v_treasury<>v_offer.buyer_profile_id then update public.profiles set balance=balance+v_fee where id=v_treasury; end if;
  update public.virtual_gifts set owner_profile_id=v_offer.buyer_profile_id,acquired_price=v_offer.amount,last_sale_price=v_offer.amount,listing_price=null,status='owned',listing_expires_at=null,listing_updated_at=now() where id=v_gift.id;
  update public.gift_offers set status=case when id=p_offer_id then 'accepted' else 'rejected' end,updated_at=now() where virtual_gift_id=v_gift.id and status='pending';
  delete from public.market_cart_items where virtual_gift_id=v_gift.id;
  insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl) values(v_gift.id,v_gift.asset_id,v_offer.buyer_profile_id,p_owner_id,v_offer.amount,v_realized);
  insert into public.gift_listing_events(virtual_gift_id,asset_id,actor_profile_id,kind,price,previous_price) values(v_gift.id,v_gift.asset_id,p_owner_id,'offer_accepted',v_offer.amount,v_gift.listing_price);
  insert into public.gift_price_observations(asset_id,base_name,source,kind,price_ton,source_ref) values(v_asset.id,v_asset.base_name,'mxm','sale',v_offer.amount,v_offer.id::text);
  perform public.record_gift_collection_candle(v_asset.base_name,v_offer.amount);
  perform public.bump_mission(v_offer.buyer_profile_id,'gift_buy',1); perform public.bump_mission(p_owner_id,'gift_sell',1);
  return jsonb_build_object('status','accepted','price',v_offer.amount,'fee',v_fee,'sellerNet',v_seller_net,'virtualGiftId',v_gift.id,'sellerRealizedPnl',v_realized);
end;
$$;

-- Exact collection trait analytics are aggregated in PostgreSQL so large
-- collections are not truncated by an arbitrary API row limit.
create or replace function public.gift_collection_trait_stats(p_base_name text)
returns table(
  trait_type text,
  name text,
  item_count bigint,
  listed_count bigint,
  floor_price numeric,
  rarity_per_mille integer
) language sql security definer set search_path=public stable as $$
  with rows as (
    select ga.model_name,ga.model_rarity_per_mille,ga.backdrop_name,ga.backdrop_rarity_per_mille,
      ga.symbol_name,ga.symbol_rarity_per_mille,vg.status,vg.listing_price,vg.listing_expires_at
    from public.gift_assets ga
    join public.virtual_gifts vg on vg.asset_id=ga.id
    where ga.base_name=p_base_name and ga.is_burned=false
  ), traits as (
    select 'model'::text as trait_type,model_name as name,model_rarity_per_mille as rarity_per_mille,status,listing_price,listing_expires_at from rows
    union all
    select 'backdrop',backdrop_name,backdrop_rarity_per_mille,status,listing_price,listing_expires_at from rows
    union all
    select 'symbol',symbol_name,symbol_rarity_per_mille,status,listing_price,listing_expires_at from rows
  )
  select trait_type,name,count(*)::bigint as item_count,
    count(*) filter(where status='listed' and listing_price is not null and (listing_expires_at is null or listing_expires_at>now()))::bigint as listed_count,
    min(listing_price) filter(where status='listed' and listing_price is not null and (listing_expires_at is null or listing_expires_at>now())) as floor_price,
    min(rarity_per_mille)::integer as rarity_per_mille
  from traits where name is not null and name<>''
  group by trait_type,name
  order by trait_type,rarity_per_mille,name;
$$;

-- Current market view: no invented arithmetic valuation. estimated_value is a
-- backwards-compatible REAL reference only (external live listing, item sale,
-- or latest collection sale) and every new client also receives provenance.
create or replace view public.gift_market_overview with (security_invoker=true) as
with settings as (
  select external_quote_hours from public.market_settings where singleton=true
), collection_floor as (
  select ga.base_name,min(vg.listing_price) as v from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false and vg.status='listed' and (vg.listing_expires_at is null or vg.listing_expires_at>now()) group by ga.base_name
), model_floor as (
  select ga.base_name,ga.model_name,min(vg.listing_price) as v from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false and vg.status='listed' and (vg.listing_expires_at is null or vg.listing_expires_at>now()) group by ga.base_name,ga.model_name
), backdrop_floor as (
  select ga.base_name,ga.backdrop_name,min(vg.listing_price) as v from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false and vg.status='listed' and (vg.listing_expires_at is null or vg.listing_expires_at>now()) group by ga.base_name,ga.backdrop_name
), symbol_floor as (
  select ga.base_name,ga.symbol_name,min(vg.listing_price) as v from public.virtual_gifts vg join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false and vg.status='listed' and (vg.listing_expires_at is null or vg.listing_expires_at>now()) group by ga.base_name,ga.symbol_name
), last_sale as (
  select distinct on (ga.base_name) ga.base_name,gt.price as v,gt.created_at from public.gift_trades gt join public.gift_assets ga on ga.id=gt.asset_id order by ga.base_name,gt.created_at desc,gt.id desc
), offer_stats as (
  select virtual_gift_id,max(amount) as best_offer,count(*)::bigint as offer_count from public.gift_offers where status='pending' and (expires_at is null or expires_at>now()) group by virtual_gift_id
)
select
  ga.id as asset_id,vg.id as virtual_gift_id,ga.telegram_name,ga.gift_id,ga.base_name,ga.gift_number,
  ga.model_name,ga.model_rarity_per_mille,ga.model_rarity,ga.model_file_id,ga.model_thumb_file_id,ga.model_is_animated,ga.model_is_video,
  ga.symbol_name,ga.symbol_rarity_per_mille,ga.symbol_file_id,ga.symbol_thumb_file_id,ga.symbol_is_animated,ga.symbol_is_video,
  ga.backdrop_name,ga.backdrop_rarity_per_mille,ga.backdrop_center_color,ga.backdrop_edge_color,ga.backdrop_symbol_color,ga.backdrop_text_color,
  ga.is_premium,ga.is_from_blockchain,ga.is_burned,ga.telegram_payload,ga.last_seen_at,
  vg.owner_profile_id,coalesce(nullif(op.username,''),op.first_name) as owner_name,vg.acquired_price,vg.listing_price,vg.last_sale_price,vg.status,vg.created_at,
  coalesce(case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then ga.telegram_resale_price_ton end,vg.last_sale_price,ls.v) as estimated_value,
  os.best_offer,coalesce(os.offer_count,0)::bigint as offer_count,
  ga.catalog_source,ga.source_reference,ga.telegram_resale_price_ton,ga.resale_seen_at,
  ga.model_media_url,ga.symbol_media_url,ga.model_preview_url,
  ga.chain_nft_address,ga.chain_collection_address,ga.chain_verified,
  vg.listed_at,vg.listing_updated_at,vg.listing_expires_at,
  case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then ga.telegram_resale_price_ton end as external_listing_price_ton,
  case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then 'tonapi' else null end as external_price_source,
  case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then ga.resale_seen_at end as external_price_seen_at,
  coalesce(vg.listing_price,case when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then ga.telegram_resale_price_ton end,vg.last_sale_price,ls.v) as reference_price_ton,
  case when vg.listing_price is not null then 'mxm_listing' when ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then 'tonapi_listing' when vg.last_sale_price is not null then 'item_last_sale' when ls.v is not null then 'collection_last_sale' else null end as price_basis,
  cf.v as collection_floor,mf.v as model_floor,bf.v as backdrop_floor,sf.v as symbol_floor
from public.gift_assets ga
cross join settings ms
join public.virtual_gifts vg on vg.asset_id=ga.id
join public.profiles op on op.id=vg.owner_profile_id
left join collection_floor cf on cf.base_name=ga.base_name
left join model_floor mf on mf.base_name=ga.base_name and mf.model_name=ga.model_name
left join backdrop_floor bf on bf.base_name=ga.base_name and bf.backdrop_name=ga.backdrop_name
left join symbol_floor sf on sf.base_name=ga.base_name and sf.symbol_name=ga.symbol_name
left join last_sale ls on ls.base_name=ga.base_name
left join offer_stats os on os.virtual_gift_id=vg.id;

grant select on public.gift_market_overview to service_role;

create or replace view public.gift_collection_overview with (security_invoker=true) as
with settings as (
  select external_quote_hours from public.market_settings where singleton=true
), collection_base as (
  select ga.base_name,count(*)::bigint as item_count,count(distinct vg.owner_profile_id)::bigint as holder_count,
    count(*) filter(where vg.status='listed' and (vg.listing_expires_at is null or vg.listing_expires_at>now()))::bigint as listed_count,
    min(vg.listing_price) filter(where vg.status='listed' and (vg.listing_expires_at is null or vg.listing_expires_at>now())) as floor_price,
    min(ga.telegram_resale_price_ton) filter(where ga.telegram_resale_price_ton is not null and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)) as external_floor
  from public.gift_assets ga cross join settings ms join public.virtual_gifts vg on vg.asset_id=ga.id where ga.is_burned=false group by ga.base_name,ms.external_quote_hours
), trade_stats as (
  select ga.base_name,
    coalesce(sum(gt.price) filter(where gt.created_at>=now()-interval '24 hours'),0) as volume_24h,
    count(*) filter(where gt.created_at>=now()-interval '24 hours')::bigint as trade_count_24h,
    coalesce(sum(gt.price) filter(where gt.created_at>=now()-interval '7 days'),0) as volume_7d,
    count(*) filter(where gt.created_at>=now()-interval '7 days')::bigint as trade_count_7d,
    coalesce(sum(gt.price),0) as all_time_volume,count(*)::bigint as total_sales,max(gt.price) as high_sale
  from public.gift_trades gt join public.gift_assets ga on ga.id=gt.asset_id group by ga.base_name
), last_sale as (
  select distinct on (ga.base_name) ga.base_name,gt.price as last_sale_price from public.gift_trades gt join public.gift_assets ga on ga.id=gt.asset_id order by ga.base_name,gt.created_at desc,gt.id desc
), first_candle as (
  select distinct on (base_name) base_name,open from public.gift_collection_candles where bucket_start>=now()-interval '24 hours' order by base_name,bucket_start asc
), last_candle as (
  select distinct on (base_name) base_name,close from public.gift_collection_candles where bucket_start>=now()-interval '24 hours' order by base_name,bucket_start desc
)
select b.base_name,b.item_count,b.holder_count,b.listed_count,b.floor_price,ls.last_sale_price,
  coalesce(t.volume_24h,0) as volume_24h,coalesce(t.trade_count_24h,0) as trade_count_24h,
  case when fc.open is null or fc.open=0 or lc.close is null then 0 else ((lc.close/fc.open)-1)*100 end as change_24h,
  coalesce(t.volume_7d,0) as volume_7d,coalesce(t.trade_count_7d,0) as trade_count_7d,
  case when b.item_count=0 then 0 else (b.listed_count::numeric/b.item_count::numeric)*100 end as listed_pct,
  coalesce(t.all_time_volume,0) as all_time_volume,coalesce(t.total_sales,0) as total_sales,t.high_sale,b.external_floor
from collection_base b left join trade_stats t on t.base_name=b.base_name left join last_sale ls on ls.base_name=b.base_name left join first_candle fc on fc.base_name=b.base_name left join last_candle lc on lc.base_name=b.base_name;

grant select on public.gift_collection_overview to service_role;

create or replace function public.gift_market_random_page(p_seed text,p_offset integer default 0,p_limit integer default 72)
returns setof public.gift_market_overview language sql security definer set search_path=public stable as $$
  select g.* from public.gift_market_overview g
  where g.status='listed' and g.is_burned=false and g.telegram_name is not null and (g.listing_expires_at is null or g.listing_expires_at>now())
  order by md5(coalesce(p_seed,'mxm')||':'||g.virtual_gift_id::text)
  offset greatest(0,coalesce(p_offset,0)) limit greatest(1,least(coalesce(p_limit,72),120));
$$;

create or replace function public.gift_market_listed_count()
returns integer language sql security definer set search_path=public stable as $$
  select count(*)::integer from public.gift_market_overview where status='listed' and is_burned=false and telegram_name is not null and (listing_expires_at is null or listing_expires_at>now());
$$;

-- More informative Genesis state without changing existing keys.
create or replace function public.gift_genesis_public_state()
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'total',s.snapshot_count,'released',s.released_count,'remainingToRelease',greatest(0,s.snapshot_count-s.released_count),
    'completed',s.completed_at is not null,'startedAt',s.started_at,'completedAt',s.completed_at,
    'soldToPlayers',(select count(*)::integer from public.gift_genesis_pool gp join public.virtual_gifts vg on vg.id=gp.virtual_gift_id join public.profiles p on p.id=vg.owner_profile_id where p.is_system=false),
    'npcAvailable',(select count(*)::integer from public.gift_genesis_pool gp join public.virtual_gifts vg on vg.id=gp.virtual_gift_id join public.profiles p on p.id=vg.owner_profile_id where p.is_system=true and vg.status='listed' and (vg.listing_expires_at is null or vg.listing_expires_at>now()))
  ) from public.gift_genesis_state s where s.singleton=true;
$$;

revoke execute on function public.reconcile_npc_external_prices() from public,anon,authenticated;
revoke execute on function public.initialize_gift_genesis_pool() from public,anon,authenticated;
revoke execute on function public.genesis_market_candidates(integer) from public,anon,authenticated;
revoke execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) from public,anon,authenticated;
grant execute on function public.reconcile_npc_external_prices() to service_role;
grant execute on function public.initialize_gift_genesis_pool() to service_role;
grant execute on function public.genesis_market_candidates(integer) to service_role;
grant execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) to service_role;
revoke execute on function public.expire_market_orders() from public,anon,authenticated;
revoke execute on function public.list_virtual_gift_v2(uuid,uuid,numeric,integer) from public,anon,authenticated;
revoke execute on function public.create_gift_offer_v2(uuid,uuid,numeric,integer) from public,anon,authenticated;
revoke execute on function public.buy_virtual_gift_v2(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.buy_virtual_gift_cart_v2(uuid,uuid[],text) from public,anon,authenticated;
revoke execute on function public.resolve_gift_offer_v2(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.pending_gift_offer_total(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.gift_collection_trait_stats(text) from public,anon,authenticated;
revoke execute on function public.gift_market_random_page(text,integer,integer) from public,anon,authenticated;
revoke execute on function public.gift_market_listed_count() from public,anon,authenticated;
revoke execute on function public.gift_genesis_public_state() from public,anon,authenticated;
grant execute on function public.expire_market_orders() to service_role;
grant execute on function public.list_virtual_gift_v2(uuid,uuid,numeric,integer) to service_role;
grant execute on function public.create_gift_offer_v2(uuid,uuid,numeric,integer) to service_role;
grant execute on function public.buy_virtual_gift_v2(uuid,uuid,text) to service_role;
grant execute on function public.buy_virtual_gift_cart_v2(uuid,uuid[],text) to service_role;
grant execute on function public.resolve_gift_offer_v2(uuid,uuid,text) to service_role;
grant execute on function public.pending_gift_offer_total(uuid,uuid) to service_role;
grant execute on function public.gift_collection_trait_stats(text) to service_role;
grant execute on function public.gift_market_random_page(text,integer,integer) to service_role;
grant execute on function public.gift_market_listed_count() to service_role;
grant execute on function public.gift_genesis_public_state() to service_role;

commit;
