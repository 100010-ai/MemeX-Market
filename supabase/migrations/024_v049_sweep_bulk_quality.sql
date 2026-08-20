begin;

-- MXM v0.49 — atomic bulk listing and marketplace quality fixes.
-- Sweep purchasing reuses buy_virtual_gift_cart_v2 so the whole sweep either
-- succeeds or rolls back when a listing changes while the user confirms.

create or replace function public.bulk_list_virtual_gifts_v049(
  p_profile_id uuid,
  p_virtual_gift_ids uuid[],
  p_mode text,
  p_fixed_price numeric default null,
  p_floor_offset_bps integer default -300,
  p_duration_days integer default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_id uuid;
  v_gift public.virtual_gifts;
  v_asset public.gift_assets;
  v_floor numeric;
  v_price numeric;
  v_count integer:=0;
  v_results jsonb:='[]'::jsonb;
begin
  if p_virtual_gift_ids is null or cardinality(p_virtual_gift_ids)<1 or cardinality(p_virtual_gift_ids)>50 then
    raise exception 'Select between 1 and 50 Gifts';
  end if;
  if (select count(distinct x) from unnest(p_virtual_gift_ids) as t(x))<>cardinality(p_virtual_gift_ids) then
    raise exception 'Gift selection contains duplicates';
  end if;
  if p_mode not in ('fixed','floor') then raise exception 'Invalid bulk listing mode'; end if;
  if p_mode='fixed' and (p_fixed_price is null or p_fixed_price<0.01 or p_fixed_price>1000000000) then
    raise exception 'Invalid fixed listing price';
  end if;
  if p_mode='floor' and (p_floor_offset_bps is null or p_floor_offset_bps < -9000 or p_floor_offset_bps > 100000) then
    raise exception 'Floor offset must be between -90% and +1000%';
  end if;
  if p_duration_days is not null and (p_duration_days<1 or p_duration_days>30) then
    raise exception 'Listing duration must be between 1 and 30 days';
  end if;

  -- Lock selected Gifts in deterministic order so concurrent bulk actions do
  -- not deadlock each other.
  perform 1 from public.virtual_gifts where id=any(p_virtual_gift_ids) order by id for update;

  for v_id in select x from unnest(p_virtual_gift_ids) as t(x) order by x loop
    select * into v_gift from public.virtual_gifts where id=v_id;
    if not found then raise exception 'Gift % not found',v_id; end if;
    if v_gift.owner_profile_id is distinct from p_profile_id then raise exception 'You do not own one of the selected Gifts'; end if;
    select * into v_asset from public.gift_assets where id=v_gift.asset_id;
    if not found then raise exception 'Gift asset is missing'; end if;
    if v_asset.is_burned then raise exception 'A selected Gift is burned'; end if;

    if p_mode='fixed' then
      v_price:=round(p_fixed_price,8);
    else
      select min(other.listing_price) into v_floor
      from public.virtual_gifts other
      join public.gift_assets other_asset on other_asset.id=other.asset_id
      where other_asset.base_name=v_asset.base_name
        and other_asset.is_burned=false
        and not (other.id=any(p_virtual_gift_ids))
        and other.status='listed'
        and other.listing_price is not null
        and (other.listing_expires_at is null or other.listing_expires_at>now());
      if v_floor is null then raise exception 'No active floor for collection %',v_asset.base_name; end if;
      v_price:=round(v_floor*(1+p_floor_offset_bps/10000.0),8);
      if v_price<0.01 then v_price:=0.01; end if;
      if v_price>1000000000 then raise exception 'Calculated listing price is too high'; end if;
    end if;

    perform public.list_virtual_gift_v2(p_profile_id,v_id,v_price,p_duration_days);
    v_count:=v_count+1;
    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'virtualGiftId',v_id,'baseName',v_asset.base_name,'price',v_price
    ));
  end loop;

  return jsonb_build_object('count',v_count,'mode',p_mode,'items',v_results);
end;
$$;

revoke execute on function public.bulk_list_virtual_gifts_v049(uuid,uuid[],text,numeric,integer,integer) from public,anon,authenticated;
grant execute on function public.bulk_list_virtual_gifts_v049(uuid,uuid[],text,numeric,integer,integer) to service_role;

commit;
