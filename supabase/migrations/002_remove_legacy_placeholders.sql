begin;

-- v0.2 shipped visual demo assets. v0.4 removes them permanently.
-- The Gift market must contain only assets whose identity and media came from Telegram.
delete from public.gift_collection_candles
where base_name in ('Stellar Rocket','Candy Cane','Vice Cream','Durov''s Glasses','Lunar Snake','Light Sword','Snake Box','Heart Locket');

delete from public.virtual_gifts
where asset_id in (
  select id from public.gift_assets
  where telegram_name is null
     or model_file_id is null
     or symbol_file_id is null
     or base_name in ('Stellar Rocket','Candy Cane','Vice Cream','Durov''s Glasses','Lunar Snake','Light Sword','Snake Box','Heart Locket')
);

delete from public.gift_assets
where telegram_name is null
   or model_file_id is null
   or symbol_file_id is null
   or base_name in ('Stellar Rocket','Candy Cane','Vice Cream','Durov''s Glasses','Lunar Snake','Light Sword','Snake Box','Heart Locket');

-- Remove the old seeded coin market as well. Player-created coins always have a creator.
delete from public.coins
where creator_profile_id is null
  and symbol in ('KCAT','ERR404','CAPY','BONKO','FROG','PRAT');

-- v0.2 databases did not have realized PnL columns used by the current RPCs.
alter table public.trades add column if not exists realized_pnl numeric(24,8) not null default 0;
alter table public.gift_trades add column if not exists realized_pnl numeric(24,8) not null default 0;
create index if not exists gift_trades_seller_created_idx on public.gift_trades(seller_profile_id, created_at desc);


update public.missions set description='Place an offer on another player’s Gift.' where key='daily_offer';
update public.missions set description='List one of your Gifts for sale.' where key='daily_listing';
update public.missions set description='Buy 4 Gifts this week.' where key='weekly_collector';

-- After legacy rows are gone, every Gift record must have actual Telegram identity/media.
alter table public.gift_assets alter column telegram_name set not null;
alter table public.gift_assets alter column model_file_id set not null;
alter table public.gift_assets alter column symbol_file_id set not null;
create unique index if not exists gift_assets_base_number_unique_idx on public.gift_assets(base_name, gift_number);

update public.virtual_gifts set listing_price = null where status = 'owned' and listing_price is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.virtual_gifts'::regclass
      and conname = 'virtual_gifts_listing_state_strict'
  ) then
    alter table public.virtual_gifts
      add constraint virtual_gifts_listing_state_strict
      check ((status='listed' and listing_price is not null) or (status='owned' and listing_price is null));
  end if;
end $$;

-- If the database came from v0.2, these columns are now obsolete. Drop them only when present.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='gift_assets' and column_name='demo_emoji') then
    alter table public.gift_assets drop column demo_emoji;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='gift_assets' and column_name='reference_price') then
    alter table public.gift_assets drop column reference_price;
  end if;
end $$;

commit;
