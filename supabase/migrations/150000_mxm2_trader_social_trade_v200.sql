begin;

create table if not exists public.gift_trade_offers_v200 (
  id uuid primary key default gen_random_uuid(),
  sender_profile_id uuid not null references public.profiles(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  offered_gift_id uuid not null references public.virtual_gifts(id) on delete cascade,
  requested_gift_id uuid not null references public.virtual_gifts(id) on delete cascade,
  topup_amount numeric not null default 0 check (topup_amount >= 0 and topup_amount <= 1000000000),
  status text not null default 'active' check (status in ('active','accepted','declined','cancelled','expired')),
  note text null check (note is null or char_length(note) <= 240),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_profile_id <> recipient_profile_id),
  check (offered_gift_id <> requested_gift_id)
);

create unique index if not exists gift_trade_offers_v200_one_active_offered_idx
  on public.gift_trade_offers_v200(offered_gift_id) where status='active';
create index if not exists gift_trade_offers_v200_sender_idx
  on public.gift_trade_offers_v200(sender_profile_id,status,created_at desc);
create index if not exists gift_trade_offers_v200_recipient_idx
  on public.gift_trade_offers_v200(recipient_profile_id,status,created_at desc);
create index if not exists gift_trade_offers_v200_requested_idx
  on public.gift_trade_offers_v200(requested_gift_id,status,created_at desc);

alter table public.gift_trade_offers_v200 enable row level security;
revoke all on public.gift_trade_offers_v200 from anon, authenticated;

create or replace view public.profile_collector_scores_v200 as
with owned as (
  select
    vg.owner_profile_id as profile_id,
    count(*)::bigint as gift_count,
    count(distinct ga.base_name)::bigint as unique_collections,
    count(*) filter (where least(ga.model_rarity_per_mille,ga.backdrop_rarity_per_mille,ga.symbol_rarity_per_mille) <= 10)::bigint as rare_gift_count,
    avg(
      100.0 * (1.0 - exp((
        ln(greatest(ga.model_rarity_per_mille,1)::numeric/1000.0)
        + ln(greatest(ga.backdrop_rarity_per_mille,1)::numeric/1000.0)
        + ln(greatest(ga.symbol_rarity_per_mille,1)::numeric/1000.0)
      ) / 3.0))
    ) as avg_rarity_score,
    coalesce(sum(coalesce(
      case when ga.telegram_resale_price_ton is not null and ga.telegram_resale_price_ton > 0
        and (ga.resale_seen_at is null or ga.resale_seen_at >= now()-interval '24 hours') then ga.telegram_resale_price_ton end,
      vg.last_sale_price,vg.acquired_price,0
    )),0) as collection_value
  from public.virtual_gifts vg
  join public.gift_assets ga on ga.id=vg.asset_id
  where coalesce(ga.is_burned,false)=false
  group by vg.owner_profile_id
), activity as (
  select p.id as profile_id,
    coalesce(a.gift_trade_count,0)::numeric as gift_trade_count
  from public.profiles p
  left join public.profile_activity_totals_v074 a on a.profile_id=p.id
), scored as (
  select
    o.profile_id,o.gift_count,o.unique_collections,o.rare_gift_count,
    round(coalesce(o.avg_rarity_score,0),1) as avg_rarity_score,
    round(o.collection_value,8) as collection_value,
    least(100.0,greatest(0.0,
      24.0 * least(1.0,ln(1+o.gift_count::numeric)/ln(51::numeric))
      + 22.0 * least(1.0,ln(1+o.unique_collections::numeric)/ln(21::numeric))
      + 28.0 * coalesce(o.avg_rarity_score,0)/100.0
      + 16.0 * least(1.0,ln(1+o.collection_value)/ln(10001::numeric))
      + 10.0 * least(1.0,ln(1+coalesce(a.gift_trade_count,0))/ln(101::numeric))
    )) as collector_score
  from owned o
  left join activity a on a.profile_id=o.profile_id
)
select
  s.*,
  rank() over(order by s.collector_score desc,s.collection_value desc,s.gift_count desc)::integer as collector_rank
from scored s;

create or replace function public.trader_profile_stats_v200(p_profile_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public','pg_temp'
as $$
  with gift_stats as (
    select
      count(*) filter (where seller_profile_id=p_profile_id)::int as gift_sales,
      count(*) filter (where seller_profile_id=p_profile_id and realized_pnl>0)::int as gift_wins,
      coalesce(sum(price) filter (where buyer_profile_id=p_profile_id or seller_profile_id=p_profile_id),0) as gift_volume
    from public.gift_trades
  ), coin_stats as (
    select
      count(*) filter (where profile_id=p_profile_id and side='sell' and not coalesce(is_launch_seed,false))::int as coin_sells,
      count(*) filter (where profile_id=p_profile_id and side='sell' and realized_pnl>0 and not coalesce(is_launch_seed,false))::int as coin_wins,
      coalesce(sum(quote_amount) filter (where profile_id=p_profile_id and not coalesce(is_launch_seed,false)),0) as coin_volume
    from public.trades
  ), collector as (
    select * from public.profile_collector_scores_v200 where profile_id=p_profile_id
  ), totals as (
    select * from public.profile_activity_totals_v074 where profile_id=p_profile_id
  )
  select jsonb_build_object(
    'tradeCount',coalesce((select coin_trade_count+gift_trade_count from totals),0),
    'tradeVolume',coalesce((select trade_volume from totals),0),
    'giftTradeVolume',coalesce((select gift_volume from gift_stats),0),
    'coinTradeVolume',coalesce((select coin_volume from coin_stats),0),
    'closedTrades',coalesce((select gift_sales from gift_stats),0)+coalesce((select coin_sells from coin_stats),0),
    'winningTrades',coalesce((select gift_wins from gift_stats),0)+coalesce((select coin_wins from coin_stats),0),
    'winRate',case when coalesce((select gift_sales from gift_stats),0)+coalesce((select coin_sells from coin_stats),0)>0 then
      round(100.0*(coalesce((select gift_wins from gift_stats),0)+coalesce((select coin_wins from coin_stats),0))
        /(coalesce((select gift_sales from gift_stats),0)+coalesce((select coin_sells from coin_stats),0)),1) else 0 end,
    'activeDays',coalesce((select active_days from totals),0),
    'lastActivityAt',(select last_activity_at from totals),
    'collectorScore',coalesce((select collector_score from collector),0),
    'collectorRank',(select collector_rank from collector),
    'giftCount',coalesce((select gift_count from collector),0),
    'uniqueCollections',coalesce((select unique_collections from collector),0),
    'rareGiftCount',coalesce((select rare_gift_count from collector),0),
    'avgRarityScore',coalesce((select avg_rarity_score from collector),0),
    'collectionValue',coalesce((select collection_value from collector),0)
  );
$$;

create or replace function public.leaderboard_snapshot_v200(p_profile_id uuid,p_board text default 'overall',p_limit integer default 100)
returns jsonb
language sql
stable security definer
set search_path to 'public','pg_temp'
as $$
  with params as (
    select case when p_board in ('overall','pnl','giftPnl','coinPnl','gifts','coins') then p_board else 'overall' end as board,
      greatest(5,least(coalesce(p_limit,100),100)) as row_limit
  ), base as materialized (
    select f.id,f.username,f.first_name,f.photo_url,p.equipped_profile_frame,
      coalesce(f.balance,0) balance,coalesce(f.coin_value,0) coin_value,coalesce(f.gift_value,0) gift_value,
      coalesce(f.net_worth,0) net_worth,coalesce(f.realized_pnl,0) realized_pnl,
      coalesce(f.coin_realized_pnl,0) coin_realized_pnl,coalesce(f.gift_realized_pnl,0) gift_realized_pnl,
      coalesce(f.coin_trade_count,0) coin_trade_count,coalesce(f.gift_trade_count,0) gift_trade_count,
      coalesce(f.gift_count,0) gift_count,coalesce(f.created_coin_market_cap,0) created_coin_market_cap,
      coalesce(c.collector_score,0) collector_score,coalesce(c.unique_collections,0) unique_collections,
      coalesce(c.rare_gift_count,0) rare_gift_count
    from public.profile_financial_overview f
    join public.profiles p on p.id=f.id
    left join public.profile_collector_scores_v200 c on c.profile_id=f.id
    where coalesce(p.is_system,false)=false and coalesce(p.hidden_from_leaderboard,false)=false
      and not (coalesce(p.is_banned,false)=true and (p.banned_until is null or p.banned_until>now()))
  ), scored as (
    select b.*,case (select board from params)
      when 'pnl' then b.realized_pnl when 'giftPnl' then b.gift_realized_pnl when 'coinPnl' then b.coin_realized_pnl
      when 'gifts' then b.collector_score when 'coins' then b.created_coin_market_cap else b.net_worth end as score
    from base b
  ), ranked as (
    select s.*,rank() over(order by s.score desc,s.id asc)::integer as rank,
      row_number() over(order by s.score desc,s.id asc)::integer as position from scored s
  )
  select jsonb_build_object(
    'players',coalesce((select jsonb_agg(to_jsonb(r)-'score'-'position' order by r.position) from ranked r cross join params p where r.position<=p.row_limit),'[]'::jsonb),
    'meRank',(select rank from ranked where id=p_profile_id limit 1)
  );
$$;

create or replace function public.reserved_market_balance_v056(
  p_profile_id uuid,
  p_exclude_virtual_gift_id uuid default null,
  p_exclude_advanced_offer_id uuid default null,
  p_exclude_coin_order_id uuid default null
)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $$
  select
    coalesce((select sum(amount) from public.gift_offers where buyer_profile_id=p_profile_id and status='pending'
      and (expires_at is null or expires_at>now()) and (p_exclude_virtual_gift_id is null or virtual_gift_id<>p_exclude_virtual_gift_id)),0)
    + coalesce((select sum(amount*greatest(0,max_fills-filled_count)) from public.advanced_gift_offers_v056
      where buyer_profile_id=p_profile_id and status='active' and expires_at>now()
      and (p_exclude_advanced_offer_id is null or id<>p_exclude_advanced_offer_id)),0)
    + coalesce((select sum(input_amount) from public.coin_conditional_orders_v056
      where profile_id=p_profile_id and kind='limit_buy' and status='active' and expires_at>now()
      and (p_exclude_coin_order_id is null or id<>p_exclude_coin_order_id)),0)
    + coalesce((select sum(topup_amount) from public.gift_trade_offers_v200
      where sender_profile_id=p_profile_id and status='active' and expires_at>now()),0);
$$;

create or replace function public.create_gift_trade_offer_v200(
  p_sender_id uuid,p_requested_gift_id uuid,p_offered_gift_id uuid,p_topup_amount numeric default 0,
  p_duration_hours integer default 72,p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_requested public.virtual_gifts;
  v_offered public.virtual_gifts;
  v_recipient uuid;
  v_balance numeric;
  v_reserved numeric;
  v_offer public.gift_trade_offers_v200;
begin
  if p_sender_id is null or p_requested_gift_id is null or p_offered_gift_id is null then raise exception 'Invalid trade offer'; end if;
  if p_requested_gift_id=p_offered_gift_id then raise exception 'Choose two different gifts'; end if;
  if coalesce(p_topup_amount,0)<0 then raise exception 'Invalid topup amount'; end if;
  if coalesce(p_duration_hours,72)<1 or coalesce(p_duration_hours,72)>336 then raise exception 'Invalid duration'; end if;

  perform 1 from public.virtual_gifts where id in (p_requested_gift_id,p_offered_gift_id) order by id for update;
  select * into v_requested from public.virtual_gifts where id=p_requested_gift_id;
  select * into v_offered from public.virtual_gifts where id=p_offered_gift_id;
  if v_requested.id is null or v_offered.id is null then raise exception 'Gift not found'; end if;
  if v_offered.owner_profile_id<>p_sender_id then raise exception 'You no longer own the offered gift'; end if;
  v_recipient:=v_requested.owner_profile_id;
  if v_recipient=p_sender_id then raise exception 'You already own the requested gift'; end if;
  if exists(select 1 from public.gift_assets where id in (v_requested.asset_id,v_offered.asset_id) and is_burned=true) then raise exception 'Burned gifts cannot be traded'; end if;

  perform 1 from public.profiles where id=p_sender_id for update;
  select balance into v_balance from public.profiles where id=p_sender_id;
  v_reserved:=public.reserved_market_balance_v056(p_sender_id,null,null,null);
  if v_balance-v_reserved<coalesce(p_topup_amount,0) then raise exception 'Insufficient available balance for topup'; end if;

  update public.gift_trade_offers_v200 set status='expired',resolved_at=now(),updated_at=now()
    where status='active' and expires_at<=now() and (sender_profile_id=p_sender_id or offered_gift_id=p_offered_gift_id);

  insert into public.gift_trade_offers_v200(sender_profile_id,recipient_profile_id,offered_gift_id,requested_gift_id,topup_amount,note,expires_at)
  values(p_sender_id,v_recipient,p_offered_gift_id,p_requested_gift_id,round(coalesce(p_topup_amount,0),8),nullif(btrim(p_note),''),now()+make_interval(hours=>p_duration_hours))
  returning * into v_offer;

  insert into public.activity_events_v074(dedupe_key,actor_profile_id,kind,importance,visibility,audience_profile_id,virtual_gift_id,amount,metadata)
  values('trade_offer_created:'||v_offer.id,p_sender_id,'trade_offer_created',45,'public',v_recipient,p_requested_gift_id,v_offer.topup_amount,
    jsonb_build_object('offerId',v_offer.id,'offeredGiftId',p_offered_gift_id,'requestedGiftId',p_requested_gift_id));

  return jsonb_build_object('id',v_offer.id,'status',v_offer.status,'recipientProfileId',v_recipient,'expiresAt',v_offer.expires_at,'topupAmount',v_offer.topup_amount);
end;
$$;

create or replace function public.resolve_gift_trade_offer_v200(p_actor_id uuid,p_offer_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_offer public.gift_trade_offers_v200;
  v_offered public.virtual_gifts;
  v_requested public.virtual_gifts;
  v_sender_balance numeric;
  v_reserved numeric;
begin
  select * into v_offer from public.gift_trade_offers_v200 where id=p_offer_id for update;
  if not found then raise exception 'Trade offer not found'; end if;
  if v_offer.status<>'active' then raise exception 'Trade offer is no longer active'; end if;
  if v_offer.expires_at<=now() then
    update public.gift_trade_offers_v200 set status='expired',resolved_at=now(),updated_at=now() where id=v_offer.id;
    raise exception 'Trade offer expired';
  end if;

  if p_action='cancel' then
    if p_actor_id<>v_offer.sender_profile_id then raise exception 'Only sender can cancel'; end if;
    update public.gift_trade_offers_v200 set status='cancelled',resolved_at=now(),updated_at=now() where id=v_offer.id;
    return jsonb_build_object('id',v_offer.id,'status','cancelled');
  elsif p_action='decline' then
    if p_actor_id<>v_offer.recipient_profile_id then raise exception 'Only recipient can decline'; end if;
    update public.gift_trade_offers_v200 set status='declined',resolved_at=now(),updated_at=now() where id=v_offer.id;
    return jsonb_build_object('id',v_offer.id,'status','declined');
  elsif p_action<>'accept' then
    raise exception 'Invalid action';
  end if;
  if p_actor_id<>v_offer.recipient_profile_id then raise exception 'Only recipient can accept'; end if;

  perform 1 from public.profiles where id in (v_offer.sender_profile_id,v_offer.recipient_profile_id) order by id for update;
  perform 1 from public.virtual_gifts where id in (v_offer.offered_gift_id,v_offer.requested_gift_id) order by id for update;
  select * into v_offered from public.virtual_gifts where id=v_offer.offered_gift_id;
  select * into v_requested from public.virtual_gifts where id=v_offer.requested_gift_id;
  if v_offered.owner_profile_id<>v_offer.sender_profile_id then raise exception 'Sender no longer owns offered gift'; end if;
  if v_requested.owner_profile_id<>v_offer.recipient_profile_id then raise exception 'Recipient no longer owns requested gift'; end if;
  if exists(select 1 from public.gift_assets where id in (v_requested.asset_id,v_offered.asset_id) and is_burned=true) then raise exception 'Burned gifts cannot be traded'; end if;

  select balance into v_sender_balance from public.profiles where id=v_offer.sender_profile_id;
  v_reserved:=greatest(0,public.reserved_market_balance_v056(v_offer.sender_profile_id,null,null,null)-v_offer.topup_amount);
  if v_sender_balance-v_reserved<v_offer.topup_amount then raise exception 'Sender has insufficient available balance'; end if;

  if v_offer.topup_amount>0 then
    update public.profiles set balance=balance-v_offer.topup_amount where id=v_offer.sender_profile_id;
    update public.profiles set balance=balance+v_offer.topup_amount where id=v_offer.recipient_profile_id;
  end if;

  update public.virtual_gifts set owner_profile_id=v_offer.recipient_profile_id,listing_price=null,status='owned',listing_expires_at=null,listing_updated_at=now(),updated_at=now()
    where id=v_offer.offered_gift_id;
  update public.virtual_gifts set owner_profile_id=v_offer.sender_profile_id,listing_price=null,status='owned',listing_expires_at=null,listing_updated_at=now(),updated_at=now()
    where id=v_offer.requested_gift_id;

  update public.gift_offers set status='rejected',updated_at=now() where status='pending' and virtual_gift_id in (v_offer.offered_gift_id,v_offer.requested_gift_id);
  delete from public.market_cart_items where virtual_gift_id in (v_offer.offered_gift_id,v_offer.requested_gift_id);
  update public.gift_trade_offers_v200 set status='cancelled',resolved_at=now(),updated_at=now()
    where id<>v_offer.id and status='active' and (offered_gift_id in (v_offer.offered_gift_id,v_offer.requested_gift_id) or requested_gift_id in (v_offer.offered_gift_id,v_offer.requested_gift_id));
  update public.gift_trade_offers_v200 set status='accepted',resolved_at=now(),updated_at=now() where id=v_offer.id;

  insert into public.activity_events_v074(dedupe_key,actor_profile_id,kind,importance,visibility,audience_profile_id,virtual_gift_id,amount,metadata)
  values('trade_swap:'||v_offer.id,v_offer.sender_profile_id,'trade_swap',75,'public',v_offer.recipient_profile_id,v_offer.requested_gift_id,v_offer.topup_amount,
    jsonb_build_object('offerId',v_offer.id,'offeredGiftId',v_offer.offered_gift_id,'requestedGiftId',v_offer.requested_gift_id,'recipientProfileId',v_offer.recipient_profile_id));

  perform public.bump_mission(v_offer.sender_profile_id,'gift_trade',1);
  perform public.bump_mission(v_offer.recipient_profile_id,'gift_trade',1);
  return jsonb_build_object('id',v_offer.id,'status','accepted','topupAmount',v_offer.topup_amount,'offeredGiftId',v_offer.offered_gift_id,'requestedGiftId',v_offer.requested_gift_id);
end;
$$;

grant execute on function public.trader_profile_stats_v200(uuid) to service_role;
grant execute on function public.leaderboard_snapshot_v200(uuid,text,integer) to service_role;
grant execute on function public.create_gift_trade_offer_v200(uuid,uuid,uuid,numeric,integer,text) to service_role;
grant execute on function public.resolve_gift_trade_offer_v200(uuid,uuid,text) to service_role;

commit;
