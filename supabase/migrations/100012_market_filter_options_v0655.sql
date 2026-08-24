-- MemeX Market v0.65.5
-- Avoid evaluating gift_market_overview four separate times for one filter payload.

create or replace function public.gift_market_filter_options_v046()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with listed as materialized (
    select base_name,model_name,backdrop_name,symbol_name
    from public.gift_market_overview
    where status='listed'
      and listing_price is not null
      and (listing_expires_at is null or listing_expires_at>now())
  )
  select jsonb_build_object(
    'collections',coalesce((
      select jsonb_agg(x order by x)
      from (select distinct base_name as x from listed where base_name is not null) q
    ),'[]'::jsonb),
    'models',coalesce((
      select jsonb_agg(x order by x)
      from (select distinct model_name as x from listed where model_name is not null) q
    ),'[]'::jsonb),
    'backdrops',coalesce((
      select jsonb_agg(x order by x)
      from (select distinct backdrop_name as x from listed where backdrop_name is not null) q
    ),'[]'::jsonb),
    'symbols',coalesce((
      select jsonb_agg(x order by x)
      from (select distinct symbol_name as x from listed where symbol_name is not null) q
    ),'[]'::jsonb)
  );
$$;
