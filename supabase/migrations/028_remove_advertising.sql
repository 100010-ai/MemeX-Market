begin;

-- Advertising was removed from the product. Historical migrations and generic
-- economy ledger rows remain immutable; all current entry points and settings
-- are removed here after migration 027.

-- Sponsored campaigns and their notification hook.
do $teardown$
begin
  if to_regclass('public.sponsored_task_claims') is not null then
    execute 'drop trigger if exists sponsored_claims_notify_v048 on public.sponsored_task_claims';
  end if;
end
$teardown$;
drop function if exists public.notify_sponsored_claim_v048();
drop function if exists public.claim_sponsored_campaign_v047(uuid,uuid,text);
drop table if exists public.sponsored_task_claims;
drop table if exists public.sponsored_campaigns;

-- Rewarded advertising sessions and every server/client claim function.
drop function if exists public.rewarded_ad_status_v044(uuid);
drop function if exists public.create_rewarded_ad_session_v044(uuid,text);
drop function if exists public.claim_rewarded_ad_session_v044(uuid,uuid);
drop function if exists public.rewarded_ad_status_v045(uuid);
drop function if exists public.create_rewarded_ad_session_v045(uuid,text);
drop function if exists public.claim_rewarded_ad_session_client_v045(uuid,uuid);
drop function if exists public.claim_rewarded_ad_by_telegram_v045(bigint);
drop function if exists public.finalize_rewarded_ad_v045(uuid,text);
drop table if exists public.rewarded_ad_sessions;

-- Preserve immutable historical ledger rows while rejecting every new
-- advertising-labelled economy/referral event after this terminal migration.
alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events add constraint economy_events_kind_v028_check check(kind in (
  'coin_launch','coin_trade_fee','coin_creator_fee','coin_platform_fee','mission',
  'admin','system','stars','store','case','season','premium','referral',
  'promo_code','collection_bonus'
)) not valid;
alter table public.referral_rewards drop constraint if exists referral_rewards_source_kind_check;
alter table public.referral_rewards drop constraint if exists referral_rewards_source_kind_v200_check;
alter table public.referral_rewards add constraint referral_rewards_source_kind_v028_check
  check(source_kind in ('mission','stars','store')) not valid;

-- The old updater required advertising arguments, so the API now performs a
-- validated service-role update of the remaining economy settings.
drop function if exists public.update_economy_settings_v045(numeric,integer,integer,numeric,integer,integer,integer);
alter table public.economy_settings drop column if exists rewarded_ad_reward;
alter table public.economy_settings drop column if exists rewarded_ad_daily_limit;
alter table public.economy_settings drop column if exists rewarded_ad_cooldown_minutes;

-- Remove retired remote switches from both current rows and future defaults.
update public.runtime_config_v056
set feature_flags = feature_flags - 'rewardedAds' - 'sponsoredTasks',
    updated_at = now()
where singleton = true;
alter table public.runtime_config_v056 alter column feature_flags
  set default '{"gifts":true,"memecoins":true,"referrals":true,"stars":true}'::jsonb;

-- Keep historical notification rows, but remove the preference and prevent new
-- advertising-task notifications. NOT VALID preserves old rows while enforcing
-- the reduced kind set for every new or updated row.
alter table public.notification_preferences drop column if exists sponsored_task;
alter table public.user_notifications drop constraint if exists user_notifications_kind_check;
alter table public.user_notifications add constraint user_notifications_kind_v028_check
  check(kind in ('gift_sold','gift_offer','offer_resolved','price_alert','coin_move','referral_reward','promo','system')) not valid;

create or replace function public.push_notification_v048(
  p_profile_id uuid,
  p_kind text,
  p_title text,
  p_body text default '',
  p_href text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_enabled boolean:=true;
begin
  if p_profile_id is null then return null; end if;
  select case p_kind
    when 'gift_sold' then gift_sold
    when 'gift_offer' then gift_offer
    when 'offer_resolved' then offer_resolved
    when 'price_alert' then price_alert
    when 'coin_move' then coin_move
    when 'referral_reward' then referral_reward
    when 'promo' then promo
    else true end
  into v_enabled from public.notification_preferences where profile_id=p_profile_id;
  if v_enabled is false then return null; end if;
  insert into public.user_notifications(profile_id,kind,title,body,href,metadata)
  values(p_profile_id,p_kind,p_title,coalesce(p_body,''),p_href,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return v_id;
end;
$$;

-- Accurate, bounded admin dashboard aggregates. Management row lists remain
-- explicitly limited in the API and no longer double as analytics sources.
-- These time-first indexes keep rolling activity/revenue windows bounded even
-- when the underlying audit and trade tables become large.
create index if not exists trades_created_v028_idx on public.trades(created_at desc);
create index if not exists gift_trades_created_v028_idx on public.gift_trades(created_at desc);
create index if not exists economy_events_created_v028_idx on public.economy_events(created_at desc);
create index if not exists star_purchases_status_paid_v028_idx on public.star_purchases(status,paid_at desc);

create or replace function public.admin_dashboard_metrics_v028()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with profile_stats as (
    select
      count(*) filter(where coalesce(is_system,false)=false)::int as players,
      count(*) filter(where coalesce(is_system,false)=false and is_banned=true)::int as banned,
      count(*) filter(where coalesce(is_system,false)=false and hidden_from_leaderboard=true)::int as hidden,
      count(*) filter(where coalesce(is_system,false)=true)::int as system_accounts,
      count(*) filter(where coalesce(is_system,false)=false and created_at>=now()-interval '24 hours')::int as new_players_24h,
      coalesce(sum(balance) filter(where coalesce(is_system,false)=false),0) as total_player_balance,
      coalesce(sum(xp) filter(where coalesce(is_system,false)=false),0) as total_xp
    from public.profiles
  ), coin_stats as (
    select
      count(*)::int as coins,
      count(*) filter(where status='active' and hidden_from_market=false)::int as active_coins,
      count(*) filter(where created_at>=now()-interval '24 hours')::int as new_coins_24h
    from public.coins
  ), gift_stats as (
    select
      count(*)::int as gifts,
      count(*) filter(where g.status='listed')::int as listed_gifts,
      count(*) filter(where g.status='listed' and coalesce(p.is_system,false)=true)::int as npc_listings,
      count(*) filter(where g.created_at>=now()-interval '24 hours')::int as new_gifts_24h,
      coalesce(sum(g.listing_price) filter(where g.status='listed'),0) as listed_value
    from public.gift_market_overview g
    left join public.profiles p on p.id=g.owner_profile_id
  ), star_stats as (
    select
      count(*) filter(where status='paid')::int as purchases_total,
      count(*) filter(where status='paid' and paid_at>=date_trunc('day',now()))::int as purchases_today,
      count(distinct profile_id) filter(where status='paid')::int as paying_users,
      coalesce(sum(stars) filter(where status='paid'),0) as revenue_total,
      coalesce(sum(stars) filter(where status='paid' and paid_at>=date_trunc('day',now())),0) as revenue_today,
      count(*) filter(where status='refunded' and refund_metadata->>'virtualReversal'='manual_review_required')::int as refund_reconciliation_required
    from public.star_purchases
  ), promo_stats as (
    select coalesce(sum(uses_count),0)::int as uses_total from public.promo_codes
  ), event_stats as (
    select
      coalesce(sum(amount) filter(where created_at>=date_trunc('day',now()) and amount>0),0) as emission_today,
      coalesce(sum(-amount) filter(where created_at>=date_trunc('day',now()) and amount<0),0) as sinks_today,
      coalesce(sum(amount) filter(where created_at>=date_trunc('day',now()) and kind='stars'),0) as stars_emission_today,
      coalesce(sum(amount) filter(where created_at>=date_trunc('day',now()) and kind='mission'),0) as mission_emission_today,
      coalesce(sum(-amount) filter(where created_at>=date_trunc('day',now()) and kind='coin_launch'),0) as launch_sink_today,
      coalesce(sum(-amount) filter(where created_at>=date_trunc('day',now()) and kind='coin_trade_fee'),0) as trade_fee_sink_today,
      coalesce(sum(amount) filter(where created_at>=date_trunc('day',now()) and kind='promo_code'),0) as promo_emission_today
    from public.economy_events
    where created_at>=date_trunc('day',now())
  ), activity_events(profile_id,created_at) as materialized (
    -- Active = a non-system profile with an audited economy or executed trade
    -- event. The 60-day ceiling supports rolling 24h/30d activity and M1
    -- retention without treating a profile-page read as meaningful activity.
    select profile_id,created_at from public.economy_events
      where profile_id is not null and created_at>=now()-interval '60 days'
    union all
    select profile_id,created_at from public.trades
      where created_at>=now()-interval '60 days'
    union all
    select buyer_profile_id,created_at from public.gift_trades
      where created_at>=now()-interval '60 days'
    union all
    select seller_profile_id,created_at from public.gift_trades
      where seller_profile_id is not null and created_at>=now()-interval '60 days'
  ), activity_users as (
    select a.profile_id,
      bool_or(a.created_at>=now()-interval '24 hours') as active_24h,
      bool_or(a.created_at>=now()-interval '30 days') as active_current_30d,
      bool_or(a.created_at>=now()-interval '60 days' and a.created_at<now()-interval '30 days') as active_previous_30d
    from activity_events a
    join public.profiles p on p.id=a.profile_id and coalesce(p.is_system,false)=false
    group by a.profile_id
  ), activity_stats as (
    select
      count(*) filter(where active_24h)::int as dau,
      count(*) filter(where active_current_30d)::int as mau,
      count(*) filter(where active_previous_30d)::int as retention_eligible,
      count(*) filter(where active_previous_30d and active_current_30d)::int as retained_users
    from activity_users
  ), coin_trade_stats as (
    select count(*)::int as trade_count,coalesce(sum(quote_amount),0) as turnover
    from public.trades where created_at>=now()-interval '24 hours'
  ), gift_trade_stats as (
    select count(*)::int as trade_count,coalesce(sum(price),0) as turnover
    from public.gift_trades where created_at>=now()-interval '24 hours'
  ), top_gift_collections as (
    select coalesce(nullif(trim(ga.base_name),''),nullif(trim(ga.telegram_name),''),'Gift') as name,
      count(*)::int as trades,coalesce(sum(gt.price),0) as turnover
    from public.gift_trades gt join public.gift_assets ga on ga.id=gt.asset_id
    where gt.created_at>=now()-interval '24 hours'
    group by 1 order by turnover desc,trades desc,name limit 5
  ), top_coins as (
    select c.id::text as id,c.name,c.symbol,count(*)::int as trades,coalesce(sum(t.quote_amount),0) as turnover
    from public.trades t join public.coins c on c.id=t.coin_id
    where t.created_at>=now()-interval '24 hours'
    group by c.id,c.name,c.symbol order by turnover desc,trades desc,c.id limit 5
  ), top_store_skus as (
    select sp.product_sku as sku,coalesce(p.title,sp.product_sku) as title,
      count(*)::int as purchases,coalesce(sum(sp.stars),0)::bigint as stars
    from public.star_purchases sp left join public.store_products p on p.sku=sp.product_sku
    where sp.status='paid' and sp.product_sku is not null and sp.paid_at>=now()-interval '30 days'
    group by sp.product_sku,p.title order by stars desc,purchases desc,sp.product_sku limit 5
  )
  select jsonb_build_object(
    'players',p.players,'banned',p.banned,'hidden',p.hidden,'systemAccounts',p.system_accounts,
    'newPlayers24h',p.new_players_24h,'totalPlayerBalance',p.total_player_balance,'totalXp',p.total_xp,
    'coins',c.coins,'activeCoins',c.active_coins,'newCoins24h',c.new_coins_24h,
    'gifts',g.gifts,'listedGifts',g.listed_gifts,'npcListings',g.npc_listings,
    'newGifts24h',g.new_gifts_24h,'listedValue',g.listed_value,
    'promoUsesTotal',pr.uses_total,
    'starsRevenueTotal',s.revenue_total,'starsRevenueToday',s.revenue_today,
    'starsPurchasesTotal',s.purchases_total,'starsPurchasesToday',s.purchases_today,
    'starsPayingUsers',s.paying_users,
    'refundReconciliationRequired',s.refund_reconciliation_required,
    'starsArpu',case when p.players>0 then s.revenue_total::numeric/p.players else 0 end,
    'starsArppu',case when s.paying_users>0 then s.revenue_total::numeric/s.paying_users else 0 end,
    'dau',a.dau,'mau',a.mau,
    'retention30dEligible',a.retention_eligible,
    'retention30dPercent',case when a.retention_eligible>0 then a.retained_users::numeric/a.retention_eligible*100 else 0 end,
    'tradeTurnover24h',ct.turnover+gt.turnover,'tradeCount24h',ct.trade_count+gt.trade_count,
    'coinTurnover24h',ct.turnover,'coinTrades24h',ct.trade_count,
    'giftTurnover24h',gt.turnover,'giftTrades24h',gt.trade_count,
    'topGiftCollections',coalesce((select jsonb_agg(jsonb_build_object('name',name,'trades',trades,'turnover',turnover) order by turnover desc,trades desc,name) from top_gift_collections),'[]'::jsonb),
    'topCoins',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'symbol',symbol,'trades',trades,'turnover',turnover) order by turnover desc,trades desc,id) from top_coins),'[]'::jsonb),
    'topStoreSkus',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'title',title,'purchases',purchases,'stars',stars) order by stars desc,purchases desc,sku) from top_store_skus),'[]'::jsonb),
    'economyEmissionToday',e.emission_today,'economySinksToday',e.sinks_today,
    'economyNetToday',e.emission_today-e.sinks_today,
    'starsEmissionToday',e.stars_emission_today,
    'missionEmissionToday',e.mission_emission_today,'launchSinkToday',e.launch_sink_today,
    'tradeFeeSinkToday',e.trade_fee_sink_today,'promoEmissionToday',e.promo_emission_today
  )
  from profile_stats p cross join coin_stats c cross join gift_stats g
  cross join star_stats s cross join promo_stats pr cross join event_stats e
  cross join activity_stats a cross join coin_trade_stats ct cross join gift_trade_stats gt;
$$;
revoke all on function public.admin_dashboard_metrics_v028() from public,anon,authenticated;
grant execute on function public.admin_dashboard_metrics_v028() to service_role;

drop function if exists public.admin_economy_overview_v056();
create or replace function public.admin_economy_overview_v028()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with ranked_players as (
    select balance,ntile(100) over(order by balance desc) as wealth_bucket
    from public.profiles where coalesce(is_system,false)=false
  ), player_stats as (
    select count(*)::int as player_count,coalesce(sum(balance),0) as circulating_balance,
      coalesce(sum(balance) filter(where wealth_bucket=1),0) as richest_one_percent_balance,
      coalesce(avg(balance),0) as average_balance
    from ranked_players
  ), event_stats as (
    select
      coalesce(sum(amount) filter(where created_at>=now()-interval '24 hours' and amount>0),0) as emission_24h,
      coalesce(sum(-amount) filter(where created_at>=now()-interval '24 hours' and amount<0),0) as burned_24h,
      coalesce(sum(amount) filter(where created_at>=now()-interval '24 hours'),0) as net_24h,
      coalesce(sum(amount) filter(where created_at>=now()-interval '7 days' and amount>0),0) as emission_7d,
      coalesce(sum(-amount) filter(where created_at>=now()-interval '7 days' and amount<0),0) as burned_7d,
      coalesce(sum(amount) filter(where created_at>=now()-interval '7 days'),0) as net_7d,
      coalesce(sum(amount) filter(where created_at>=now()-interval '24 hours' and kind='referral'),0) as referrals_24h,
      coalesce(sum(-amount) filter(where created_at>=now()-interval '24 hours' and kind='coin_trade_fee'),0) as coin_fees_24h
    from public.economy_events where created_at>=now()-interval '7 days'
  )
  select jsonb_build_object(
    'playerCount',p.player_count,'circulatingBalance',p.circulating_balance,
    'averageBalance',p.average_balance,
    'richestOnePercentShare',case when p.circulating_balance>0 then (p.richest_one_percent_balance/p.circulating_balance)*100 else 0 end,
    'emission24h',e.emission_24h,'burned24h',e.burned_24h,'net24h',e.net_24h,
    'emission7d',e.emission_7d,'burned7d',e.burned_7d,'net7d',e.net_7d,
    'referrals24h',e.referrals_24h,'coinFees24h',e.coin_fees_24h,
    'inflation24h',case when greatest(1,p.circulating_balance-e.net_24h)>0 then (e.net_24h/greatest(1,p.circulating_balance-e.net_24h))*100 else 0 end
  ) from player_stats p cross join event_stats e;
$$;
revoke all on function public.admin_economy_overview_v028() from public,anon,authenticated;
grant execute on function public.admin_economy_overview_v028() to service_role;

create or replace function public.admin_economy_activity_v028()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with daily_rows as (
    select created_at::date as day,
      coalesce(sum(amount) filter(where amount>0),0) as emission,
      coalesce(sum(-amount) filter(where amount<0),0) as burned,
      coalesce(sum(amount),0) as net
    from public.economy_events
    where created_at>=now()-interval '7 days'
    group by created_at::date
  ), recipient_rows as (
    select profile_id::text as profile_id,sum(amount) as amount
    from public.economy_events
    where created_at>=now()-interval '24 hours' and amount>0 and profile_id is not null
    group by profile_id order by amount desc limit 12
  ), pair_rows as (
    select least(buyer_profile_id::text,seller_profile_id::text) as a,
      greatest(buyer_profile_id::text,seller_profile_id::text) as b,
      count(*)::int as count,coalesce(sum(price),0) as volume
    from public.gift_trades
    where created_at>=now()-interval '24 hours'
      and buyer_profile_id is not null and seller_profile_id is not null
      and buyer_profile_id<>seller_profile_id
    group by least(buyer_profile_id::text,seller_profile_id::text),greatest(buyer_profile_id::text,seller_profile_id::text)
    having count(*)>=3 order by count desc,volume desc limit 12
  )
  select jsonb_build_object(
    'daily',coalesce((select jsonb_agg(jsonb_build_object('date',day::text,'emission',emission,'burned',burned,'net',net) order by day) from daily_rows),'[]'::jsonb),
    'topRecipients',coalesce((select jsonb_agg(jsonb_build_object('profileId',profile_id,'amount',amount) order by amount desc) from recipient_rows),'[]'::jsonb),
    'washPairs',coalesce((select jsonb_agg(jsonb_build_object('a',a,'b',b,'count',count,'volume',volume) order by count desc,volume desc) from pair_rows),'[]'::jsonb)
  );
$$;
revoke all on function public.admin_economy_activity_v028() from public,anon,authenticated;
grant execute on function public.admin_economy_activity_v028() to service_role;

-- A Stars refund only reverses the external Telegram charge. Virtual items,
-- entitlements, case results, and already-spent currency require an explicit
-- human review. This transition records completion of that review without
-- claiming or attempting an automatic economic reversal.
create index if not exists star_purchases_refund_reconciliation_v028_idx
  on public.star_purchases(refunded_at desc)
  where status='refunded' and refund_metadata->>'virtualReversal'='manual_review_required';

create or replace function public.reconcile_star_refund_v028(
  p_purchase_id uuid,
  p_actor text,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_purchase public.star_purchases;
  v_reconciled_at timestamptz:=now();
  v_state text;
begin
  if p_actor is null or length(trim(p_actor))<3 then raise exception 'Refund reconciliation actor is required'; end if;
  if p_notes is null or length(trim(p_notes))<5 then raise exception 'Refund reconciliation notes are required'; end if;

  select * into v_purchase from public.star_purchases where id=p_purchase_id for update;
  if not found then return jsonb_build_object('status','missing','reconciled',false); end if;
  if v_purchase.status<>'refunded' then
    return jsonb_build_object('status',v_purchase.status,'reconciled',false,'reason','purchase_not_refunded');
  end if;

  v_state:=v_purchase.refund_metadata->>'virtualReversal';
  if v_state='reconciled' then
    return jsonb_build_object('status','refunded','reconciled',true,'alreadyReconciled',true,
      'reconciledAt',v_purchase.refund_metadata#>>'{reconciliation,at}');
  end if;
  if v_state is distinct from 'manual_review_required' then
    return jsonb_build_object('status','refunded','reconciled',false,'reason','manual_review_not_pending');
  end if;

  update public.star_purchases
  set refund_metadata=coalesce(refund_metadata,'{}'::jsonb)||jsonb_build_object(
      'virtualReversal','reconciled',
      'reconciliation',jsonb_build_object(
        'actor',left(trim(p_actor),160),
        'notes',left(trim(p_notes),1000),
        'at',v_reconciled_at,
        'automaticReversal',false
      )
    ),
    updated_at=v_reconciled_at
  where id=p_purchase_id;

  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_purchase.profile_id,'system',0,v_purchase.id,jsonb_build_object(
    'action','stars_refund_reconciled','actor',left(trim(p_actor),160),
    'notes',left(trim(p_notes),1000),'automaticReversal',false
  ));
  return jsonb_build_object('status','refunded','reconciled',true,'alreadyReconciled',false,
    'reconciledAt',v_reconciled_at,'automaticReversal',false);
end;
$$;
revoke all on function public.reconcile_star_refund_v028(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_star_refund_v028(uuid,text,text) to service_role;

commit;
