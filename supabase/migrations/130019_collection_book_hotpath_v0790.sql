-- Collection Book should only aggregate market data for collections owned by the
-- requested profile. The previous snapshot materialized gift_collection_overview,
-- which computes every collection in the market before joining a handful of owned
-- collection keys.

create or replace function public.collection_book_snapshot_v0790(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if not exists(select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Profile not found';
  end if;

  with owned_gifts as materialized (
    select
      lower(trim(ga.base_name)) as collection_key,
      ga.base_name,
      ga.model_name,
      ga.backdrop_name,
      ga.symbol_name,
      ga.model_rarity_per_mille,
      ga.backdrop_rarity_per_mille,
      ga.symbol_rarity_per_mille
    from public.virtual_gifts vg
    join public.gift_assets ga on ga.id = vg.asset_id
    where vg.owner_profile_id = p_profile_id
      and coalesce(ga.is_burned, false) = false
      and nullif(trim(ga.base_name), '') is not null
  ),
  owned as (
    select
      collection_key,
      min(base_name) as base_name,
      count(*)::integer as owned,
      coalesce(sum(case
        when least(coalesce(model_rarity_per_mille, 1000), coalesce(backdrop_rarity_per_mille, 1000), coalesce(symbol_rarity_per_mille, 1000)) <= 10 then 5
        when least(coalesce(model_rarity_per_mille, 1000), coalesce(backdrop_rarity_per_mille, 1000), coalesce(symbol_rarity_per_mille, 1000)) <= 30 then 3
        when least(coalesce(model_rarity_per_mille, 1000), coalesce(backdrop_rarity_per_mille, 1000), coalesce(symbol_rarity_per_mille, 1000)) <= 100 then 2
        else 1
      end), 0)::integer as rarity_points,
      count(distinct nullif(trim(model_name), ''))::integer as models_owned,
      count(distinct nullif(trim(backdrop_name), ''))::integer as backdrops_owned,
      count(distinct nullif(trim(symbol_name), ''))::integer as symbols_owned
    from owned_gifts
    group by collection_key
  ),
  catalog as (
    select
      lower(trim(ga.base_name)) as collection_key,
      count(distinct nullif(trim(ga.model_name), ''))::integer as models_total,
      count(distinct nullif(trim(ga.backdrop_name), ''))::integer as backdrops_total,
      count(distinct nullif(trim(ga.symbol_name), ''))::integer as symbols_total
    from public.gift_assets ga
    join owned o on o.collection_key = lower(trim(ga.base_name))
    where coalesce(ga.is_burned, false) = false
    group by lower(trim(ga.base_name))
  ),
  claims as (
    select
      lower(trim(base_name)) as collection_key,
      coalesce(jsonb_agg(milestone order by milestone), '[]'::jsonb) as claimed
    from public.collection_milestone_claims
    where profile_id = p_profile_id
    group by lower(trim(base_name))
  ),
  policy as (
    select mode
    from public.gift_market_liquidity_policy
    where singleton = true
  ),
  market as materialized (
    select
      lower(trim(ga.base_name)) as collection_key,
      count(distinct vg.owner_profile_id)::integer as holders,
      min(vg.listing_price) filter (
        where vg.status = 'listed'
          and vg.listing_price is not null
          and (vg.listing_expires_at is null or vg.listing_expires_at > now())
      ) as floor_price
    from public.gift_assets ga
    join owned o on o.collection_key = lower(trim(ga.base_name))
    join public.virtual_gifts vg on vg.asset_id = ga.id
    join public.profiles owner_profile on owner_profile.id = vg.owner_profile_id
    cross join policy pol
    where ga.is_burned = false
      and (pol.mode <> 'player_only' or coalesce(owner_profile.is_system, false) = false)
    group by lower(trim(ga.base_name))
  ),
  raw_rows as (
    select
      o.*,
      c.models_total,
      c.backdrops_total,
      c.symbols_total,
      coalesce(cl.claimed, '[]'::jsonb) as claimed,
      coalesce(m.holders, 0) as holders,
      m.floor_price,
      ((c.models_total > 0)::integer + (c.backdrops_total > 0)::integer + (c.symbols_total > 0)::integer) as dim_count,
      (case when c.models_total > 0 then least(1, o.models_owned::numeric / c.models_total) else 0 end)
        + (case when c.backdrops_total > 0 then least(1, o.backdrops_owned::numeric / c.backdrops_total) else 0 end)
        + (case when c.symbols_total > 0 then least(1, o.symbols_owned::numeric / c.symbols_total) else 0 end) as ratio_sum
    from owned o
    join catalog c using (collection_key)
    left join claims cl using (collection_key)
    left join market m using (collection_key)
  ),
  rows as (
    select
      *,
      case
        when dim_count = 0 then 0
        else least(100, greatest(0, floor(100 * ratio_sum / dim_count)::integer))
      end as coverage
    from raw_rows
  ),
  agg as (
    select
      coalesce(sum(rarity_points), 0)::integer as total_points,
      (select count(*)::integer from owned_gifts) as gift_count,
      count(*) filter (where coverage >= 100)::integer as completed,
      coalesce(jsonb_agg(jsonb_build_object(
        'baseName', base_name,
        'coverage', coverage,
        'models', jsonb_build_object('owned', models_owned, 'total', models_total),
        'backdrops', jsonb_build_object('owned', backdrops_owned, 'total', backdrops_total),
        'symbols', jsonb_build_object('owned', symbols_owned, 'total', symbols_total),
        'claimedMilestones', claimed,
        'owned', owned,
        'rarityPoints', rarity_points,
        'holders', holders,
        'floorPrice', floor_price
      ) order by base_name), '[]'::jsonb) as collections
    from rows
  ),
  calc as (
    select
      *,
      greatest(1, floor(sqrt(greatest(total_points, 0)::numeric / 5.0))::integer + 1) as level
    from agg
  )
  select jsonb_build_object(
    'level', level,
    'totalPoints', total_points,
    'nextLevel', 5 * level * level,
    'progress', least(1, greatest(0, (total_points - (5 * (level - 1) * (level - 1)))::numeric / greatest(1, (5 * level * level) - (5 * (level - 1) * (level - 1))))),
    'giftCount', gift_count,
    'completed', completed,
    'collections', collections,
    'milestones', jsonb_build_array(25, 50, 75, 100)
  ) into v_result
  from calc;

  return coalesce(v_result, jsonb_build_object(
    'level', 1,
    'totalPoints', 0,
    'nextLevel', 5,
    'progress', 0,
    'giftCount', 0,
    'completed', 0,
    'collections', '[]'::jsonb,
    'milestones', jsonb_build_array(25, 50, 75, 100)
  ));
end;
$function$;

revoke execute on function public.collection_book_snapshot_v0790(uuid) from public, anon, authenticated;
grant execute on function public.collection_book_snapshot_v0790(uuid) to service_role;
