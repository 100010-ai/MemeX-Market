begin;

-- Automatic, idempotent virtual-fulfilment reversal for Telegram Stars refunds.
create table if not exists public.star_purchase_reversals_v074 (
  purchase_id uuid primary key references public.star_purchases(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  product_sku text,
  status text not null check(status in ('processing','reversed','partial','manual_review')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create table if not exists public.referral_reward_reversals_v074 (
  reward_id uuid primary key references public.referral_rewards(id) on delete cascade,
  purchase_id uuid not null references public.star_purchases(id) on delete cascade,
  referrer_profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check(amount>0),
  deficit numeric not null default 0 check(deficit>=0),
  unit text not null check(unit in ('mxm_coins','virtual_ton')),
  created_at timestamptz not null default now(),
  unique(purchase_id,reward_id)
);
alter table public.star_purchase_reversals_v074 enable row level security;
alter table public.referral_reward_reversals_v074 enable row level security;
revoke all on public.star_purchase_reversals_v074,public.referral_reward_reversals_v074 from public,anon,authenticated;
grant select,insert,update,delete on public.star_purchase_reversals_v074,public.referral_reward_reversals_v074 to service_role;

create or replace function public.reverse_star_purchase_fulfillment_v074(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_purchase public.star_purchases; v_existing public.star_purchase_reversals_v074; v_metadata jsonb:='{}'::jsonb; v_reward jsonb:='{}'::jsonb;
  v_status text:='reversed'; v_details jsonb:='{}'::jsonb; v_amount numeric:=0; v_available numeric:=0; v_removed integer:=0; v_qty integer:=1;
  v_days integer:=0; v_item text; v_entitlement text; v_reward_row public.referral_rewards; v_ref_available numeric:=0; v_ref_deficit numeric:=0;
begin
  select * into v_purchase from public.star_purchases where id=p_purchase_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  select * into v_existing from public.star_purchase_reversals_v074 where purchase_id=p_purchase_id;
  if found and v_existing.status<>'processing' then return jsonb_build_object('status',v_existing.status,'alreadyReversed',true,'details',v_existing.details); end if;
  if v_purchase.status<>'refunded' then raise exception 'Purchase must be refunded before virtual reversal'; end if;
  if not found then null; end if;
  insert into public.star_purchase_reversals_v074(purchase_id,profile_id,product_sku,status)
  values(v_purchase.id,v_purchase.profile_id,v_purchase.product_sku,'processing') on conflict(purchase_id) do nothing;

  v_metadata:=coalesce(v_purchase.reserved_grant->'metadata','{}'::jsonb);
  select coalesce(metadata->'reward','{}'::jsonb) into v_reward from public.economy_events
  where reference_id=v_purchase.id and kind in ('store','stars') order by created_at desc limit 1;
  v_reward:=coalesce(v_reward,'{}'::jsonb);

  -- Stars/VIP accounting is always reversible and must never stay inflated.
  update public.profiles set stars_spent=greatest(0,stars_spent-v_purchase.stars),vip_points=greatest(0,vip_points-v_purchase.stars),updated_at=now()
  where id=v_purchase.profile_id;

  if v_purchase.product_sku is null then
    v_amount:=greatest(0,coalesce(v_purchase.ton_reward,0));
    select balance into v_available from public.profiles where id=v_purchase.profile_id for update;
    update public.profiles set balance=greatest(0,balance-v_amount),updated_at=now() where id=v_purchase.profile_id;
    if coalesce(v_available,0)<v_amount then v_status:='partial'; v_details:=v_details||jsonb_build_object('virtualTonDebt',v_amount-coalesce(v_available,0)); end if;
  elsif coalesce(v_reward->>'kind','')='mxm_coins' or v_metadata ? 'mxmCoins' then
    v_amount:=greatest(0,coalesce(nullif(v_reward->>'amount','')::numeric,nullif(v_metadata->>'mxmCoins','')::numeric,0));
    select mxm_coins into v_available from public.profiles where id=v_purchase.profile_id for update;
    update public.profiles set mxm_coins=greatest(0,mxm_coins-least(mxm_coins,v_amount::bigint)),updated_at=now() where id=v_purchase.profile_id;
    if coalesce(v_available,0)<v_amount then v_status:='partial'; v_details:=v_details||jsonb_build_object('mxmDebt',v_amount-coalesce(v_available,0)); end if;
  elsif v_metadata->>'entitlement'='premium' then
    v_days:=greatest(1,coalesce((v_metadata->>'durationDays')::integer,30));
    update public.profile_entitlements set expires_at=expires_at-make_interval(days=>v_days),updated_at=now()
    where profile_id=v_purchase.profile_id and entitlement_key='premium';
    update public.profiles set premium_until=case when premium_until is null then null else premium_until-make_interval(days=>v_days) end,updated_at=now() where id=v_purchase.profile_id;
    delete from public.profile_entitlements where profile_id=v_purchase.profile_id and entitlement_key='premium' and expires_at<=now();
    if not exists(select 1 from public.profile_entitlements where profile_id=v_purchase.profile_id and entitlement_key='premium' and (expires_at is null or expires_at>now())) then
      update public.profiles set max_energy=case when max_energy=150 then 100 else max_energy end,energy=least(energy,case when max_energy=150 then 100 else max_energy end),energy_updated_at=now(),updated_at=now() where id=v_purchase.profile_id;
    end if;
  elsif v_metadata->>'entitlement'='season_pass' then
    delete from public.profile_entitlements where profile_id=v_purchase.profile_id and entitlement_key='season_pass' and coalesce(metadata->>'purchaseId','')=v_purchase.id::text;
    get diagnostics v_removed=row_count;
    if v_removed=0 then v_status:='partial'; v_details:=v_details||jsonb_build_object('seasonPass','already_consumed_or_replaced'); end if;
  elsif v_metadata ? 'caseTier' then
    v_qty:=greatest(1,coalesce((v_purchase.reserved_grant->>'quantity')::integer,1));
    select coalesce(quantity,0) into v_removed from public.profile_inventory where profile_id=v_purchase.profile_id and sku=v_purchase.product_sku for update;
    v_removed:=least(coalesce(v_removed,0),v_qty);
    if v_removed>0 then
      update public.profile_inventory set quantity=quantity-v_removed,updated_at=now() where profile_id=v_purchase.profile_id and sku=v_purchase.product_sku;
      delete from public.profile_inventory where profile_id=v_purchase.profile_id and sku=v_purchase.product_sku and quantity<=0;
      update public.case_definitions set remaining_supply=case when remaining_supply is null then null else remaining_supply+v_removed end where sku=v_purchase.product_sku;
    end if;
    if v_removed<v_qty then v_status:='partial'; v_details:=v_details||jsonb_build_object('consumedCases',v_qty-v_removed,'restoredCases',v_removed); end if;
  elsif coalesce((v_metadata->>'energyRefill')::boolean,false) then
    v_status:='manual_review'; v_details:=v_details||jsonb_build_object('energyRefill','consumption_cannot_be_reconstructed_safely');
  elsif v_metadata->>'creatorTool'='boost' then
    delete from public.coin_boosts where purchase_id=v_purchase.id; get diagnostics v_removed=row_count;
    if v_removed=0 then v_status:='partial'; v_details:=v_details||jsonb_build_object('creatorBoost','already_expired_or_consumed'); end if;
  elsif v_metadata ? 'profileItem' then
    v_item:=v_metadata->>'profileItem';
    delete from public.profile_item_inventory where profile_id=v_purchase.profile_id and item_key=v_item and source_reference=v_purchase.id; get diagnostics v_removed=row_count;
    if v_removed>0 then update public.profiles set equipped_profile_frame=null,updated_at=now() where id=v_purchase.profile_id and equipped_profile_frame=v_item;
    else v_status:='partial'; v_details:=v_details||jsonb_build_object('profileItem',coalesce(v_item,'unknown'),'state','not_purchase_owned'); end if;
  elsif v_metadata ? 'entitlement' then
    v_entitlement:=v_metadata->>'entitlement'; v_days:=greatest(1,coalesce((v_metadata->>'durationDays')::integer,30));
    update public.profile_entitlements set expires_at=expires_at-make_interval(days=>v_days),updated_at=now() where profile_id=v_purchase.profile_id and entitlement_key=v_entitlement;
    get diagnostics v_removed=row_count;
    delete from public.profile_entitlements where profile_id=v_purchase.profile_id and entitlement_key=v_entitlement and expires_at<=now();
    if v_removed=0 then v_status:='partial'; v_details:=v_details||jsonb_build_object('entitlement',v_entitlement,'state','missing'); end if;
  else
    v_status:='manual_review'; v_details:=v_details||jsonb_build_object('fulfillment','unknown_product_shape');
  end if;

  -- Reverse referral emission tied to this exact purchase. Keep the original
  -- reward row as immutable history and record the compensating reversal.
  for v_reward_row in select * from public.referral_rewards where reference_id=v_purchase.id loop
    if not exists(select 1 from public.referral_reward_reversals_v074 where reward_id=v_reward_row.id) then
      if v_reward_row.source_kind='store' then
        select mxm_coins into v_ref_available from public.profiles where id=v_reward_row.referrer_profile_id for update;
        v_ref_deficit:=greatest(0,v_reward_row.reward_amount-coalesce(v_ref_available,0));
        update public.profiles set mxm_coins=greatest(0,mxm_coins-least(mxm_coins,v_reward_row.reward_amount::bigint)),updated_at=now() where id=v_reward_row.referrer_profile_id;
        insert into public.referral_reward_reversals_v074(reward_id,purchase_id,referrer_profile_id,amount,deficit,unit) values(v_reward_row.id,v_purchase.id,v_reward_row.referrer_profile_id,v_reward_row.reward_amount,v_ref_deficit,'mxm_coins');
      else
        select balance into v_ref_available from public.profiles where id=v_reward_row.referrer_profile_id for update;
        v_ref_deficit:=greatest(0,v_reward_row.reward_amount-coalesce(v_ref_available,0));
        update public.profiles set balance=greatest(0,balance-v_reward_row.reward_amount),updated_at=now() where id=v_reward_row.referrer_profile_id;
        insert into public.referral_reward_reversals_v074(reward_id,purchase_id,referrer_profile_id,amount,deficit,unit) values(v_reward_row.id,v_purchase.id,v_reward_row.referrer_profile_id,v_reward_row.reward_amount,v_ref_deficit,'virtual_ton');
      end if;
      if v_ref_deficit>0 and v_status='reversed' then v_status:='partial'; end if;
    end if;
  end loop;

  update public.star_purchase_reversals_v074 set status=v_status,details=v_details,processed_at=now() where purchase_id=v_purchase.id;
  update public.star_purchases set refund_metadata=coalesce(refund_metadata,'{}'::jsonb)||jsonb_build_object('virtualReversal','automatic_v074','reversalStatus',v_status,'reversalDetails',v_details),updated_at=now() where id=v_purchase.id;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata) values(v_purchase.profile_id,'system',0,v_purchase.id,jsonb_build_object('action','stars_refund_reversal','productSku',v_purchase.product_sku,'stars',v_purchase.stars,'status',v_status,'details',v_details));
  perform public.emit_activity_event_v074('stars-refund:'||v_purchase.id,v_purchase.profile_id,'stars_refund',20,'private',v_purchase.profile_id,null,null,v_purchase.stars,jsonb_build_object('productSku',v_purchase.product_sku,'status',v_status),now());
  return jsonb_build_object('status',v_status,'alreadyReversed',false,'details',v_details);
end;$$;

create or replace function public.mark_star_purchase_refunded_v200(p_purchase_id uuid,p_charge_id text,p_reason text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_purchase public.star_purchases; v_reversal jsonb;
begin
  select * into v_purchase from public.star_purchases where id=p_purchase_id for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  if v_purchase.status='refunded' then
    if v_purchase.telegram_payment_charge_id is distinct from p_charge_id then raise exception 'Refund charge mismatch'; end if;
    v_reversal:=public.reverse_star_purchase_fulfillment_v074(p_purchase_id);
    return jsonb_build_object('status','refunded','alreadyRefunded',true,'reversalRequired',coalesce(v_reversal->>'status','')<>'reversed','reversal',v_reversal);
  end if;
  if v_purchase.status<>'paid' or v_purchase.telegram_payment_charge_id is distinct from p_charge_id or v_purchase.payer_telegram_id is null then raise exception 'Purchase is not refundable'; end if;
  update public.star_purchases set status='refunded',refunded_at=now(),refund_reason=left(trim(coalesce(p_reason,'Telegram refund')),500),refund_metadata=coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('virtualReversal','automatic_v074_pending'),updated_at=now() where id=p_purchase_id;
  v_reversal:=public.reverse_star_purchase_fulfillment_v074(p_purchase_id);
  return jsonb_build_object('status','refunded','alreadyRefunded',false,'reversalRequired',coalesce(v_reversal->>'status','')<>'reversed','reversal',v_reversal);
end;$$;

-- Keep qualification counters truthful when a previously paid Stars purchase is refunded.
create or replace function public.profile_activity_stars_v074() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_at timestamptz;
begin
  if new.status='paid' and (tg_op='INSERT' or old.status is distinct from 'paid') then
    v_at:=coalesce(new.paid_at,new.updated_at,new.created_at);
    insert into public.profile_activity_totals_v074(profile_id,stars_paid_count,stars_paid_total,last_activity_at) values(new.profile_id,1,new.stars,v_at)
    on conflict(profile_id) do update set stars_paid_count=public.profile_activity_totals_v074.stars_paid_count+1,stars_paid_total=public.profile_activity_totals_v074.stars_paid_total+new.stars,last_activity_at=greatest(coalesce(public.profile_activity_totals_v074.last_activity_at,v_at),v_at),updated_at=now();
    perform public.profile_activity_touch_day_v074(new.profile_id,v_at);
  elsif tg_op='UPDATE' and old.status='paid' and new.status='refunded' then
    update public.profile_activity_totals_v074 set stars_paid_count=greatest(0,stars_paid_count-1),stars_paid_total=greatest(0,stars_paid_total-new.stars),updated_at=now() where profile_id=new.profile_id;
  end if; return new;
end;$$;

revoke execute on function public.reverse_star_purchase_fulfillment_v074(uuid) from public,anon,authenticated;
grant execute on function public.reverse_star_purchase_fulfillment_v074(uuid) to service_role;
commit;
