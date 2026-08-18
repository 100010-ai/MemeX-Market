begin;

-- MXM v0.9.2 — repair/compatibility migration.
-- Safe to run when v0.8/v0.8.1/v0.9 migrations were skipped or only partially applied.
-- It never inserts demo/fake Gifts. Existing real Telegram Gift rows are preserved.

-- ---------------------------------------------------------------------------
-- 1. Schema compatibility for databases upgraded from v0.7 or older v0.x.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_system boolean not null default false;
alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists hidden_from_leaderboard boolean not null default false;

alter table public.gift_assets add column if not exists is_burned boolean not null default false;
alter table public.gift_assets add column if not exists telegram_payload jsonb;
alter table public.gift_assets add column if not exists last_seen_at timestamptz not null default now();
alter table public.gift_assets add column if not exists symbol_is_animated boolean not null default false;
alter table public.gift_assets add column if not exists symbol_is_video boolean not null default false;
alter table public.gift_assets add column if not exists catalog_source text not null default 'profile_sync';
alter table public.gift_assets add column if not exists source_reference text;
alter table public.gift_assets add column if not exists telegram_resale_price_ton numeric(24,9);
alter table public.gift_assets add column if not exists resale_seen_at timestamptz;
alter table public.gift_assets add column if not exists model_media_url text;
alter table public.gift_assets add column if not exists symbol_media_url text;

-- Convert the abandoned v0.8 MTProto source marker, if it ever existed, into the
-- current Bot API catalogue marker. Rows are not deleted or replaced.
update public.gift_assets
set catalog_source='bot_catalog',
    source_reference=coalesce(source_reference,'legacy-catalog')
where catalog_source='telegram_resale';

alter table public.gift_assets drop constraint if exists gift_assets_catalog_source_check;
alter table public.gift_assets add constraint gift_assets_catalog_source_check
  check (catalog_source in ('profile_sync','bot_catalog'));

alter table public.gift_assets drop constraint if exists gift_assets_telegram_resale_price_ton_check;
alter table public.gift_assets add constraint gift_assets_telegram_resale_price_ton_check
  check (telegram_resale_price_ton is null or telegram_resale_price_ton > 0);

create index if not exists gift_assets_bot_catalog_idx
  on public.gift_assets(catalog_source,last_seen_at desc)
  where catalog_source='bot_catalog' and is_burned=false;

-- ---------------------------------------------------------------------------
-- 2. Current Bot API catalogue + NPC liquidity tables.
-- ---------------------------------------------------------------------------
create table if not exists public.gift_catalog_sources (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique check (telegram_id > 0),
  label text,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gift_catalog_sources_active_idx on public.gift_catalog_sources(active,created_at);
alter table public.gift_catalog_sources enable row level security;
revoke all on public.gift_catalog_sources from public,anon,authenticated;
grant all on public.gift_catalog_sources to service_role;

create table if not exists public.npc_market_state (
  key text primary key,
  locked_until timestamptz,
  last_tick_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  cycle bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.npc_market_state(key) values('gift-liquidity') on conflict(key) do nothing;
alter table public.npc_market_state enable row level security;
revoke all on public.npc_market_state from public,anon,authenticated;
grant all on public.npc_market_state to service_role;

create table if not exists public.npc_market_log (
  id uuid primary key default gen_random_uuid(),
  virtual_gift_id uuid references public.virtual_gifts(id) on delete set null,
  asset_id uuid references public.gift_assets(id) on delete set null,
  npc_profile_id uuid references public.profiles(id) on delete set null,
  fair_price numeric(24,8) not null check (fair_price > 0),
  listing_price numeric(24,8) not null check (listing_price > 0),
  pricing_mode text not null check (pricing_mode in ('normal','discount','rare_deal')),
  rarity_score numeric(8,6) not null check (rarity_score between 0 and 1),
  created_at timestamptz not null default now()
);
create index if not exists npc_market_log_created_idx on public.npc_market_log(created_at desc);
alter table public.npc_market_log enable row level security;
revoke all on public.npc_market_log from public,anon,authenticated;
grant all on public.npc_market_log to service_role;

create or replace function public.ensure_npc_market_maker(p_desk integer)
returns public.profiles language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles; v_telegram_id bigint; v_name text;
begin
  if p_desk not between 0 and 2 then raise exception 'Invalid NPC desk'; end if;
  v_telegram_id := -900000000000000011 - p_desk;
  v_name := case p_desk when 0 then 'MXM Liquidity' when 1 then 'MXM Market Maker' else 'MXM Gift Desk' end;
  insert into public.profiles(telegram_id,username,first_name,last_name,photo_url,balance,is_system,hidden_from_leaderboard)
  values(v_telegram_id,null,v_name,null,null,0,true,true)
  on conflict(telegram_id) do update set is_system=true,hidden_from_leaderboard=true,first_name=v_name,updated_at=now()
  returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.acquire_npc_market_lock(p_cooldown_seconds integer default 20,p_lock_seconds integer default 8)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_acquired boolean := false;
begin
  if p_cooldown_seconds < 5 or p_cooldown_seconds > 600 then raise exception 'Invalid NPC cooldown'; end if;
  if p_lock_seconds < 2 or p_lock_seconds > 60 then raise exception 'Invalid NPC lock'; end if;
  update public.npc_market_state
  set locked_until=now()+make_interval(secs=>p_lock_seconds),last_tick_at=now(),cycle=cycle+1,updated_at=now()
  where key='gift-liquidity'
    and (locked_until is null or locked_until<now())
    and (last_tick_at is null or last_tick_at<now()-make_interval(secs=>p_cooldown_seconds))
  returning true into v_acquired;
  return coalesce(v_acquired,false);
end;
$$;

create or replace function public.release_npc_market_lock(p_success boolean,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.npc_market_state
  set locked_until=null,
      last_success_at=case when p_success then now() else last_success_at end,
      last_error=case when p_success then null else left(coalesce(p_error,'Unknown NPC market error'),1200) end,
      updated_at=now()
  where key='gift-liquidity';
end;
$$;

create or replace function public.npc_market_listing_count()
returns integer language sql security definer set search_path=public stable as $$
  select count(*)::integer
  from public.virtual_gifts vg
  join public.profiles p on p.id=vg.owner_profile_id
  join public.gift_assets ga on ga.id=vg.asset_id
  where p.is_system=true and vg.status='listed' and vg.listing_price is not null and ga.is_burned=false;
$$;

-- Diversified candidates: round-robin-ish across collections instead of taking
-- many consecutive Gifts from one collection.
create or replace function public.npc_market_candidates(p_limit integer default 80)
returns table(
  asset_id uuid,
  base_name text,
  gift_number integer,
  model_rarity_per_mille integer,
  symbol_rarity_per_mille integer,
  backdrop_rarity_per_mille integer,
  last_seen_at timestamptz
) language sql security definer set search_path=public stable as $$
  with ranked as (
    select ga.*,
           row_number() over (partition by ga.base_name order by ga.last_seen_at desc,ga.id) as collection_rank
    from public.gift_assets ga
    where ga.catalog_source='bot_catalog'
      and ga.is_burned=false
      and ga.telegram_name is not null
      and not exists(select 1 from public.virtual_gifts vg where vg.asset_id=ga.id)
  )
  select r.id,r.base_name,r.gift_number,r.model_rarity_per_mille,r.symbol_rarity_per_mille,r.backdrop_rarity_per_mille,r.last_seen_at
  from ranked r
  order by r.collection_rank asc,r.last_seen_at desc,r.base_name,r.id
  limit greatest(1,least(coalesce(p_limit,80),240));
$$;

create or replace function public.npc_seed_virtual_gift(
  p_asset_id uuid,
  p_price numeric,
  p_fair_price numeric,
  p_rarity_score numeric,
  p_pricing_mode text,
  p_desk integer default 0
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_asset public.gift_assets; v_profile public.profiles; v_id uuid;
begin
  if p_price is null or p_price<=0 or p_price>1000000 then raise exception 'Invalid NPC listing price'; end if;
  if p_fair_price is null or p_fair_price<=0 then raise exception 'Invalid NPC fair price'; end if;
  if p_rarity_score is null or p_rarity_score<0 or p_rarity_score>1 then raise exception 'Invalid NPC rarity score'; end if;
  if p_pricing_mode not in ('normal','discount','rare_deal') then raise exception 'Invalid NPC pricing mode'; end if;

  select * into v_asset from public.gift_assets where id=p_asset_id for update;
  if not found then raise exception 'Gift asset not found'; end if;
  if v_asset.catalog_source<>'bot_catalog' then raise exception 'NPC can list only Bot API catalogue assets'; end if;
  if v_asset.is_burned then raise exception 'Burned Gift cannot be listed'; end if;
  if exists(select 1 from public.virtual_gifts where asset_id=p_asset_id) then
    select id into v_id from public.virtual_gifts where asset_id=p_asset_id;
    return v_id;
  end if;

  v_profile := public.ensure_npc_market_maker(p_desk);
  insert into public.virtual_gifts(asset_id,source_owner_profile_id,owner_profile_id,acquired_price,listing_price,status)
  values(p_asset_id,v_profile.id,v_profile.id,p_fair_price,p_price,'listed')
  returning id into v_id;

  insert into public.npc_market_log(virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score)
  values(v_id,p_asset_id,v_profile.id,p_fair_price,p_price,p_pricing_mode,p_rarity_score);

  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount)
  values(v_profile.id,'listing',v_id,p_price);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Current v0.9 cart + per-item market statistics.
-- ---------------------------------------------------------------------------
create table if not exists public.market_cart_items (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  virtual_gift_id uuid not null references public.virtual_gifts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (profile_id, virtual_gift_id)
);
create index if not exists market_cart_items_profile_added_idx on public.market_cart_items(profile_id, added_at desc);
alter table public.market_cart_items enable row level security;
revoke all on public.market_cart_items from public, anon, authenticated;
grant all on public.market_cart_items to service_role;

create or replace function public.buy_virtual_gift_cart(p_buyer_id uuid, p_virtual_gift_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_buyer public.profiles;
  v_gift public.virtual_gifts;
  v_asset public.gift_assets;
  v_count integer;
  v_total numeric := 0;
  v_reserved_other numeric := 0;
  v_realized numeric;
  v_results jsonb := '[]'::jsonb;
begin
  if p_virtual_gift_ids is null or cardinality(p_virtual_gift_ids) < 1 or cardinality(p_virtual_gift_ids) > 20 then
    raise exception 'Cart must contain between 1 and 20 Gifts';
  end if;

  select count(distinct value) into v_count from unnest(p_virtual_gift_ids) as t(value);
  if v_count <> cardinality(p_virtual_gift_ids) then raise exception 'Cart contains duplicate Gifts'; end if;

  select * into v_buyer from public.profiles where id=p_buyer_id for update;
  if not found then raise exception 'Buyer not found'; end if;

  v_count := 0;
  for v_gift in
    select * from public.virtual_gifts
    where id = any(p_virtual_gift_ids)
    order by id
    for update
  loop
    v_count := v_count + 1;
    if v_gift.status <> 'listed' or v_gift.listing_price is null then raise exception 'One or more Gifts are no longer listed'; end if;
    if v_gift.owner_profile_id = p_buyer_id then raise exception 'Cart contains a Gift you already own'; end if;
    select * into v_asset from public.gift_assets where id=v_gift.asset_id for share;
    if not found then raise exception 'Gift asset is missing'; end if;
    if v_asset.is_burned then raise exception 'Cart contains a burned Gift'; end if;
    v_total := v_total + v_gift.listing_price;
  end loop;
  if v_count <> cardinality(p_virtual_gift_ids) then raise exception 'One or more Gifts do not exist'; end if;

  perform 1 from public.profiles p
  where p.id in (
    select distinct vg.owner_profile_id from public.virtual_gifts vg where vg.id = any(p_virtual_gift_ids)
  )
  order by p.id
  for update;

  select coalesce(sum(go.amount),0) into v_reserved_other
  from public.gift_offers go
  where go.buyer_profile_id=p_buyer_id
    and go.status='pending'
    and not (go.virtual_gift_id = any(p_virtual_gift_ids));

  if v_buyer.balance - v_reserved_other < v_total then raise exception 'Insufficient available balance'; end if;

  update public.profiles set balance=balance-v_total where id=p_buyer_id;

  for v_gift in
    select * from public.virtual_gifts
    where id = any(p_virtual_gift_ids)
    order by id
  loop
    select * into v_asset from public.gift_assets where id=v_gift.asset_id;
    v_realized := v_gift.listing_price - v_gift.acquired_price;

    update public.profiles set balance=balance+v_gift.listing_price where id=v_gift.owner_profile_id;
    update public.virtual_gifts
      set owner_profile_id=p_buyer_id,
          acquired_price=v_gift.listing_price,
          last_sale_price=v_gift.listing_price,
          listing_price=null,
          status='owned'
      where id=v_gift.id;
    update public.gift_offers set status='rejected' where virtual_gift_id=v_gift.id and status='pending';
    delete from public.market_cart_items where virtual_gift_id=v_gift.id;
    insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl)
      values(v_gift.id,v_gift.asset_id,p_buyer_id,v_gift.owner_profile_id,v_gift.listing_price,v_realized);
    perform public.record_gift_collection_candle(v_asset.base_name,v_gift.listing_price);
    perform public.bump_mission(p_buyer_id,'gift_buy',1);
    perform public.bump_mission(v_gift.owner_profile_id,'gift_sell',1);
    if v_realized > 0 then perform public.bump_mission(v_gift.owner_profile_id,'profitable_gift_sale',1); end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'virtualGiftId',v_gift.id,
      'price',v_gift.listing_price
    ));
  end loop;

  delete from public.market_cart_items where profile_id=p_buyer_id and virtual_gift_id = any(p_virtual_gift_ids);
  return jsonb_build_object('itemCount',v_count,'total',v_total,'items',v_results);
end;
$$;

create or replace function public.gift_item_market_stats(p_virtual_gift_id uuid)
returns table(trade_count bigint, volume numeric, high_sale numeric, low_sale numeric)
language sql security definer set search_path=public stable as $$
  select count(*)::bigint,coalesce(sum(gt.price),0),max(gt.price),min(gt.price)
  from public.gift_trades gt where gt.virtual_gift_id=p_virtual_gift_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rebuild authoritative Gift market view with current columns.
--    Column order preserves the old view and only appends compatibility fields.
-- ---------------------------------------------------------------------------
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
  os.best_offer,coalesce(os.offer_count,0)::bigint as offer_count,
  ga.catalog_source,ga.source_reference,ga.telegram_resale_price_ton,ga.resale_seen_at,
  ga.model_media_url,ga.symbol_media_url
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

-- ---------------------------------------------------------------------------
-- 5. Permissions.
-- ---------------------------------------------------------------------------
revoke execute on function public.ensure_npc_market_maker(integer) from public,anon,authenticated;
revoke execute on function public.acquire_npc_market_lock(integer,integer) from public,anon,authenticated;
revoke execute on function public.release_npc_market_lock(boolean,text) from public,anon,authenticated;
revoke execute on function public.npc_market_listing_count() from public,anon,authenticated;
revoke execute on function public.npc_market_candidates(integer) from public,anon,authenticated;
revoke execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) from public,anon,authenticated;
revoke execute on function public.buy_virtual_gift_cart(uuid,uuid[]) from public,anon,authenticated;
revoke execute on function public.gift_item_market_stats(uuid) from public,anon,authenticated;

grant execute on function public.ensure_npc_market_maker(integer) to service_role;
grant execute on function public.acquire_npc_market_lock(integer,integer) to service_role;
grant execute on function public.release_npc_market_lock(boolean,text) to service_role;
grant execute on function public.npc_market_listing_count() to service_role;
grant execute on function public.npc_market_candidates(integer) to service_role;
grant execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) to service_role;
grant execute on function public.buy_virtual_gift_cart(uuid,uuid[]) to service_role;
grant execute on function public.gift_item_market_stats(uuid) to service_role;

commit;
