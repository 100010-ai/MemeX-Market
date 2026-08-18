begin;

-- MXM v0.9 — compact marketplace flow inspired by mature Telegram gift markets.
-- No demo assets are inserted. Cart and market discovery operate only on real
-- Telegram Gift rows already present in gift_assets / virtual_gifts.

create table if not exists public.market_cart_items (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  virtual_gift_id uuid not null references public.virtual_gifts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (profile_id, virtual_gift_id)
);
create index if not exists market_cart_items_profile_added_idx on public.market_cart_items(profile_id, added_at desc);
alter table public.market_cart_items enable row level security;
revoke all on public.market_cart_items from public, anon, authenticated;
grant all on public.market_cart_items to service_role;

create or replace function public.buy_virtual_gift_cart(p_buyer_id uuid, p_virtual_gift_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_buyer public.profiles;
  v_gift public.virtual_gifts;
  v_asset public.gift_assets;
  v_count integer;
  v_total numeric := 0;
  v_reserved_other numeric := 0;
  v_realized numeric;
  v_results jsonb := '[]'::jsonb;
begin
  if p_virtual_gift_ids is null or cardinality(p_virtual_gift_ids) < 1 or cardinality(p_virtual_gift_ids) > 20 then
    raise exception 'Cart must contain between 1 and 20 Gifts';
  end if;

  select count(distinct value) into v_count from unnest(p_virtual_gift_ids) as t(value);
  if v_count <> cardinality(p_virtual_gift_ids) then raise exception 'Cart contains duplicate Gifts'; end if;

  select * into v_buyer from public.profiles where id=p_buyer_id for update;
  if not found then raise exception 'Buyer not found'; end if;

  -- Lock every listing in deterministic order so checkout is atomic.
  v_count := 0;
  for v_gift in
    select * from public.virtual_gifts
    where id = any(p_virtual_gift_ids)
    order by id
    for update
  loop
    v_count := v_count + 1;
    if v_gift.status <> 'listed' or v_gift.listing_price is null then raise exception 'One or more Gifts are no longer listed'; end if;
    if v_gift.owner_profile_id = p_buyer_id then raise exception 'Cart contains a Gift you already own'; end if;
    select * into v_asset from public.gift_assets where id=v_gift.asset_id for share;
    if not found then raise exception 'Gift asset is missing'; end if;
    if v_asset.is_burned then raise exception 'Cart contains a burned Gift'; end if;
    v_total := v_total + v_gift.listing_price;
  end loop;
  if v_count <> cardinality(p_virtual_gift_ids) then raise exception 'One or more Gifts do not exist'; end if;

  -- Lock sellers in stable order after the gift rows are locked.
  perform 1 from public.profiles p
  where p.id in (
    select distinct vg.owner_profile_id from public.virtual_gifts vg where vg.id = any(p_virtual_gift_ids)
  )
  order by p.id
  for update;

  select coalesce(sum(go.amount),0) into v_reserved_other
  from public.gift_offers go
  where go.buyer_profile_id=p_buyer_id
    and go.status='pending'
    and not (go.virtual_gift_id = any(p_virtual_gift_ids));

  if v_buyer.balance - v_reserved_other < v_total then raise exception 'Insufficient available balance'; end if;

  update public.profiles set balance=balance-v_total where id=p_buyer_id;

  for v_gift in
    select * from public.virtual_gifts
    where id = any(p_virtual_gift_ids)
    order by id
  loop
    select * into v_asset from public.gift_assets where id=v_gift.asset_id;
    v_realized := v_gift.listing_price - v_gift.acquired_price;

    update public.profiles set balance=balance+v_gift.listing_price where id=v_gift.owner_profile_id;
    update public.virtual_gifts
      set owner_profile_id=p_buyer_id,
          acquired_price=v_gift.listing_price,
          last_sale_price=v_gift.listing_price,
          listing_price=null,
          status='owned'
      where id=v_gift.id;
    update public.gift_offers set status='rejected' where virtual_gift_id=v_gift.id and status='pending';
    delete from public.market_cart_items where virtual_gift_id=v_gift.id;
    insert into public.gift_trades(virtual_gift_id,asset_id,buyer_profile_id,seller_profile_id,price,realized_pnl)
      values(v_gift.id,v_gift.asset_id,p_buyer_id,v_gift.owner_profile_id,v_gift.listing_price,v_realized);
    perform public.record_gift_collection_candle(v_asset.base_name,v_gift.listing_price);
    perform public.bump_mission(p_buyer_id,'gift_buy',1);
    perform public.bump_mission(v_gift.owner_profile_id,'gift_sell',1);
    if v_realized > 0 then perform public.bump_mission(v_gift.owner_profile_id,'profitable_gift_sale',1); end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'virtualGiftId',v_gift.id,
      'price',v_gift.listing_price
    ));
  end loop;

  delete from public.market_cart_items where profile_id=p_buyer_id and virtual_gift_id = any(p_virtual_gift_ids);
  return jsonb_build_object('itemCount',v_count,'total',v_total,'items',v_results);
end;
$$;

revoke execute on function public.buy_virtual_gift_cart(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.buy_virtual_gift_cart(uuid,uuid[]) to service_role;

create or replace function public.gift_item_market_stats(p_virtual_gift_id uuid)
returns table(trade_count bigint, volume numeric, high_sale numeric, low_sale numeric)
language sql security definer set search_path=public stable as $$
  select count(*)::bigint,coalesce(sum(gt.price),0),max(gt.price),min(gt.price)
  from public.gift_trades gt where gt.virtual_gift_id=p_virtual_gift_id;
$$;
revoke execute on function public.gift_item_market_stats(uuid) from public,anon,authenticated;
grant execute on function public.gift_item_market_stats(uuid) to service_role;

-- Compatibility guard: older databases may have skipped the v0.8 catalogue
-- migration. Do not let the v0.9 flow migration fail just because this column
-- was not present yet. The full v0.9.2 compatibility migration repairs the
-- remaining catalogue/NPC schema.
alter table public.gift_assets add column if not exists catalog_source text not null default 'profile_sync';

-- Diversify system liquidity across collections instead of filling the market
-- with many consecutive assets from one collection.
create or replace function public.npc_market_candidates(p_limit integer default 80)
returns table(
  asset_id uuid,
  base_name text,
  gift_number integer,
  model_rarity_per_mille integer,
  symbol_rarity_per_mille integer,
  backdrop_rarity_per_mille integer,
  last_seen_at timestamptz
) language sql security definer set search_path=public stable as $$
  with ranked as (
    select ga.*,
           row_number() over (partition by ga.base_name order by ga.last_seen_at desc,ga.id) as collection_rank
    from public.gift_assets ga
    where ga.catalog_source='bot_catalog'
      and ga.is_burned=false
      and ga.telegram_name is not null
      and not exists(select 1 from public.virtual_gifts vg where vg.asset_id=ga.id)
  )
  select r.id,r.base_name,r.gift_number,r.model_rarity_per_mille,r.symbol_rarity_per_mille,r.backdrop_rarity_per_mille,r.last_seen_at
  from ranked r
  order by r.collection_rank asc,r.last_seen_at desc,r.base_name,r.id
  limit greatest(1,least(coalesce(p_limit,80),240));
$$;
revoke execute on function public.npc_market_candidates(integer) from public,anon,authenticated;
grant execute on function public.npc_market_candidates(integer) to service_role;

commit;
