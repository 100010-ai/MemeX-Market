begin;

-- Central source/sink telemetry. Store UI remains compatible, but economy
-- health is now measurable without reconstructing it from unrelated pages.
create or replace function public.economy_flow_snapshot_v074(p_days integer default 30)
returns jsonb language sql security definer set search_path=public,pg_temp stable as $$
  with bounds as (
    select now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),365))) since
  ), events as (
    select e.*,
      case
        when e.metadata->>'unit'='mxm_coins' then e.amount
        when e.kind='store' and e.metadata->'reward'->>'kind'='mxm_coins' then coalesce((e.metadata->'reward'->>'amount')::numeric,0)
        else 0 end mxm_amount,
      case when e.metadata->>'unit'='virtual_ton' then e.amount else 0 end ton_amount
    from public.economy_events e,bounds b where e.created_at>=b.since
  ), mxm as (
    select coalesce(sum(greatest(mxm_amount,0)),0) sources,coalesce(sum(abs(least(mxm_amount,0))),0) sinks from events
  ), ton as (
    select coalesce(sum(greatest(ton_amount,0)),0) sources,coalesce(sum(abs(least(ton_amount,0))),0) sinks from events
  ), stars as (
    select coalesce(sum(stars) filter(where status='paid'),0)::bigint paid,
      coalesce(sum(stars) filter(where status='refunded'),0)::bigint refunded,
      count(*) filter(where status='paid')::integer paid_count,
      count(*) filter(where status='refunded')::integer refunded_count
    from public.star_purchases,bounds b where created_at>=b.since
  )
  select jsonb_build_object(
    'windowDays',greatest(1,least(coalesce(p_days,30),365)),
    'mxm',jsonb_build_object('sources',mxm.sources,'sinks',mxm.sinks,'net',mxm.sources-mxm.sinks),
    'virtualTon',jsonb_build_object('sources',ton.sources,'sinks',ton.sinks,'net',ton.sources-ton.sinks),
    'stars',jsonb_build_object('paid',stars.paid,'refunded',stars.refunded,'net',stars.paid-stars.refunded,'paidCount',stars.paid_count,'refundedCount',stars.refunded_count),
    'cases',jsonb_build_object('opened',(select count(*) from public.case_openings,bounds b where opened_at>=b.since),'serializedRare',(select count(*) from public.case_drop_serials_v074,bounds b where minted_at>=b.since)),
    'catalog',jsonb_build_object('activeProducts',(select count(*) from public.store_products where active=true),'activeCases',(select count(*) from public.case_definitions where active=true))
  ) from mxm,ton,stars;
$$;

create or replace function public.store_catalog_health_v074()
returns jsonb language sql security definer set search_path=public,pg_temp stable as $$
  with active_case_products as (
    select sp.sku,sp.metadata from public.store_products sp where sp.active=true and sp.metadata ? 'caseTier'
  ), problems as (
    select p.sku,'missing_case_definition' reason from active_case_products p left join public.case_definitions d on d.sku=p.sku and d.active=true where d.sku is null
    union all
    select p.sku,'missing_active_loot' from active_case_products p where not exists(select 1 from public.case_loot_definitions l where l.case_sku=p.sku and l.active=true and l.weight>0)
    union all
    select p.sku,'invalid_case_quantity' from active_case_products p where coalesce((p.metadata->>'quantity')::integer,1)<1
  )
  select jsonb_build_object('ok',not exists(select 1 from problems),'problems',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'reason',reason) order by sku,reason) from problems),'[]'::jsonb),'checkedAt',now());
$$;

revoke execute on function public.economy_flow_snapshot_v074(integer),public.store_catalog_health_v074() from public,anon,authenticated;
grant execute on function public.economy_flow_snapshot_v074(integer),public.store_catalog_health_v074() to service_role;
commit;
