-- Reduce Genesis refresh work when catalog sync timestamps advance but the
-- eligible catalog mostly overlaps the existing pool. Preserve the existing
-- append-only pool semantics while avoiding one ON CONFLICT probe per asset.

create index if not exists gift_sync_runs_finished_v0791_idx
  on public.gift_sync_runs(finished_at desc)
  where finished_at is not null;

create or replace function public.initialize_gift_genesis_pool()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_seed text;
  v_started timestamptz;
  v_completed timestamptz;
  v_checked timestamptz;
  v_source_changed timestamptz;
  v_total integer;
  v_released integer;
  v_refresh boolean:=false;
begin
  select seed,started_at,completed_at,catalog_checked_at,snapshot_count,released_count
  into v_seed,v_started,v_completed,v_checked,v_total,v_released
  from public.gift_genesis_state
  where singleton=true
  for update;

  select greatest(
    coalesce((select max(last_success_at) from public.catalog_sync_state),'-infinity'::timestamptz),
    coalesce((select last_sync_at from public.tonapi_catalog_state where singleton=true),'-infinity'::timestamptz),
    coalesce((select finished_at from public.gift_sync_runs where finished_at is not null order by finished_at desc limit 1),'-infinity'::timestamptz)
  ) into v_source_changed;

  v_refresh:=v_checked is null or v_source_changed>v_checked;

  if v_completed is null and v_refresh then
    insert into public.gift_genesis_pool(asset_id,release_key,rarity_tier)
    select
      ga.id,
      md5(v_seed || ':' || ga.id::text),
      case
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=5 then 'legendary'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=20 then 'epic'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=60 then 'rare'
        when least(ga.model_rarity_per_mille,ga.symbol_rarity_per_mille,ga.backdrop_rarity_per_mille)<=180 then 'uncommon'
        else 'common'
      end
    from public.gift_assets ga
    where ga.catalog_source in ('bot_catalog','tonapi')
      and ga.is_burned=false
      and ga.telegram_name is not null
      and (
        (ga.catalog_source='bot_catalog' and ga.model_file_id is not null and ga.symbol_file_id is not null)
        or
        (ga.catalog_source='tonapi' and ga.chain_verified=true and ga.model_media_url is not null)
      )
      and not exists (
        select 1
        from public.gift_genesis_pool gp
        where gp.asset_id=ga.id
      )
    on conflict(asset_id) do nothing;

    if v_started is null then
      update public.gift_genesis_state
      set started_at=now(),updated_at=now()
      where singleton=true;
    end if;

    update public.gift_genesis_pool gp
    set virtual_gift_id=vg.id,
        released_at=coalesce(gp.released_at,vg.created_at,now())
    from public.virtual_gifts vg
    where vg.asset_id=gp.asset_id
      and (gp.virtual_gift_id is distinct from vg.id or gp.released_at is null);

    select count(*)::integer,
           count(*) filter(where released_at is not null)::integer
    into v_total,v_released
    from public.gift_genesis_pool;

    update public.gift_genesis_state
    set snapshot_count=v_total,
        released_count=v_released,
        completed_at=case
          when v_total>0 and v_released>=v_total then coalesce(completed_at,now())
          else null
        end,
        catalog_checked_at=case when v_source_changed='-infinity'::timestamptz then now() else v_source_changed end,
        updated_at=now()
    where singleton=true;
  end if;

  return jsonb_build_object(
    'total',coalesce(v_total,0),
    'released',coalesce(v_released,0),
    'remaining',greatest(0,coalesce(v_total,0)-coalesce(v_released,0)),
    'completed',coalesce(v_total,0)>0 and coalesce(v_released,0)>=coalesce(v_total,0),
    'seed',v_seed
  );
end;
$function$;
