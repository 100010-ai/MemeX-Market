begin;

-- MXM v0.16 repair — re-apply authoritative TON pricing/media schema safely.
-- This migration intentionally mirrors v0.14 so deployments that skipped 015 can
-- recover by applying this single latest migration. All DDL is idempotent/replacing.
--
-- v0.13 correctly imported real Telegram Gift NFT identities, but the initial
-- system listings still used a synthetic rarity formula. v0.14 removes that
-- pricing path completely. A system Gift is listed only when TonAPI exposes a
-- live sale for the exact NFT in the native TON currency. Non-native Jetton
-- prices are intentionally ignored so GRAM/other assets can never be mislabeled
-- as TON.

alter table public.gift_assets add column if not exists model_preview_url text;

create index if not exists gift_assets_tonapi_live_price_idx
  on public.gift_assets(telegram_resale_price_ton)
  where catalog_source='tonapi'
    and is_burned=false
    and telegram_resale_price_ton is not null;

-- Re-open the finite pool once so newly observed live-priced TonAPI assets can
-- enter it after this migration. Already released assets are never duplicated.
update public.gift_genesis_state
set completed_at=null, updated_at=now()
where singleton=true;

-- Old v0.13 system/NPC listings must not remain visible at synthetic prices.
-- Reprice exact live TON listings and hide any system Gift for which no native
-- TON sale is currently observed.
update public.virtual_gifts vg
set listing_price=ga.telegram_resale_price_ton,
    acquired_price=ga.telegram_resale_price_ton,
    status='listed'
from public.gift_assets ga, public.profiles p
where vg.asset_id=ga.id
  and p.id=vg.owner_profile_id
  and p.is_system=true
  and ga.is_burned=false
  and ga.telegram_resale_price_ton is not null
  and ga.telegram_resale_price_ton>0;

update public.virtual_gifts vg
set listing_price=null,
    status='owned'
from public.gift_assets ga, public.profiles p
where vg.asset_id=ga.id
  and p.id=vg.owner_profile_id
  and p.is_system=true
  and (ga.is_burned=true or ga.telegram_resale_price_ton is null);

-- Keep the internal audit row aligned with the authoritative external price for
-- listings that are still held by a system profile.
update public.npc_market_log log
set fair_price=ga.telegram_resale_price_ton,
    listing_price=ga.telegram_resale_price_ton,
    pricing_mode='normal'
from public.virtual_gifts vg, public.gift_assets ga, public.profiles p
where log.virtual_gift_id=vg.id
  and vg.asset_id=ga.id
  and p.id=vg.owner_profile_id
  and p.is_system=true
  and ga.telegram_resale_price_ton is not null
  and ga.telegram_resale_price_ton>0;

-- Called by the server after every TonAPI sync. This makes stale external
-- listings disappear and updates changed prices without manufacturing a floor.
create or replace function public.reconcile_npc_external_prices()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_repriced integer := 0;
  v_hidden integer := 0;
begin
  update public.virtual_gifts vg
  set listing_price=ga.telegram_resale_price_ton,
      acquired_price=case when vg.last_sale_price is null then ga.telegram_resale_price_ton else vg.acquired_price end,
      status='listed'
  from public.gift_assets ga, public.profiles p
  where vg.asset_id=ga.id
    and p.id=vg.owner_profile_id
    and p.is_system=true
    and ga.is_burned=false
    and ga.telegram_resale_price_ton is not null
    and ga.telegram_resale_price_ton>0
    and (
      vg.status<>'listed'
      or vg.listing_price is distinct from ga.telegram_resale_price_ton
    );
  get diagnostics v_repriced = row_count;

  update public.virtual_gifts vg
  set listing_price=null,
      status='owned'
  from public.gift_assets ga, public.profiles p
  where vg.asset_id=ga.id
    and p.id=vg.owner_profile_id
    and p.is_system=true
    and vg.status='listed'
    and (ga.is_burned=true or ga.telegram_resale_price_ton is null);
  get diagnostics v_hidden = row_count;

  return jsonb_build_object('repriced',v_repriced,'hidden',v_hidden);
end;
$$;

revoke execute on function public.reconcile_npc_external_prices() from public,anon,authenticated;
grant execute on function public.reconcile_npc_external_prices() to service_role;

-- Pool initialization now admits only assets with an observed native-TON sale.
-- Unreleased rows that lost their external sale are removed from the queue.
create or replace function public.initialize_gift_genesis_pool()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_seed text;
  v_started timestamptz;
  v_completed timestamptz;
  v_total integer;
  v_released integer;
begin
  select seed,started_at,completed_at into v_seed,v_started,v_completed
  from public.gift_genesis_state where singleton=true for update;

  delete from public.gift_genesis_pool gp
  using public.gift_assets ga
  where gp.asset_id=ga.id
    and gp.released_at is null
    and (ga.is_burned=true or ga.telegram_resale_price_ton is null);

  if v_completed is null then
    insert into public.gift_genesis_pool(asset_id,release_key,rarity_tier)
    select
      ga.id,
      md5(v_seed || ':' || ga.id::text),
      case
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille) <= 5 then 'legendary'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille) <= 20 then 'epic'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille) <= 60 then 'rare'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille) <= 180 then 'uncommon'
        else 'common'
      end
    from public.gift_assets ga
    where ga.catalog_source in ('bot_catalog','tonapi')
      and ga.is_burned=false
      and ga.telegram_name is not null
      and ga.telegram_resale_price_ton is not null
      and ga.telegram_resale_price_ton>0
      and (
        (ga.catalog_source='bot_catalog' and ga.model_file_id is not null and ga.symbol_file_id is not null)
        or
        (ga.catalog_source='tonapi' and ga.chain_verified=true and ga.model_media_url is not null)
      )
    on conflict(asset_id) do nothing;

    if v_started is null then
      update public.gift_genesis_state set started_at=now(),updated_at=now() where singleton=true;
    end if;
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
      completed_at=case when v_total>0 and v_released>=v_total then coalesce(completed_at,now()) else null end,
      updated_at=now()
  where singleton=true;

  return jsonb_build_object(
    'total',v_total,
    'released',v_released,
    'remaining',greatest(0,v_total-v_released),
    'completed',v_total>0 and v_released>=v_total,
    'seed',v_seed
  );
end;
$$;

-- Keep the existing RPC return shape for application compatibility, but only
-- return candidates that still have a live observed TON price.
create or replace function public.genesis_market_candidates(p_limit integer default 24)
returns table(
  asset_id uuid,
  base_name text,
  gift_number integer,
  model_rarity_per_mille integer,
  symbol_rarity_per_mille integer,
  backdrop_rarity_per_mille integer,
  last_seen_at timestamptz,
  rarity_tier text,
  release_key text
) language sql security definer set search_path=public stable as $$
  with ranked as (
    select
      ga.id as asset_id,
      ga.base_name,
      ga.gift_number,
      ga.model_rarity_per_mille,
      ga.symbol_rarity_per_mille,
      ga.backdrop_rarity_per_mille,
      ga.last_seen_at,
      gp.rarity_tier,
      gp.release_key,
      row_number() over(partition by gp.rarity_tier order by gp.release_key) as tier_row,
      case gp.rarity_tier
        when 'common' then 1
        when 'uncommon' then 2
        when 'rare' then 3
        when 'epic' then 4
        else 5
      end as tier_order
    from public.gift_genesis_pool gp
    join public.gift_assets ga on ga.id=gp.asset_id
    where gp.released_at is null
      and ga.is_burned=false
      and ga.telegram_resale_price_ton is not null
      and ga.telegram_resale_price_ton>0
      and not exists(select 1 from public.virtual_gifts vg where vg.asset_id=ga.id)
  )
  select asset_id,base_name,gift_number,model_rarity_per_mille,symbol_rarity_per_mille,
         backdrop_rarity_per_mille,last_seen_at,rarity_tier,release_key
  from ranked
  order by tier_row,tier_order,release_key
  limit greatest(1,least(coalesce(p_limit,24),1000));
$$;

-- The database is authoritative about the listing price. p_price and
-- p_fair_price remain in the signature only for backwards compatibility.
create or replace function public.npc_seed_virtual_gift(
  p_asset_id uuid,
  p_price numeric,
  p_fair_price numeric,
  p_rarity_score numeric,
  p_pricing_mode text,
  p_desk integer default 0
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_asset public.gift_assets;
  v_profile public.profiles;
  v_id uuid;
  v_existing_owner uuid;
  v_existing_system boolean;
  v_observed numeric;
begin
  if p_rarity_score is null or p_rarity_score<0 or p_rarity_score>1 then raise exception 'Invalid NPC rarity score'; end if;

  select * into v_asset from public.gift_assets where id=p_asset_id for update;
  if not found then raise exception 'Gift asset not found'; end if;
  if v_asset.catalog_source not in ('bot_catalog','tonapi') then raise exception 'NPC can list only verified Telegram catalogue assets'; end if;
  if v_asset.catalog_source='tonapi' and not v_asset.chain_verified then raise exception 'Unverified TON NFT cannot enter Genesis'; end if;
  if v_asset.is_burned then raise exception 'Burned Gift cannot be listed'; end if;

  v_observed := v_asset.telegram_resale_price_ton;
  if v_observed is null or v_observed<=0 or v_observed>1000000 then
    raise exception 'Observed native TON listing price is required';
  end if;

  select vg.id,vg.owner_profile_id,p.is_system
  into v_id,v_existing_owner,v_existing_system
  from public.virtual_gifts vg
  join public.profiles p on p.id=vg.owner_profile_id
  where vg.asset_id=p_asset_id
  limit 1;

  if v_id is not null then
    if v_existing_system then
      update public.virtual_gifts
      set acquired_price=case when last_sale_price is null then v_observed else acquired_price end,
          listing_price=v_observed,
          status='listed'
      where id=v_id;
    end if;
    update public.gift_genesis_pool set virtual_gift_id=v_id,released_at=coalesce(released_at,now()) where asset_id=p_asset_id;
    return v_id;
  end if;

  v_profile := public.ensure_npc_market_maker(p_desk);
  insert into public.virtual_gifts(asset_id,source_owner_profile_id,owner_profile_id,acquired_price,listing_price,status)
  values(p_asset_id,v_profile.id,v_profile.id,v_observed,v_observed,'listed')
  returning id into v_id;

  insert into public.npc_market_log(virtual_gift_id,asset_id,npc_profile_id,fair_price,listing_price,pricing_mode,rarity_score)
  values(v_id,p_asset_id,v_profile.id,v_observed,v_observed,'normal',p_rarity_score);

  update public.gift_genesis_pool set virtual_gift_id=v_id,released_at=now() where asset_id=p_asset_id;
  insert into public.market_events(actor_profile_id,kind,virtual_gift_id,amount)
  values(v_profile.id,'listing',v_id,v_observed);
  return v_id;
end;
$$;

revoke execute on function public.initialize_gift_genesis_pool() from public,anon,authenticated;
revoke execute on function public.genesis_market_candidates(integer) from public,anon,authenticated;
revoke execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) from public,anon,authenticated;
grant execute on function public.initialize_gift_genesis_pool() to service_role;
grant execute on function public.genesis_market_candidates(integer) to service_role;
grant execute on function public.npc_seed_virtual_gift(uuid,numeric,numeric,numeric,text,integer) to service_role;

-- Surface a separate static preview alongside the animated media URL. Existing
-- view columns stay in exactly the same order; the new column is appended so
-- dependent RPCs and client selects remain compatible.
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
    when ((cf.v is not null)::int+(mf.v is not null)::int+(bf.v is not null)::int+(sf.v is not null)::int+(ls.v is not null)::int)=0 then ga.telegram_resale_price_ton
    else coalesce(
      ga.telegram_resale_price_ton,
      (coalesce(cf.v,0)+coalesce(mf.v,0)+coalesce(bf.v,0)+coalesce(sf.v,0)+coalesce(ls.v,0)) /
      nullif(((cf.v is not null)::int+(mf.v is not null)::int+(bf.v is not null)::int+(sf.v is not null)::int+(ls.v is not null)::int),0)
    )
  end as estimated_value,
  os.best_offer,coalesce(os.offer_count,0)::bigint as offer_count,
  ga.catalog_source,ga.source_reference,ga.telegram_resale_price_ton,ga.resale_seen_at,
  ga.model_media_url,ga.symbol_media_url,
  ga.model_preview_url
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

commit;
