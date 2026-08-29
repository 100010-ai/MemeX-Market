begin;

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
  ), created as (
    select count(*)::int as created_coin_count from public.coins where creator_profile_id=p_profile_id
  )
  select jsonb_build_object(
    'tradeCount',coalesce((select coin_trade_count+gift_trade_count from totals),0),
    'tradeVolume',coalesce((select trade_volume from totals),0),
    'giftSales',coalesce((select gift_sales from gift_stats),0),
    'coinTradeCount',coalesce((select coin_trade_count from totals),0),
    'createdCoinCount',coalesce((select created_coin_count from created),0),
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

revoke all on function public.trader_profile_stats_v200(uuid) from public, anon, authenticated;
grant execute on function public.trader_profile_stats_v200(uuid) to service_role;

commit;
