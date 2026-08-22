begin;

-- Idempotent production repair for databases where earlier auth hotfixes were
-- applied manually or migration 030 was already recorded before its contract
-- was corrected.
alter table public.profiles
  add column if not exists xp bigint not null default 0,
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists banned_until timestamptz,
  add column if not exists last_gift_sync_at timestamptz;

alter table public.gift_assets
  add column if not exists is_burned boolean not null default false,
  add column if not exists telegram_resale_price_ton numeric(24,9),
  add column if not exists resale_seen_at timestamptz,
  add column if not exists model_media_url text,
  add column if not exists model_preview_url text,
  add column if not exists symbol_media_url text;

alter table public.virtual_gifts
  add column if not exists listed_at timestamptz,
  add column if not exists listing_updated_at timestamptz,
  add column if not exists listing_expires_at timestamptz;

create or replace view public.profile_financial_overview with (security_invoker=true) as
with holding_value as (
  select h.profile_id,coalesce(sum(h.quantity*c.current_price),0) as coin_value
  from public.holdings h join public.coins c on c.id=h.coin_id
  where h.quantity>0 group by h.profile_id
), gift_value as (
  select vg.owner_profile_id as profile_id,
    coalesce(sum(coalesce(
      case when ga.telegram_resale_price_ton is not null and ga.telegram_resale_price_ton>0
        and (ga.resale_seen_at is null or ga.resale_seen_at>=now()-interval '24 hours')
        then ga.telegram_resale_price_ton end,
      vg.last_sale_price,vg.acquired_price,0
    )),0) as gift_value
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id=vg.asset_id
  where coalesce(ga.is_burned,false)=false
  group by vg.owner_profile_id
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
  where coalesce(ga.is_burned,false)=false group by vg.owner_profile_id
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
left join gift_value g on g.profile_id=p.id
left join coin_stats cs on cs.profile_id=p.id
left join gift_sell_stats gs on gs.profile_id=p.id
left join gift_trade_stats gt on gt.profile_id=p.id
left join gift_counts gc on gc.profile_id=p.id
left join creator_caps cc on cc.profile_id=p.id;

grant select on public.profile_financial_overview to service_role;

create or replace function public.sync_telegram_profile(
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_photo_url text
)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles;
begin
  insert into public.profiles(telegram_id,username,first_name,last_name,photo_url)
  values (
    p_telegram_id,
    nullif(trim(coalesce(p_username,'')),''),
    coalesce(nullif(trim(coalesce(p_first_name,'')),''),'Telegram User'),
    nullif(trim(coalesce(p_last_name,'')),''),
    nullif(trim(coalesce(p_photo_url,'')),'')
  )
  on conflict (telegram_id) do update set
    username=excluded.username,
    first_name=excluded.first_name,
    last_name=excluded.last_name,
    photo_url=excluded.photo_url,
    updated_at=now()
  returning * into v_profile;

  perform public.ensure_user_missions(v_profile.id);
  perform public.bump_mission(v_profile.id,'open_app',1);
  return v_profile;
end;
$$;

revoke execute on function public.sync_telegram_profile(bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.sync_telegram_profile(bigint,text,text,text,text) to service_role;

-- Fail the deploy loudly if a required production contract is still missing.
do $$
declare missing text;
begin
  select string_agg(x,', ' order by x) into missing
  from (
    select 'gift_market_overview.model_preview_url' x where not exists (
      select 1 from information_schema.columns where table_schema='public' and table_name='gift_market_overview' and column_name='model_preview_url'
    )
    union all select 'gift_market_overview.listing_expires_at' where not exists (
      select 1 from information_schema.columns where table_schema='public' and table_name='gift_market_overview' and column_name='listing_expires_at'
    )
    union all select 'leaderboard.coin_realized_pnl' where not exists (
      select 1 from information_schema.columns where table_schema='public' and table_name='leaderboard' and column_name='coin_realized_pnl'
    )
    union all select 'leaderboard.gift_realized_pnl' where not exists (
      select 1 from information_schema.columns where table_schema='public' and table_name='leaderboard' and column_name='gift_realized_pnl'
    )
  ) q;
  if missing is not null then
    raise exception 'MXM production schema contract is incomplete: %', missing;
  end if;
end $$;

commit;
