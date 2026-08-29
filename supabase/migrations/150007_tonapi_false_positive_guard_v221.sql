-- MemeX Market v2.21: reject TonAPI collections that only imitate Telegram Gifts.
-- Preserve user-owned/history rows; only withdraw system market inventory.

create table if not exists public.tonapi_gift_collection_rejections_v221 (
  address text primary key,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tonapi_gift_collection_rejections_v221 enable row level security;
revoke all on table public.tonapi_gift_collection_rejections_v221 from public, anon, authenticated;
grant all on table public.tonapi_gift_collection_rejections_v221 to service_role;

insert into public.tonapi_gift_collection_rejections_v221(address,reason)
values
  ('0:4b1448be92504e94173494c164f267aeabfde5e40ec8b367028d2d153604a139','Known third-party collection; metadata advertises future Telegram/status conversion rather than an official Telegram collectible')
on conflict(address) do update set reason=excluded.reason,updated_at=now();

-- Capture already-discovered collections with explicit future/tribute/staging language.
-- These are not treated as official gifts simply because their metadata mentions Telegram.
insert into public.tonapi_gift_collection_rejections_v221(address,reason)
select c.address,'Rejected by Telegram Gift semantic guard'
from public.tonapi_gift_collections c
where lower(coalesce(c.name,'')) like '%[staging]%'
   or lower(coalesce(c.description,'')) ~ '(hope.{0,120}soon|will be able to|convert.{0,160}(telegram )?gifts?|tribute to telegram gifts?|inspired by telegram.{0,80}gifts?|for our app.{0,120}(telegram|status)|our application.{0,120}(telegram|status))'
on conflict(address) do update set reason=excluded.reason,updated_at=now();

create or replace function public.guard_tonapi_gift_collection_v221()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text := lower(coalesce(new.name,'') || E'\n' || coalesce(new.description,''));
  v_reason text;
begin
  select r.reason into v_reason
  from public.tonapi_gift_collection_rejections_v221 r
  where r.address = new.address;

  if v_reason is null and (
       lower(coalesce(new.name,'')) like '%[staging]%'
       or v_text ~ '(hope.{0,120}soon|will be able to|convert.{0,160}(telegram )?gifts?|tribute to telegram gifts?|inspired by telegram.{0,80}gifts?|for our app.{0,120}(telegram|status)|our application.{0,120}(telegram|status))'
  ) then
    v_reason := 'Rejected by Telegram Gift semantic guard';
  end if;

  if v_reason is not null then
    new.active := false;
    new.last_error := left(v_reason,1000);
  end if;
  return new;
end;
$$;

revoke all on function public.guard_tonapi_gift_collection_v221() from public, anon, authenticated;

drop trigger if exists tonapi_gift_collection_guard_v221 on public.tonapi_gift_collections;
create trigger tonapi_gift_collection_guard_v221
before insert or update of address,name,description,active
on public.tonapi_gift_collections
for each row execute function public.guard_tonapi_gift_collection_v221();

-- Deactivate rejected source rows. Do not delete source/assets because historical trades
-- and a user-owned collectible may still reference them.
update public.tonapi_gift_collections c
set active=false,
    last_error=left(r.reason,1000),
    updated_at=now()
from public.tonapi_gift_collection_rejections_v221 r
where c.address=r.address
  and (c.active is distinct from false or c.last_error is distinct from left(r.reason,1000));

-- Remove only MXM/system inventory from the live market. User-owned collectibles and
-- gift_trades remain untouched for audit/history integrity.
update public.virtual_gifts vg
set status='owned',
    listing_price=null,
    listed_at=null,
    listed_by_profile_id=null,
    updated_at=now()
from public.gift_assets ga, public.profiles owner
where vg.asset_id=ga.id
  and vg.owner_profile_id=owner.id
  and owner.is_system=true
  and vg.status='listed'
  and ga.chain_collection_address in (
    select address from public.tonapi_gift_collection_rejections_v221
  );
