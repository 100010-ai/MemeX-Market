create table if not exists public.control_login_challenges_v210 (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists control_login_challenges_v210_telegram_created_idx
  on public.control_login_challenges_v210 (telegram_id, created_at desc);
create index if not exists control_login_challenges_v210_expires_idx
  on public.control_login_challenges_v210 (expires_at)
  where used_at is null;

alter table public.control_login_challenges_v210 enable row level security;
revoke all on table public.control_login_challenges_v210 from public, anon, authenticated;
grant select, insert, update, delete on table public.control_login_challenges_v210 to service_role;

create table if not exists public.control_broadcasts_v210 (
  id uuid primary key default gen_random_uuid(),
  actor_telegram_id bigint,
  audience text not null check (audience in ('players','channel','test')),
  segment text not null default 'all' check (segment in ('all','premium','donors','manual','channel','test')),
  channel_target text,
  manual_recipient_ids bigint[] not null default '{}',
  message text not null default '',
  parse_mode text check (parse_mode is null or parse_mode in ('MarkdownV2','HTML')),
  attachment_type text not null default 'none' check (attachment_type in ('none','photo','document')),
  attachment_url text,
  buttons jsonb not null default '[]'::jsonb,
  link_preview boolean not null default true,
  status text not null default 'draft' check (status in ('draft','queued','sending','completed','partial','failed','cancelled')),
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  last_telegram_id bigint,
  last_offset integer not null default 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists control_broadcasts_v210_created_idx on public.control_broadcasts_v210 (created_at desc);
create index if not exists control_broadcasts_v210_status_idx on public.control_broadcasts_v210 (status, updated_at desc);

alter table public.control_broadcasts_v210 enable row level security;
revoke all on table public.control_broadcasts_v210 from public, anon, authenticated;
grant select, insert, update, delete on table public.control_broadcasts_v210 to service_role;

create or replace function public.control_dashboard_snapshot_v210(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select greatest(7, least(coalesce(p_days, 30), 90))::integer as days
),
days as (
  select generate_series(current_date - ((select days from params) - 1), current_date, interval '1 day')::date as day
),
new_players as (
  select created_at::date as day, count(*)::bigint as value
  from profiles
  where coalesce(is_system, false) = false
    and created_at >= current_date - ((select days from params) - 1)
  group by 1
),
active_players as (
  select activity_date as day, count(distinct profile_id)::bigint as value
  from profile_activity_days_v074
  where activity_date >= current_date - ((select days from params) - 1)
  group by 1
),
gift_daily as (
  select created_at::date as day, count(*)::bigint as trades, coalesce(sum(price),0)::numeric as volume
  from gift_trades
  where created_at >= current_date - ((select days from params) - 1)
  group by 1
),
coin_daily as (
  select created_at::date as day, count(*)::bigint as trades, coalesce(sum(quote_amount),0)::numeric as volume
  from trades
  where created_at >= current_date - ((select days from params) - 1)
    and coalesce(is_launch_seed, false) = false
  group by 1
),
stars_daily as (
  select coalesce(paid_at, created_at)::date as day, coalesce(sum(stars),0)::bigint as stars
  from star_purchases
  where status = 'paid'
    and coalesce(paid_at, created_at) >= current_date - ((select days from params) - 1)
  group by 1
),
series as (
  select d.day,
    coalesce(np.value,0) as new_players,
    coalesce(ap.value,0) as active_players,
    coalesce(gd.trades,0) as gift_trades,
    coalesce(gd.volume,0) as gift_volume,
    coalesce(cd.trades,0) as coin_trades,
    coalesce(cd.volume,0) as coin_volume,
    coalesce(sd.stars,0) as stars
  from days d
  left join new_players np using(day)
  left join active_players ap using(day)
  left join gift_daily gd using(day)
  left join coin_daily cd using(day)
  left join stars_daily sd using(day)
  order by d.day
),
player_totals as (
  select
    count(*) filter (where coalesce(is_system,false)=false)::bigint as total,
    count(*) filter (where coalesce(is_system,false)=false and is_banned)::bigint as banned,
    count(*) filter (where coalesce(is_system,false)=false and created_at >= now() - interval '7 days')::bigint as new7d
  from profiles
),
active7 as (
  select count(distinct profile_id)::bigint as value
  from profile_activity_days_v074
  where activity_date >= current_date - 6
),
active30 as (
  select count(distinct profile_id)::bigint as value
  from profile_activity_days_v074
  where activity_date >= current_date - 29
),
gift_status as (
  select status as name, count(*)::bigint as value from virtual_gifts group by status
),
coin_status as (
  select case when hidden_from_market then 'hidden' else status end as name, count(*)::bigint as value
  from coins group by 1
),
stars_status as (
  select status as name, count(*)::bigint as value from star_purchases group by status
),
catalog_sources as (
  select coalesce(catalog_source,'unknown') as name, count(*)::bigint as value from gift_assets group by 1
),
media_health as (
  select
    count(*)::bigint as total,
    count(*) filter (where coalesce(model_preview_url, model_media_url, '') = '')::bigint as missing,
    count(*) filter (where chain_verified = true)::bigint as verified,
    count(*) filter (where catalog_source='tonapi' and chain_verified = false)::bigint as unverified_tonapi
  from gift_assets
),
collection_top as (
  select base_name, item_count, holder_count, listed_count, floor_price, volume_24h, trade_count_24h, change_24h
  from gift_collection_overview
  order by volume_24h desc nulls last, trade_count_24h desc nulls last
  limit 10
)
select jsonb_build_object(
  'days', (select days from params),
  'generatedAt', now(),
  'metrics', jsonb_build_object(
    'players', (select total from player_totals),
    'active7d', (select value from active7),
    'active30d', (select value from active30),
    'new7d', (select new7d from player_totals),
    'banned', (select banned from player_totals),
    'activeCoins', (select count(*) from coins where status='active' and hidden_from_market=false),
    'listedGifts', (select count(*) from virtual_gifts where status='listed'),
    'giftVolume24h', (select coalesce(sum(price),0) from gift_trades where created_at >= now() - interval '24 hours'),
    'coinVolume24h', (select coalesce(sum(quote_amount),0) from trades where created_at >= now() - interval '24 hours' and coalesce(is_launch_seed,false)=false),
    'stars24h', (select coalesce(sum(stars),0) from star_purchases where status='paid' and coalesce(paid_at,created_at) >= now() - interval '24 hours'),
    'errors24h', (select coalesce(sum(count),0) from app_error_inbox_v056 where last_seen_at >= now() - interval '24 hours'),
    'openCoinOrders', (select count(*) from coin_conditional_orders_v056 where status='open'),
    'pendingStars', (select count(*) from star_purchases where status='pending')
  ),
  'series', coalesce((select jsonb_agg(jsonb_build_object(
      'date', day,
      'newPlayers', new_players,
      'activePlayers', active_players,
      'giftTrades', gift_trades,
      'giftVolume', gift_volume,
      'coinTrades', coin_trades,
      'coinVolume', coin_volume,
      'stars', stars
    ) order by day) from series), '[]'::jsonb),
  'distributions', jsonb_build_object(
    'players', jsonb_build_array(
      jsonb_build_object('name','active_7d','value',(select value from active7)),
      jsonb_build_object('name','inactive_7d','value',greatest((select total from player_totals)-(select value from active7),0))
    ),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value) order by value desc) from gift_status), '[]'::jsonb),
    'coins', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value) order by value desc) from coin_status), '[]'::jsonb),
    'stars', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value) order by value desc) from stars_status), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value) order by value desc) from catalog_sources), '[]'::jsonb)
  ),
  'mediaHealth', (select to_jsonb(media_health) from media_health),
  'topCollections', coalesce((select jsonb_agg(to_jsonb(collection_top)) from collection_top), '[]'::jsonb)
);
$$;

revoke all on function public.control_dashboard_snapshot_v210(integer) from public, anon, authenticated;
grant execute on function public.control_dashboard_snapshot_v210(integer) to service_role;
