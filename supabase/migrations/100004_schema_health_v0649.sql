-- MemeX Market v0.64.9 — runtime schema health and orders fast-path compatibility.
-- Idempotent: safe to run more than once.

begin;

-- Keep the orders fast path available even when older production deployments
-- skipped the historical denormalization migration. The application can still
-- fall back without it, but this restores seller-scoped Realtime/index usage.
alter table if exists public.gift_offers
  add column if not exists seller_profile_id uuid references public.profiles(id) on delete cascade;

update public.gift_offers o
set seller_profile_id = vg.owner_profile_id
from public.virtual_gifts vg
where o.virtual_gift_id = vg.id
  and o.seller_profile_id is null;

create index if not exists gift_offers_seller_status_created_v0649_idx
  on public.gift_offers(seller_profile_id,status,created_at desc);

create or replace function public.mxm_fill_offer_seller_v0649()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.seller_profile_id is null then
    select owner_profile_id into new.seller_profile_id
    from public.virtual_gifts
    where id = new.virtual_gift_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mxm_fill_offer_seller_v0649 on public.gift_offers;
create trigger trg_mxm_fill_offer_seller_v0649
  before insert or update of virtual_gift_id on public.gift_offers
  for each row execute function public.mxm_fill_offer_seller_v0649();

create or replace function public.mxm_schema_health_v0649()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_schema integer := 0;
  v_caps jsonb;
begin
  select coalesce(schema_version,0) into v_schema
  from public.economy_settings
  where singleton=true;

  v_caps := jsonb_build_array(
    jsonb_build_object(
      'key','memecoin_launch_seed','label','Чистый запуск мемкоинов','required',true,
      'ok', exists(select 1 from information_schema.columns where table_schema='public' and table_name='trades' and column_name='is_launch_seed')
    ),
    jsonb_build_object(
      'key','progression_rewards','label','Уровни аккаунта','required',true,
      'ok', to_regclass('public.account_level_rewards') is not null
    ),
    jsonb_build_object(
      'key','daily_streak','label','Daily Streak','required',true,
      'ok', to_regclass('public.daily_streak_state') is not null
    ),
    jsonb_build_object(
      'key','case_pity','label','Гарантии кейсов','required',true,
      'ok',
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='case_definitions' and column_name='rare_pity') and
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='case_definitions' and column_name='epic_pity') and
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='case_definitions' and column_name='legendary_pity')
    ),
    jsonb_build_object(
      'key','season_prestige','label','Prestige Battle Pass','required',true,
      'ok', to_regclass('public.season_prestige_claims') is not null
    ),
    jsonb_build_object(
      'key','orders_fast_path','label','Быстрый Realtime заявок','required',false,
      'ok', exists(select 1 from information_schema.columns where table_schema='public' and table_name='gift_offers' and column_name='seller_profile_id')
    )
  );

  return jsonb_build_object(
    'ready', v_schema >= 201 and not exists(
      select 1
      from jsonb_array_elements(v_caps) item
      where coalesce((item->>'required')::boolean,false)=true
        and coalesce((item->>'ok')::boolean,false)=false
    ),
    'schemaVersion', v_schema,
    'requiredSchemaVersion', 201,
    'capabilities', v_caps
  );
end;
$$;

revoke all on function public.mxm_schema_health_v0649() from public,anon,authenticated;
grant execute on function public.mxm_schema_health_v0649() to service_role;
revoke all on function public.mxm_fill_offer_seller_v0649() from public,anon,authenticated;
grant execute on function public.mxm_fill_offer_seller_v0649() to service_role;

notify pgrst, 'reload schema';
commit;
