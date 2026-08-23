-- MemeX Market v0.64.8 — Orders runtime compatibility.
-- Safe to run whether or not 9999_existing_systems_polish.sql was already applied.
-- Adds the seller-at-offer-time denormalization used by /api/orders and Realtime.

begin;

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

create index if not exists gift_offers_buyer_pending_created_idx
  on public.gift_offers(buyer_profile_id, created_at desc)
  where status = 'pending';

create index if not exists gift_offers_seller_pending_amount_idx
  on public.gift_offers(seller_profile_id, amount desc)
  where status = 'pending';

create index if not exists gift_offers_gift_pending_idx
  on public.gift_offers(virtual_gift_id, amount desc)
  where status = 'pending';

revoke all on function public.mxm_fill_gift_offer_seller() from public, anon, authenticated;
grant execute on function public.mxm_fill_gift_offer_seller() to service_role;

commit;

notify pgrst, 'reload schema';
