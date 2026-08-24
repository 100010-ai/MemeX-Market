-- MemeX Market v0.65.5
-- Runtime hot paths: targeted session snapshots, one-pass gift floors,
-- and incremental Genesis release accounting.

-- Track the last upstream catalogue/sync version that was reconciled into Genesis.
alter table public.gift_genesis_state
  add column if not exists catalog_checked_at timestamptz;

-- One session needs one profile's aggregates, not a full financial roll-up for every profile.
create or replace function public.session_profile_snapshot_v040(p_telegram_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
    'reserved_balance',coalesce(public.reserved_market_balance_v056(p.id,null,null,null),0),
    'coin_value',coalesce(h.coin_value,0),
    'gift_value',coalesce(g.gift_value,0),
    'net_worth',p.balance+coalesce(h.coin_value,0)+coalesce(g.gift_value,0),
    'realized_pnl',coalesce(cs.coin_realized_pnl,0)+coalesce(gs.gift_realized_pnl,0)
  )
  from public.profiles p
  left join lateral (
    select coalesce(sum(h.quantity*c.current_price),0) as coin_value
    from public.holdings h
    join public.coins c on c.id=h.coin_id
    where h.profile_id=p.id and h.quantity>0
  ) h on true
  left join lateral (
    select coalesce(sum(coalesce(
      case
        when ga.telegram_resale_price_ton is not null
          and ga.telegram_resale_price_ton>0
          and (ga.resale_seen_at is null or ga.resale_seen_at>=now()-interval '24 hours')
        then ga.telegram_resale_price_ton
      end,
      vg.last_sale_price,
      vg.acquired_price,
      0
    )),0) as gift_value
    from public.virtual_gifts vg
    join public.gift_assets ga on ga.id=vg.asset_id
    where vg.owner_profile_id=p.id and coalesce(ga.is_burned,false)=false
  ) g on true
  left join lateral (
    select coalesce(sum(t.realized_pnl),0) as coin_realized_pnl
    from public.trades t
    where t.profile_id=p.id and not coalesce(t.is_launch_seed,false)
  ) cs on true
  left join lateral (
    select coalesce(sum(gt.realized_pnl),0) as gift_realized_pnl
    from public.gift_trades gt
    where gt.seller_profile_id=p.id
  ) gs on true
  where p.telegram_id=p_telegram_id;
$$;

-- Compute all four floor dimensions from one tiny active-listing set instead of
-- repeating the same virtual_gifts -> gift_assets lookup four times.
create or replace view public.gift_market_overview
with (security_invoker=true)
as
with settings as (
  select external_quote_hours
  from public.market_settings
  where singleton=true
), listed_rows as materialized (
  select
    ga.base_name,
    ga.model_name,
    ga.backdrop_name,
    ga.symbol_name,
    vg.listing_price
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id=vg.asset_id
  where ga.is_burned=false
    and vg.status='listed'
    and (vg.listing_expires_at is null or vg.listing_expires_at>now())
), collection_floor as (
  select base_name,min(listing_price) as v
  from listed_rows
  group by base_name
), model_floor as (
  select base_name,model_name,min(listing_price) as v
  from listed_rows
  group by base_name,model_name
), backdrop_floor as (
  select base_name,backdrop_name,min(listing_price) as v
  from listed_rows
  group by base_name,backdrop_name
), symbol_floor as (
  select base_name,symbol_name,min(listing_price) as v
  from listed_rows
  group by base_name,symbol_name
), last_sale as (
  select distinct on (ga.base_name)
    ga.base_name,
    gt.price as v,
    gt.created_at
  from public.gift_trades gt
  join public.gift_assets ga on ga.id=gt.asset_id
  order by ga.base_name,gt.created_at desc,gt.id desc
), offer_stats as (
  select
    virtual_gift_id,
    max(amount) as best_offer,
    count(*) as offer_count
  from public.gift_offers
  where status='pending'
    and (expires_at is null or expires_at>now())
  group by virtual_gift_id
)
select
  ga.id as asset_id,
  vg.id as virtual_gift_id,
  ga.telegram_name,
  ga.gift_id,
  ga.base_name,
  ga.gift_number,
  ga.model_name,
  ga.model_rarity_per_mille,
  ga.model_rarity,
  ga.model_file_id,
  ga.model_thumb_file_id,
  ga.model_is_animated,
  ga.model_is_video,
  ga.symbol_name,
  ga.symbol_rarity_per_mille,
  ga.symbol_file_id,
  ga.symbol_thumb_file_id,
  ga.symbol_is_animated,
  ga.symbol_is_video,
  ga.backdrop_name,
  ga.backdrop_rarity_per_mille,
  ga.backdrop_center_color,
  ga.backdrop_edge_color,
  ga.backdrop_symbol_color,
  ga.backdrop_text_color,
  ga.is_premium,
  ga.is_from_blockchain,
  ga.is_burned,
  ga.telegram_payload,
  ga.last_seen_at,
  vg.owner_profile_id,
  coalesce(nullif(op.username,''),op.first_name) as owner_name,
  vg.acquired_price,
  vg.listing_price,
  vg.last_sale_price,
  vg.status,
  vg.created_at,
  coalesce(
    case
      when ga.telegram_resale_price_ton is not null
        and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
      then ga.telegram_resale_price_ton
    end,
    vg.last_sale_price,
    ls.v
  ) as estimated_value,
  os.best_offer,
  coalesce(os.offer_count,0::bigint) as offer_count,
  ga.catalog_source,
  ga.source_reference,
  ga.telegram_resale_price_ton,
  ga.resale_seen_at,
  ga.model_media_url,
  ga.symbol_media_url,
  ga.model_preview_url,
  ga.chain_nft_address,
  ga.chain_collection_address,
  ga.chain_verified,
  vg.listed_at,
  vg.listing_updated_at,
  vg.listing_expires_at,
  case
    when ga.telegram_resale_price_ton is not null
      and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
    then ga.telegram_resale_price_ton
  end as external_listing_price_ton,
  case
    when ga.telegram_resale_price_ton is not null
      and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
    then 'tonapi'::text
  end as external_price_source,
  case
    when ga.telegram_resale_price_ton is not null
      and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
    then ga.resale_seen_at
  end as external_price_seen_at,
  coalesce(
    vg.listing_price,
    case
      when ga.telegram_resale_price_ton is not null
        and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours)
      then ga.telegram_resale_price_ton
    end,
    vg.last_sale_price,
    ls.v
  ) as reference_price_ton,
  case
    when vg.listing_price is not null then 'mxm_listing'::text
    when ga.telegram_resale_price_ton is not null
      and ga.resale_seen_at>=now()-make_interval(hours=>ms.external_quote_hours) then 'tonapi_listing'::text
    when vg.last_sale_price is not null then 'item_last_sale'::text
    when ls.v is not null then 'collection_last_sale'::text
  end as price_basis,
  cf.v as collection_floor,
  mf.v as model_floor,
  bf.v as backdrop_floor,
  sf.v as symbol_floor
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

-- Tiny internal state snapshot used when another worker owns the NPC market lock.
create or replace function public.gift_genesis_counter_state_v0655()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total',snapshot_count,
    'released',released_count,
    'remaining',greatest(0,snapshot_count-released_count),
    'completed',snapshot_count>0 and released_count>=snapshot_count,
    'seed',seed
  )
  from public.gift_genesis_state
  where singleton=true;
$$;
revoke execute on function public.gift_genesis_counter_state_v0655() from public,anon,authenticated;
grant execute on function public.gift_genesis_counter_state_v0655() to service_role;

-- Release accounting is idempotent: only the first transition from unreleased -> released
-- increments the state counter. Retries merely reconcile the virtual_gift_id.
create or replace function public.mark_gift_genesis_released_v0655(
  p_asset_id uuid,
  p_virtual_gift_id uuid,
  p_released_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marked boolean:=false;
begin
  update public.gift_genesis_pool
  set virtual_gift_id=p_virtual_gift_id,
      released_at=coalesce(released_at,p_released_at,now())
  where asset_id=p_asset_id
    and released_at is null
  returning true into v_marked;

  if coalesce(v_marked,false) then
    update public.gift_genesis_state
    set released_count=least(snapshot_count,released_count+1),
        completed_at=case
          when snapshot_count>0 and released_count+1>=snapshot_count then coalesce(completed_at,now())
          else completed_at
        end,
        updated_at=now()
    where singleton=true;
    return true;
  end if;

  update public.gift_genesis_pool
  set virtual_gift_id=p_virtual_gift_id
  where asset_id=p_asset_id
    and virtual_gift_id is distinct from p_virtual_gift_id;
  return false;
end;
$$;
revoke execute on function public.mark_gift_genesis_released_v0655(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.mark_gift_genesis_released_v0655(uuid,uuid,timestamptz) to service_role;

-- Rebuild the catalogue snapshot only when an upstream catalogue or user Gift sync has
-- actually completed since the previous reconciliation. Normal NPC releases no longer
-- trigger a 14k-row catalogue scan.
create or replace function public.initialize_gift_genesis_pool()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seed text;
  v_started timestamptz;
  v_completed timestamptz;
  v_checked timestamptz;
  v_source_changed timestamptz;
  v_total integer;
  v_released integer;
  v_refresh boolean:=false;
begin
  select seed,started_at,completed_at,catalog_checked_at,snapshot_count,released_count
  into v_seed,v_started,v_completed,v_checked,v_total,v_released
  from public.gift_genesis_state
  where singleton=true
  for update;

  select greatest(
    coalesce((select max(last_success_at) from public.catalog_sync_state),'-infinity'::timestamptz),
    coalesce((select last_sync_at from public.tonapi_catalog_state where singleton=true),'-infinity'::timestamptz),
    coalesce((select max(finished_at) from public.gift_sync_runs where finished_at is not null),'-infinity'::timestamptz)
  ) into v_source_changed;

  v_refresh:=v_checked is null or v_source_changed>v_checked;

  if v_completed is null and v_refresh then
    insert into public.gift_genesis_pool(asset_id,release_key,rarity_tier)
    select
      ga.id,
      md5(v_seed || ':' || ga.id::text),
      case
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=5 then 'legendary'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=20 then 'epic'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=60 then 'rare'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=180 then 'uncommon'
        else 'common'
      end
    from public.gift_assets ga
    where ga.catalog_source in ('bot_catalog','tonapi')
      and ga.is_burned=false
      and ga.telegram_name is not null
      and (
        (ga.catalog_source='bot_catalog' and ga.model_file_id is not null and ga.symbol_file_id is not null)
        or
        (ga.catalog_source='tonapi' and ga.chain_verified=true and ga.model_media_url is not null)
      )
    on conflict(asset_id) do nothing;

    if v_started is null then
      update public.gift_genesis_state
      set started_at=now(),updated_at=now()
      where singleton=true;
    end if;

    update public.gift_genesis_pool gp
    set virtual_gift_id=vg.id,
        released_at=coalesce(gp.released_at,vg.created_at,now())
    from public.virtual_gifts vg
    where vg.asset_id=gp.asset_id
      and (gp.virtual_gift_id is distinct from vg.id or gp.released_at is null);

    select count(*)::integer,
           count(*) filter(where released_at is not null)::integer
    into v_total,v_released
    from public.gift_genesis_pool;

    update public.gift_genesis_state
    set snapshot_count=v_total,
        released_count=v_released,
        completed_at=case
          when v_total>0 and v_released>=v_total then coalesce(completed_at,now())
          else null
        end,
        catalog_checked_at=case when v_source_changed='-infinity'::timestamptz then now() else v_source_changed end,
        updated_at=now()
    where singleton=true;
  else
    select snapshot_count,released_count,completed_at
    into v_total,v_released,v_completed
    from public.gift_genesis_state
    where singleton=true;
  end if;

  return jsonb_build_object(
    'total',coalesce(v_total,0),
    'released',coalesce(v_released,0),
    'remaining',greatest(0,coalesce(v_total,0)-coalesce(v_released,0)),
    'completed',coalesce(v_total,0)>0 and coalesce(v_released,0)>=coalesce(v_total,0),
    'seed',v_seed
  );
end;
$$;

-- Keep the existing RPC contract while moving release counters to the idempotent helper.
create or replace function public.npc_seed_virtual_gift(
  p_asset_id uuid,
  p_price numeric,
  p_fair_price numeric,
  p_rarity_score numeric,
  p_pricing_mode text,
  p_desk integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.gift_assets;
  v_profile public.profiles;
  v_id uuid;
begin
  if p_price is null or p_price<=0 or p_price>1000000 then raise exception 'Invalid NPC listing price'; end if;
  if p_fair_price is null or p_fair_price<=0 then raise exception 'Invalid NPC fair price'; end if;
  if p_rarity_score is null or p_rarity_score<0 or p_rarity_score>1 then raise exception 'Invalid NPC rarity score'; end if;
  if p_pricing_mode not in ('normal','discount','rare_deal') then raise exception 'Invalid NPC pricing mode'; end if;

  select * into v_asset
  from public.gift_assets
  where id=p_asset_id
  for update;
  if not found then raise exception 'Gift asset not found'; end if;
  if v_asset.catalog_source not in ('bot_catalog','tonapi') then raise exception 'NPC can list only verified Telegram catalogue assets'; end if;
  if v_asset.catalog_source='tonapi' and not v_asset.chain_verified then raise exception 'Unverified TON NFT cannot enter Genesis'; end if;
  if v_asset.is_burned then raise exception 'Burned Gift cannot be listed'; end if;

  select id into v_id
  from public.virtual_gifts
  where asset_id=p_asset_id;
  if v_id is not null then
    perform public.mark_gift_genesis_released_v0655(p_asset_id,v_id,now());
    return v_id;
  end if;

  v_profile:=public.ensure_npc_market_maker(p_desk);
  insert into public.virtual_gifts(asset_id,source_owner_profile_id,owner_profile_id,acquired_price,listing_price,status)
  values(p_asset_id,v_profile.id,v_profile.id,p_fair_price,p_price,'listed')
  returning id into v_id;

  insert into public.npc_market_log(virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score)
  values(v_id,p_asset_id,v_profile.id,p_fair_price,p_price,p_pricing_mode,p_rarity_score);

  perform public.mark_gift_genesis_released_v0655(p_asset_id,v_id,now());
  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount)
  values(v_profile.id,'listing',v_id,p_price);
  return v_id;
end;
$$;
