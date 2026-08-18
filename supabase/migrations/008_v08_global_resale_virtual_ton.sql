begin;

-- MXM v0.8: bounded global Telegram resale catalogue + virtual TON denomination.
-- No demo rows are inserted. Every bootstrap Gift must come from a Telegram
-- collectible returned by the authenticated MTProto resale API.

alter table public.profiles alter column balance set default 100;

alter table public.gift_assets add column if not exists catalog_source text not null default 'profile_sync';
alter table public.gift_assets add column if not exists source_reference text;
alter table public.gift_assets add column if not exists telegram_resale_price_ton numeric(24,9);
alter table public.gift_assets add column if not exists resale_seen_at timestamptz;
alter table public.gift_assets add column if not exists model_media_url text;
alter table public.gift_assets add column if not exists symbol_media_url text;

alter table public.gift_assets drop constraint if exists gift_assets_catalog_source_check;
alter table public.gift_assets add constraint gift_assets_catalog_source_check
  check (catalog_source in ('profile_sync','telegram_resale'));
alter table public.gift_assets drop constraint if exists gift_assets_telegram_resale_price_ton_check;
alter table public.gift_assets add constraint gift_assets_telegram_resale_price_ton_check
  check (telegram_resale_price_ton is null or telegram_resale_price_ton > 0);

create index if not exists gift_assets_catalog_source_seen_idx
  on public.gift_assets(catalog_source,resale_seen_at desc);
create index if not exists gift_assets_resale_price_idx
  on public.gift_assets(telegram_resale_price_ton)
  where catalog_source='telegram_resale' and telegram_resale_price_ton is not null;

create table if not exists public.catalog_sync_state (
  key text primary key,
  locked_until timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.catalog_sync_state(key) values('global_resale') on conflict(key) do nothing;

create table if not exists public.catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'telegram_resale' check (source in ('telegram_resale','profile_sync')),
  status text not null default 'running' check (status in ('running','success','failed','skipped')),
  reason text,
  collections_scanned integer not null default 0,
  resale_gifts_seen integer not null default 0,
  assets_upserted integer not null default 0,
  virtual_listings_created integer not null default 0,
  media_objects_uploaded integer not null default 0,
  skipped_without_ton_price integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists catalog_sync_runs_started_idx on public.catalog_sync_runs(started_at desc);

alter table public.catalog_sync_state enable row level security;
alter table public.catalog_sync_runs enable row level security;
revoke all on public.catalog_sync_state,public.catalog_sync_runs from public,anon,authenticated;
grant all on public.catalog_sync_state,public.catalog_sync_runs to service_role;

create or replace function public.acquire_global_catalog_lock(p_seconds integer default 150)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_locked boolean := false;
begin
  if p_seconds is null or p_seconds < 15 or p_seconds > 600 then raise exception 'Invalid catalog lock duration'; end if;
  update public.catalog_sync_state
  set locked_until=now()+make_interval(secs=>p_seconds),last_started_at=now(),updated_at=now()
  where key='global_resale' and (locked_until is null or locked_until<now())
  returning true into v_locked;
  return coalesce(v_locked,false);
end;
$$;

create or replace function public.release_global_catalog_lock(p_success boolean,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.catalog_sync_state
  set locked_until=null,last_finished_at=now(),last_success_at=case when p_success then now() else last_success_at end,
      last_error=case when p_success then null else left(coalesce(p_error,'Unknown catalogue error'),2000) end,updated_at=now()
  where key='global_resale';
end;
$$;

create or replace function public.ensure_global_catalog_profile()
returns public.profiles language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles;
begin
  insert into public.profiles(telegram_id,username,first_name,last_name,photo_url,balance,is_system)
  values(-900000000000000001,null,'MXM Market Treasury',null,null,0,true)
  on conflict(telegram_id) do update set is_system=true,first_name='MXM Market Treasury',updated_at=now()
  returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.seed_global_catalog_gift(p_asset_id uuid,p_initial_ton_price numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_profile public.profiles; v_asset public.gift_assets; v_existing public.virtual_gifts; v_id uuid;
begin
  if p_initial_ton_price is null or p_initial_ton_price<=0 then raise exception 'Observed TON price is required'; end if;
  select * into v_asset from public.gift_assets where id=p_asset_id for update;
  if not found then raise exception 'Gift asset not found'; end if;
  if v_asset.catalog_source<>'telegram_resale' then raise exception 'Only Telegram resale assets can be globally seeded'; end if;
  if v_asset.is_burned then raise exception 'Burned Gift cannot be seeded'; end if;

  select * into v_existing from public.virtual_gifts where asset_id=p_asset_id;
  if found then return v_existing.id; end if;

  v_profile := public.ensure_global_catalog_profile();
  insert into public.virtual_gifts(asset_id,source_owner_profile_id,owner_profile_id,acquired_price,listing_price,status)
  values(p_asset_id,v_profile.id,v_profile.id,p_initial_ton_price,p_initial_ton_price,'listed')
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.acquire_global_catalog_lock(integer) from public,anon,authenticated;
revoke execute on function public.release_global_catalog_lock(boolean,text) from public,anon,authenticated;
revoke execute on function public.ensure_global_catalog_profile() from public,anon,authenticated;
revoke execute on function public.seed_global_catalog_gift(uuid,numeric) from public,anon,authenticated;
grant execute on function public.acquire_global_catalog_lock(integer) to service_role;
grant execute on function public.release_global_catalog_lock(boolean,text) to service_role;
grant execute on function public.ensure_global_catalog_profile() to service_role;
grant execute on function public.seed_global_catalog_gift(uuid,numeric) to service_role;

-- Public storage contains only mirrored Telegram collectible artwork. The
-- authenticated MTProto session itself never leaves the server environment.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $q$
      insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('gift-media','gift-media',true,8388608,array['image/webp','image/png','image/jpeg','video/webm','application/json'])
      on conflict(id) do update set public=true,file_size_limit=8388608,
        allowed_mime_types=array['image/webp','image/png','image/jpeg','video/webm','application/json']
    $q$;
  end if;
end $$;

-- Surface mirrored MTProto media and source observations through the existing
-- authoritative market view. Existing Bot API synced Gifts continue to work.
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

-- User-facing database errors now refer to virtual TON, not dollars.
create or replace function public.create_coin_with_image(
  p_profile_id uuid,p_name text,p_symbol text,p_description text,p_image_url text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles; v_coin public.coins; v_launch_fee numeric := 50; v_reserved numeric;
begin
  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_banned and (v_profile.banned_until is null or v_profile.banned_until>now()) then raise exception 'Account is banned'; end if;
  v_reserved := public.pending_gift_offer_total(p_profile_id,null);
  if v_profile.balance-v_reserved<v_launch_fee then raise exception 'You need 50 virtual TON available to launch a coin'; end if;
  if char_length(trim(p_name))<2 or char_length(trim(p_name))>32 then raise exception 'Invalid coin name'; end if;
  if upper(trim(p_symbol)) !~ '^[A-Z0-9]{2,8}$' then raise exception 'Invalid ticker'; end if;
  if char_length(coalesce(p_description,''))>180 then raise exception 'Description is too long'; end if;
  update public.profiles set balance=balance-v_launch_fee where id=p_profile_id;
  insert into public.coins(creator_profile_id,name,symbol,description,image_url)
  values(p_profile_id,trim(p_name),upper(trim(p_symbol)),left(coalesce(trim(p_description),''),180),nullif(trim(coalesce(p_image_url,'')),'')) returning * into v_coin;
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

commit;
