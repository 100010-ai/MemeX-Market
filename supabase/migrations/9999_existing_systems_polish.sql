-- Existing systems production polish.
-- No new product mechanics: this migration only makes the current offers,
-- portfolio/history, notifications and player-facing reads scale safely.

begin;

-- ---------------------------------------------------------------------------
-- Gift offers: persist the seller-at-offer-time so Orders Realtime/API can be
-- scoped to one player instead of subscribing/querying every offer globally.
-- ---------------------------------------------------------------------------
alter table public.gift_offers
  add column if not exists seller_profile_id uuid references public.profiles(id) on delete set null;

update public.gift_offers go
set seller_profile_id = vg.owner_profile_id
from public.virtual_gifts vg
where vg.id = go.virtual_gift_id
  and go.seller_profile_id is null;

create or replace function public.mxm_fill_gift_offer_seller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select vg.owner_profile_id into new.seller_profile_id
  from public.virtual_gifts vg
  where vg.id = new.virtual_gift_id;
  if new.seller_profile_id is null then
    raise exception 'Gift not found';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mxm_fill_gift_offer_seller on public.gift_offers;
create trigger trg_mxm_fill_gift_offer_seller
before insert or update of virtual_gift_id on public.gift_offers
for each row execute function public.mxm_fill_gift_offer_seller();

-- ---------------------------------------------------------------------------
-- Hot-path indexes used by existing pages/APIs.
-- ---------------------------------------------------------------------------
create index if not exists gift_offers_buyer_pending_created_idx
  on public.gift_offers(buyer_profile_id, created_at desc)
  where status = 'pending';
create index if not exists gift_offers_seller_pending_amount_idx
  on public.gift_offers(seller_profile_id, amount desc)
  where status = 'pending';
create index if not exists gift_offers_gift_pending_idx
  on public.gift_offers(virtual_gift_id, amount desc)
  where status = 'pending';

create index if not exists virtual_gifts_owner_status_created_idx
  on public.virtual_gifts(owner_profile_id, status, created_at desc);
create index if not exists virtual_gifts_owner_listed_price_idx
  on public.virtual_gifts(owner_profile_id, listing_price)
  where status = 'listed' and listing_price is not null;

create index if not exists trades_profile_created_idx
  on public.trades(profile_id, created_at desc);
create index if not exists gift_trades_buyer_created_idx
  on public.gift_trades(buyer_profile_id, created_at desc);
create index if not exists gift_trades_seller_created_idx
  on public.gift_trades(seller_profile_id, created_at desc)
  where seller_profile_id is not null;
create index if not exists holdings_profile_quantity_idx
  on public.holdings(profile_id, quantity)
  where quantity > 0;
create index if not exists holdings_coin_quantity_idx
  on public.holdings(coin_id, profile_id)
  where quantity > 0;
create index if not exists coin_fee_ledger_coin_created_idx
  on public.coin_fee_ledger(coin_id, created_at desc);

create index if not exists portfolio_snapshots_profile_bucket_desc_idx
  on public.portfolio_snapshots(profile_id, bucket_start desc);

create index if not exists notifications_profile_created_idx
  on public.user_notifications(profile_id, created_at desc);
create index if not exists notifications_profile_unread_idx
  on public.user_notifications(profile_id, created_at desc)
  where read_at is null;

create index if not exists referral_rewards_referrer_created_idx
  on public.referral_rewards(referrer_profile_id, created_at desc);
create index if not exists user_missions_profile_period_idx
  on public.user_missions(profile_id, period_key, updated_at desc);
create index if not exists gift_listing_events_gift_created_idx
  on public.gift_listing_events(virtual_gift_id, created_at desc);
create index if not exists gift_listing_events_created_idx
  on public.gift_listing_events(created_at desc);
create index if not exists market_events_created_idx
  on public.market_events(created_at desc);
create index if not exists gift_trades_gift_created_idx
  on public.gift_trades(virtual_gift_id, created_at desc);
create index if not exists market_cart_profile_added_idx
  on public.market_cart_items(profile_id, added_at desc);
create index if not exists watchlist_profile_created_idx
  on public.user_watchlist(profile_id, created_at desc);
create index if not exists price_alerts_profile_enabled_idx
  on public.price_alerts(profile_id, created_at desc) where enabled=true;
create index if not exists conditional_orders_profile_status_created_idx
  on public.coin_conditional_orders_v056(profile_id, status, created_at desc);
create index if not exists user_achievements_profile_unlocked_idx
  on public.user_achievements(profile_id, unlocked_at desc);
create index if not exists season_claims_profile_claimed_idx
  on public.season_claims(profile_id, claimed_at desc);

-- Existing market/search hot paths. pg_trgm is available on Supabase Postgres
-- and keeps substring search from degrading into full-table scans as the Gift
-- catalogue and public profile directory grow.
create extension if not exists pg_trgm;
create index if not exists gift_assets_base_name_trgm_idx
  on public.gift_assets using gin (base_name gin_trgm_ops);
create index if not exists gift_assets_model_name_trgm_idx
  on public.gift_assets using gin (model_name gin_trgm_ops);
create index if not exists gift_assets_backdrop_name_trgm_idx
  on public.gift_assets using gin (backdrop_name gin_trgm_ops);
create index if not exists gift_assets_symbol_name_trgm_idx
  on public.gift_assets using gin (symbol_name gin_trgm_ops);
create index if not exists coins_name_trgm_idx
  on public.coins using gin (name gin_trgm_ops);
create index if not exists coins_symbol_trgm_idx
  on public.coins using gin (symbol gin_trgm_ops);
create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (username gin_trgm_ops) where is_system=false;
create index if not exists profiles_first_name_trgm_idx
  on public.profiles using gin (first_name gin_trgm_ops) where is_system=false;
create index if not exists virtual_gifts_active_market_price_idx
  on public.virtual_gifts(listing_price, listed_at desc)
  where status='listed' and listing_price is not null;
create index if not exists coins_active_market_created_idx
  on public.coins(created_at desc) where status='active' and hidden_from_market=false;

-- Existing production data may already contain duplicate active alerts from
-- requests that raced before this migration. Keep the newest row active and
-- disable older duplicates before installing the uniqueness guards.
with ranked as (
  select id, row_number() over (
    partition by profile_id, kind, coin_id, direction, target_price
    order by created_at desc, id desc
  ) as rn
  from public.price_alerts
  where enabled=true and kind='coin' and coin_id is not null
)
update public.price_alerts p set enabled=false, updated_at=now()
from ranked r where p.id=r.id and r.rn>1;

with ranked as (
  select id, row_number() over (
    partition by profile_id, kind, virtual_gift_id, direction, target_price
    order by created_at desc, id desc
  ) as rn
  from public.price_alerts
  where enabled=true and kind='gift' and virtual_gift_id is not null
)
update public.price_alerts p set enabled=false, updated_at=now()
from ranked r where p.id=r.id and r.rn>1;

with ranked as (
  select id, row_number() over (
    partition by profile_id, kind, gift_collection, direction, target_price
    order by created_at desc, id desc
  ) as rn
  from public.price_alerts
  where enabled=true and kind='gift_collection' and gift_collection is not null
)
update public.price_alerts p set enabled=false, updated_at=now()
from ranked r where p.id=r.id and r.rn>1;

-- Two concurrent clients must not be able to create the same active alert
-- after both pass the application-level duplicate check.
create unique index if not exists price_alerts_unique_active_coin_idx
  on public.price_alerts(profile_id,coin_id,direction,target_price)
  where enabled=true and kind='coin' and coin_id is not null;
create unique index if not exists price_alerts_unique_active_gift_idx
  on public.price_alerts(profile_id,virtual_gift_id,direction,target_price)
  where enabled=true and kind='gift' and virtual_gift_id is not null;
create unique index if not exists price_alerts_unique_active_collection_idx
  on public.price_alerts(profile_id,gift_collection,direction,target_price)
  where enabled=true and kind='gift_collection' and gift_collection is not null;

-- Existing notification preferences are optional at read time, but backfill
-- them once so current users have an explicit row without a write on every GET.
insert into public.notification_preferences(profile_id)
select p.id
from public.profiles p
on conflict (profile_id) do nothing;

revoke execute on function public.mxm_fill_gift_offer_seller() from public, anon, authenticated;
grant execute on function public.mxm_fill_gift_offer_seller() to service_role;

commit;
