create or replace function public.gift_market_bootstrap_meta_v0795(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with collection_rows as materialized (
    select base_name,item_count,holder_count,listed_count,floor_price,last_sale_price,
      volume_24h,change_24h,trade_count_24h,volume_7d,trade_count_7d,listed_pct,
      all_time_volume,total_sales,high_sale,external_floor
    from public.gift_collection_overview
    order by volume_24h desc
    limit 24
  ), watch_rows as materialized (
    select kind,coin_id,gift_collection,virtual_gift_id
    from public.user_watchlist
    where profile_id=p_profile_id
    limit 500
  ), cart_rows as materialized (
    select virtual_gift_id
    from public.market_cart_items
    where profile_id=p_profile_id
    limit 21
  )
  select jsonb_build_object(
    'collections',coalesce((select jsonb_agg(to_jsonb(c)) from collection_rows c),'[]'::jsonb),
    'watchlist',jsonb_build_object(
      'coinIds',coalesce((select jsonb_agg(w.coin_id) from watch_rows w where w.kind='coin' and w.coin_id is not null),'[]'::jsonb),
      'giftCollections',coalesce((select jsonb_agg(w.gift_collection) from watch_rows w where w.kind='gift_collection' and w.gift_collection is not null),'[]'::jsonb),
      'giftIds',coalesce((select jsonb_agg(w.virtual_gift_id) from watch_rows w where w.kind='gift' and w.virtual_gift_id is not null),'[]'::jsonb)
    ),
    'cartIds',coalesce((select jsonb_agg(c.virtual_gift_id) from cart_rows c),'[]'::jsonb),
    'genesis',public.gift_genesis_public_state(),
    'liquidity',public.gift_market_liquidity_state(),
    'filterOptions',public.gift_market_filter_options_v046()
  );
$function$;

revoke all on function public.gift_market_bootstrap_meta_v0795(uuid) from public;
revoke all on function public.gift_market_bootstrap_meta_v0795(uuid) from anon;
revoke all on function public.gift_market_bootstrap_meta_v0795(uuid) from authenticated;
grant execute on function public.gift_market_bootstrap_meta_v0795(uuid) to service_role;

comment on function public.gift_market_bootstrap_meta_v0795(uuid) is
  'Service-role-only bootstrap metadata for the gift market. Bundles collections, watchlist, cart, genesis, liquidity and filter options into one database round trip.';
