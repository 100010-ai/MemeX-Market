-- MemeX Market v0.67.1
-- Keep the new-player funnel strictly nested across every tracked activity source.

create or replace function public.admin_funnel_v067(p_days integer default 30)
returns jsonb
language sql
security invoker
stable
set search_path = public, pg_temp
as $$
  with bounds as (
    select current_date - (greatest(7, least(90, coalesce(p_days, 30))) - 1) as start_day
  ), new_users as (
    select p.id
    from public.profiles p, bounds b
    where not coalesce(p.is_system, false)
      and p.created_at::date between b.start_day and current_date
  ), active_new as (
    select distinct n.id
    from new_users n, bounds b
    where exists (
      select 1 from public.profile_presence_v067 pp where pp.profile_id = n.id and pp.bucket_start::date between b.start_day and current_date
      union all select 1 from public.economy_events ee where ee.profile_id = n.id and ee.created_at::date between b.start_day and current_date
      union all select 1 from public.trades t where t.profile_id = n.id and t.created_at::date between b.start_day and current_date
      union all select 1 from public.gift_trades gt where (gt.buyer_profile_id = n.id or gt.seller_profile_id = n.id) and gt.created_at::date between b.start_day and current_date
      union all select 1 from public.star_purchases sp where sp.profile_id = n.id and sp.status = 'paid' and coalesce(sp.paid_at, sp.created_at)::date between b.start_day and current_date
      union all select 1 from public.market_events me where me.actor_profile_id = n.id and me.created_at::date between b.start_day and current_date
    )
  ), trader_new as (
    select distinct n.id
    from active_new n, bounds b
    where exists (
      select 1 from public.trades t where t.profile_id = n.id and not coalesce(t.is_launch_seed, false) and t.created_at::date between b.start_day and current_date
      union all select 1 from public.gift_trades gt where (gt.buyer_profile_id = n.id or gt.seller_profile_id = n.id) and gt.created_at::date between b.start_day and current_date
    )
  ), payer_new as (
    select distinct n.id
    from active_new n
    join public.star_purchases sp on sp.profile_id = n.id
    cross join bounds b
    where sp.status = 'paid'
      and coalesce(sp.paid_at, sp.created_at)::date between b.start_day and current_date
  )
  select jsonb_build_array(
    jsonb_build_object('key', 'registered', 'label', 'Регистрация', 'value', (select count(*) from new_users)),
    jsonb_build_object('key', 'active', 'label', 'Активировались', 'value', (select count(*) from active_new)),
    jsonb_build_object('key', 'trader', 'label', 'Совершили сделку', 'value', (select count(*) from trader_new)),
    jsonb_build_object('key', 'payer', 'label', 'Оплатили Stars', 'value', (select count(*) from payer_new))
  );
$$;

revoke execute on function public.admin_funnel_v067(integer) from public, anon, authenticated;
grant execute on function public.admin_funnel_v067(integer) to service_role;
