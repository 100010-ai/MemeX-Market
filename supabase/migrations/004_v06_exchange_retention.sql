begin;

-- MXM v0.6: watchlists, progression and richer exchange metrics.

-- ---------------------------------------------------------------------------
-- 1. Persistent player progression.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists xp bigint not null default 0 check (xp >= 0);

create table if not exists public.profile_xp_events (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_key text not null,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (profile_id, source_key)
);
create index if not exists profile_xp_events_created_v06_idx on public.profile_xp_events(profile_id, created_at desc);
alter table public.profile_xp_events enable row level security;
revoke all on table public.profile_xp_events from anon, authenticated;

create or replace function public.award_profile_xp(p_profile_id uuid, p_source_key text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_inserted integer;
begin
  if p_profile_id is null then return false; end if;
  if p_source_key is null or char_length(trim(p_source_key)) = 0 then raise exception 'XP source key is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'XP amount must be positive'; end if;

  insert into public.profile_xp_events(profile_id, source_key, amount)
  values (p_profile_id, p_source_key, p_amount)
  on conflict (profile_id, source_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.profiles set xp = xp + p_amount, updated_at = now() where id = p_profile_id;
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.xp_from_coin_trade_v06()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award_profile_xp(new.profile_id, 'coin-trade:' || new.id::text, 2);
  return new;
end;
$$;

drop trigger if exists xp_coin_trade_v06 on public.trades;
create trigger xp_coin_trade_v06 after insert on public.trades
for each row execute function public.xp_from_coin_trade_v06();

create or replace function public.xp_from_gift_trade_v06()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award_profile_xp(new.buyer_profile_id, 'gift-buy:' || new.id::text, 5);
  if new.seller_profile_id is not null then
    perform public.award_profile_xp(new.seller_profile_id, 'gift-sell:' || new.id::text, 5);
  end if;
  return new;
end;
$$;

drop trigger if exists xp_gift_trade_v06 on public.gift_trades;
create trigger xp_gift_trade_v06 after insert on public.gift_trades
for each row execute function public.xp_from_gift_trade_v06();

create or replace function public.xp_from_market_event_v06()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'launch' and new.actor_profile_id is not null then
    perform public.award_profile_xp(new.actor_profile_id, 'coin-launch:' || new.id::text, 10);
  end if;
  return new;
end;
$$;

drop trigger if exists xp_market_event_v06 on public.market_events;
create trigger xp_market_event_v06 after insert on public.market_events
for each row execute function public.xp_from_market_event_v06();

create or replace function public.xp_from_mission_claim_v06()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.claimed_at is null and new.claimed_at is not null then
    perform public.award_profile_xp(
      new.profile_id,
      'mission:' || new.mission_id::text || ':' || new.period_key,
      8
    );
  end if;
  return new;
end;
$$;

drop trigger if exists xp_mission_claim_v06 on public.user_missions;
create trigger xp_mission_claim_v06 after update of claimed_at on public.user_missions
for each row when (old.claimed_at is null and new.claimed_at is not null)
execute function public.xp_from_mission_claim_v06();

-- Deterministic backfill for activity completed before v0.6.
insert into public.profile_xp_events(profile_id, source_key, amount)
select t.profile_id, 'coin-trade:' || t.id::text, 2 from public.trades t
on conflict do nothing;

insert into public.profile_xp_events(profile_id, source_key, amount)
select gt.buyer_profile_id, 'gift-buy:' || gt.id::text, 5 from public.gift_trades gt
on conflict do nothing;

insert into public.profile_xp_events(profile_id, source_key, amount)
select gt.seller_profile_id, 'gift-sell:' || gt.id::text, 5 from public.gift_trades gt
where gt.seller_profile_id is not null
on conflict do nothing;

insert into public.profile_xp_events(profile_id, source_key, amount)
select me.actor_profile_id, 'coin-launch:' || me.id::text, 10 from public.market_events me
where me.kind='launch' and me.actor_profile_id is not null
on conflict do nothing;

insert into public.profile_xp_events(profile_id, source_key, amount)
select um.profile_id, 'mission:' || um.mission_id::text || ':' || um.period_key, 8
from public.user_missions um where um.claimed_at is not null
on conflict do nothing;

update public.profiles p
set xp = coalesce((select sum(e.amount)::bigint from public.profile_xp_events e where e.profile_id=p.id), 0),
    updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Persistent watchlist. A Gift watch follows a collection, not one virtual
--    ownership row, so it survives sales between players.
-- ---------------------------------------------------------------------------

create table if not exists public.user_watchlist (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('coin','gift_collection')),
  coin_id uuid references public.coins(id) on delete cascade,
  gift_collection text,
  created_at timestamptz not null default now(),
  check (
    (kind='coin' and coin_id is not null and gift_collection is null)
    or (kind='gift_collection' and coin_id is null and gift_collection is not null and char_length(trim(gift_collection)) > 0)
  )
);
create unique index if not exists user_watchlist_coin_v06_uidx on public.user_watchlist(profile_id, coin_id) where kind='coin';
create unique index if not exists user_watchlist_collection_v06_uidx on public.user_watchlist(profile_id, gift_collection) where kind='gift_collection';
create index if not exists user_watchlist_profile_v06_idx on public.user_watchlist(profile_id, created_at desc);
alter table public.user_watchlist enable row level security;
revoke all on table public.user_watchlist from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Richer coin market metrics from actual reserves/trades/candles.
-- ---------------------------------------------------------------------------

create or replace view public.market_overview with (security_invoker=true) as
select
  c.id,c.creator_profile_id,c.name,c.symbol,c.description,c.current_price,c.market_cap,c.status,c.created_at,
  coalesce((select sum(t.quote_amount) from public.trades t where t.coin_id=c.id and t.created_at>=now()-interval '24 hours'),0) as volume_24h,
  case when fc.open is null or fc.open=0 then 0 else ((c.current_price/fc.open)-1)*100 end as change_24h,
  coalesce((select count(*) from public.holdings h where h.coin_id=c.id and h.quantity>0),0) as holder_count,
  coalesce((select count(*) from public.trades t where t.coin_id=c.id and t.created_at>=now()-interval '24 hours'),0) as trade_count_24h,
  coalesce(nullif(p.username,''),p.first_name) as creator_name,
  c.quote_reserve * 2 as liquidity,
  coalesce((select sum(t.quote_amount) from public.trades t where t.coin_id=c.id),0) as all_time_volume,
  coalesce((select max(ca.high) from public.candles ca where ca.coin_id=c.id),c.current_price) as ath_price,
  coalesce((select sum(t.quote_amount) from public.trades t where t.coin_id=c.id and t.side='buy' and t.created_at>=now()-interval '24 hours'),0) as buy_volume_24h,
  coalesce((select sum(t.quote_amount) from public.trades t where t.coin_id=c.id and t.side='sell' and t.created_at>=now()-interval '24 hours'),0) as sell_volume_24h
from public.coins c
left join public.profiles p on p.id=c.creator_profile_id
left join lateral (
  select ca.open from public.candles ca where ca.coin_id=c.id and ca.bucket_start>=now()-interval '24 hours' order by ca.bucket_start asc limit 1
) fc on true;

grant select on public.market_overview to service_role;
grant select, insert, delete on public.user_watchlist to service_role;
grant select on public.profile_xp_events to service_role;

revoke execute on function public.award_profile_xp(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.award_profile_xp(uuid,text,integer) to service_role;

commit;
