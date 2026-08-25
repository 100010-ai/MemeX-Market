begin;

-- MemeX Market v0.70.0
-- Repair optimistic NFT media metadata, collapse rate-limit writes into one
-- transaction and reduce the browser-facing database surface.

create or replace function public.consume_rate_limits_v070(
  p_keys text[],
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
begin
  if coalesce(cardinality(p_keys), 0) < 1 or cardinality(p_keys) > 8 then
    raise exception 'Invalid rate-limit key count';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit configuration';
  end if;
  if exists (
    select 1 from unnest(p_keys) as requested(key)
    where requested.key is null or char_length(requested.key) < 8
  ) then
    raise exception 'Invalid rate-limit key';
  end if;

  with requested as (
    select distinct key from unnest(p_keys) as keys(key)
  ), consumed as (
    insert into public.api_rate_limits(key, hits, window_started_at, updated_at)
    select key, 1, now(), now() from requested
    on conflict (key) do update set
      hits = case
        when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
        else public.api_rate_limits.hits + 1
      end,
      window_started_at = case
        when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
        else public.api_rate_limits.window_started_at
      end,
      updated_at = now()
    returning hits
  )
  select coalesce(bool_and(hits <= p_limit), false) into v_allowed from consumed;

  return v_allowed;
end;
$$;

revoke execute on function public.consume_rate_limits_v070(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limits_v070(text[], integer, integer) to service_role;

-- TonAPI catalogue imports previously treated every generated Fragment slug as
-- proof that a Lottie file existed. Prefer a trusted, persisted metadata image
-- and mark rows static unless a real trusted animation URL is present.
with media as (
  select
    ga.id,
    case
      when coalesce(ga.chain_metadata->>'image', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io)/'
        then ga.chain_metadata->>'image'
      when coalesce(ga.chain_metadata->>'image_url', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io)/'
        then ga.chain_metadata->>'image_url'
      when coalesce(ga.chain_metadata->>'preview', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io)/'
        then ga.chain_metadata->>'preview'
      else null
    end as preview_url,
    case
      when coalesce(ga.chain_metadata->>'animation_url', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io)/'
        then ga.chain_metadata->>'animation_url'
      when coalesce(ga.chain_metadata->>'animation', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io)/'
        then ga.chain_metadata->>'animation'
      when coalesce(ga.chain_metadata->>'video_url', '') ~* '^https://(nft\.fragment\.com|s\.getgems\.io|cache\.tonapi\.io|ipfs\.io)/'
        then ga.chain_metadata->>'video_url'
      else null
    end as animation_url
  from public.gift_assets ga
  where ga.catalog_source = 'tonapi'
), normalized as (
  select
    id,
    preview_url,
    animation_url,
    coalesce(animation_url, preview_url) as media_url,
    coalesce(animation_url, '') ~* '\.(json|tgs)([?#].*)?$' as is_animated,
    coalesce(animation_url, '') ~* '\.(mp4|webm|mov|m4v|ogv)([?#].*)?$' as is_video
  from media
)
update public.gift_assets ga
set
  model_preview_url = coalesce(n.preview_url, ga.model_preview_url),
  model_media_url = coalesce(n.media_url, ga.model_preview_url, ga.model_media_url),
  model_is_animated = n.is_animated,
  model_is_video = n.is_video,
  updated_at = now()
from normalized n
where n.id = ga.id
  and (
    ga.model_is_animated is distinct from n.is_animated
    or ga.model_is_video is distinct from n.is_video
    or (n.preview_url is not null and ga.model_preview_url is distinct from n.preview_url)
    or (n.media_url is not null and ga.model_media_url is distinct from n.media_url)
  );

-- These foreign-key indexes remove avoidable parent-table lock scans and make
-- admin/economy cleanup paths predictable as the project grows.
create index if not exists admin_members_v067_created_by_fk_idx on public.admin_members_v067(created_by) where created_by is not null;
create index if not exists admin_members_v067_updated_by_fk_idx on public.admin_members_v067(updated_by) where updated_by is not null;
create index if not exists app_error_inbox_v056_last_profile_fk_idx on public.app_error_inbox_v056(last_profile_id) where last_profile_id is not null;
create index if not exists case_openings_case_sku_fk_idx on public.case_openings(case_sku);
create index if not exists case_openings_loot_id_fk_idx on public.case_openings(loot_id);
create index if not exists coin_boosts_profile_id_fk_idx on public.coin_boosts(profile_id);
create index if not exists collection_bonus_claims_item_key_fk_idx on public.collection_bonus_claims(item_key);
create index if not exists market_settings_treasury_profile_fk_idx on public.market_settings(treasury_profile_id) where treasury_profile_id is not null;
create index if not exists mxm_purchase_requests_profile_id_fk_idx on public.mxm_purchase_requests(profile_id);
create index if not exists mxm_purchase_requests_sku_fk_idx on public.mxm_purchase_requests(sku);

-- The application uses service-role API routes. Browsers only need SELECT on
-- the five event tables used by Realtime; RLS policies continue to constrain
-- those reads. Remove every other inherited Data API grant.
do $$
declare
  privilege record;
begin
  for privilege in
    select distinct grantee, table_schema, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and (
        privilege_type <> 'SELECT'
        or table_name not in ('coins', 'trades', 'virtual_gifts', 'gift_trades', 'market_events')
      )
  loop
    execute format(
      'revoke %s on table %I.%I from %I',
      privilege.privilege_type,
      privilege.table_schema,
      privilege.table_name,
      privilege.grantee
    );
  end loop;
end;
$$;

grant select on table public.coins, public.trades, public.virtual_gifts, public.gift_trades, public.market_events to anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

commit;
