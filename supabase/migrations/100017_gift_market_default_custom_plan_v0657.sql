-- MemeX Market v0.65.7
-- SECURITY DEFINER SQL functions tend to settle on a generic plan here. The default
-- feed has only three scalar inputs, so replanning this one hot query is cheaper than
-- repeatedly losing the listed-state/index pushdown.

create or replace function public.gift_market_default_page_v0657(
  p_seed text default 'mxm',
  p_offset integer default 0,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  execute $market$
    with params as (
      select
        greatest(0,least(coalesce($2,0),100000)) as page_offset,
        greatest(1,least(coalesce($3,24),72)) as page_limit,
        hashtextextended(coalesce(nullif(trim($1),''),'mxm'),200) as start_key
    ), filtered as materialized (
      select
        g.*,
        vg.market_shuffle_key,
        count(*) over()::integer as total_count
      from public.gift_market_overview g
      join public.virtual_gifts vg on vg.id=g.virtual_gift_id
      join public.profiles owner_profile on owner_profile.id=g.owner_profile_id
      cross join public.gift_market_liquidity_policy policy
      where policy.singleton=true
        and g.status='listed'
        and g.is_burned=false
        and g.telegram_name is not null
        and (g.listing_expires_at is null or g.listing_expires_at>now())
        and (policy.mode<>'player_only' or coalesce(owner_profile.is_system,false)=false)
    ), ranked as (
      select
        f.*,
        row_number() over(order by
          case when f.market_shuffle_key>=p.start_key then 0 else 1 end,
          f.market_shuffle_key,
          f.virtual_gift_id
        )::integer as page_ordinal
      from filtered f
      cross join params p
    ), page as (
      select r.*
      from ranked r
      cross join params p
      where r.page_ordinal>p.page_offset
        and r.page_ordinal<=p.page_offset+p.page_limit
    ), totals as (
      select coalesce(max(total_count),0)::integer as total_count
      from filtered
    )
    select jsonb_build_object(
      'gifts',coalesce((
        select jsonb_agg(
          to_jsonb(pg)-'market_shuffle_key'-'total_count'-'page_ordinal'
          order by pg.page_ordinal
        )
        from page pg
      ),'[]'::jsonb),
      'totalGifts',t.total_count,
      'nextOffset',case
        when p.page_offset+(select count(*) from page)<t.total_count
        then p.page_offset+(select count(*) from page)
        else null
      end
    )
    from params p
    cross join totals t
  $market$
  into v_result
  using p_seed,p_offset,p_limit;

  return v_result;
end;
$$;

revoke execute on function public.gift_market_default_page_v0657(text,integer,integer) from public,anon,authenticated;
grant execute on function public.gift_market_default_page_v0657(text,integer,integer) to service_role;
