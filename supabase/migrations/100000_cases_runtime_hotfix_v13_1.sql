begin;

-- MXM v0.63.1 — production case runtime hotfix.
--
-- Fixes the two case-runtime paths that can surface POST /api/cases as HTTP 503:
-- * v0.63 did not re-create open_case_v200, so a partially upgraded DB can
--   have a stale/missing PostgREST RPC signature;
-- * the old case RNG used unqualified pgcrypto.gen_random_bytes() from a
--   function whose search_path is locked to public. Hosted Supabase commonly
--   keeps extensions outside public, which can produce PostgreSQL 42883 at
--   runtime even when pgcrypto itself is installed.
--
-- Randomness still comes from PostgreSQL's v4 UUID generator; decode() simply
-- exposes its 128 random bits as bytea without an extension-schema dependency.
-- Historical game RPCs stay disabled exactly as required by migration 019.

create or replace function public.open_case_v200(
  p_profile_id uuid,p_case_sku text,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request uuid:=coalesce(p_request_id,gen_random_uuid());
  v_existing public.case_openings;
  v_inventory public.profile_inventory;
  v_loot public.case_loot_definitions;
  v_total integer;
  v_roll integer;
  v_random bytea;
  v_reward jsonb;
  v_remaining integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_request::text,0));
  select * into v_existing from public.case_openings where request_id=v_request;
  if found then
    if v_existing.profile_id<>p_profile_id or v_existing.case_sku<>p_case_sku then
      raise exception 'Case request ID was already used';
    end if;
    select quantity into v_remaining from public.profile_inventory where profile_id=p_profile_id and sku=p_case_sku;
    return jsonb_build_object('status','opened','alreadyOpened',true,'reward',jsonb_build_object(
      'label',v_existing.reward_label,'rarity',v_existing.rarity,'kind',v_existing.reward_kind,'amount',v_existing.reward_amount
    ),'remaining',coalesce(v_remaining,0));
  end if;

  if not exists(select 1 from public.case_definitions where sku=p_case_sku and active=true) then
    raise exception 'Case is unavailable';
  end if;
  select * into v_inventory from public.profile_inventory
  where profile_id=p_profile_id and sku=p_case_sku for update;
  if not found or v_inventory.quantity<1 then raise exception 'No case in inventory'; end if;

  select sum(weight)::integer into v_total from public.case_loot_definitions where case_sku=p_case_sku and active=true;
  if coalesce(v_total,0)<=0 then raise exception 'Case odds are not configured'; end if;
  v_random:=decode(replace(gen_random_uuid()::text,'-',''),'hex');
  v_roll:=mod((get_byte(v_random,0)::numeric*16777216+get_byte(v_random,1)::numeric*65536+
    get_byte(v_random,2)::numeric*256+get_byte(v_random,3)::numeric),v_total)::integer+1;
  select x.id,x.case_sku,x.reward_key,x.reward_kind,x.reward_label,x.amount,x.weight,x.rarity,x.metadata,x.active
  into v_loot from (
    select l.*,sum(l.weight) over(order by l.reward_key rows between unbounded preceding and current row) as ceiling
    from public.case_loot_definitions l where l.case_sku=p_case_sku and l.active=true
  ) x where x.ceiling>=v_roll order by x.ceiling limit 1;
  if not found then raise exception 'Case draw failed'; end if;

  -- Permanent items never become a zero-value duplicate. The disclosed loot
  -- row advertises its fixed MXM compensation and the opening history records
  -- the actual compensated reward.
  if v_loot.reward_kind='profile_item' and exists(select 1 from public.profile_item_inventory
    where profile_id=p_profile_id and item_key=v_loot.metadata->>'itemKey') then
    v_loot.reward_kind:='mxm_coins';
    v_loot.amount:=greatest(1,coalesce((v_loot.metadata->>'duplicateMxm')::integer,250));
    v_loot.reward_label:=v_loot.amount::text||' MXM duplicate compensation';
    v_loot.metadata:='{}'::jsonb;
  end if;

  update public.profile_inventory set quantity=quantity-1,updated_at=now()
  where profile_id=p_profile_id and sku=p_case_sku returning quantity into v_remaining;
  v_reward:=public.grant_virtual_reward_v200(p_profile_id,v_loot.reward_kind,v_loot.amount,
    v_loot.metadata||jsonb_build_object('label',v_loot.reward_label),'case',v_request);
  insert into public.case_openings(request_id,profile_id,case_sku,loot_id,reward_kind,reward_label,reward_amount,rarity)
  values(v_request,p_profile_id,p_case_sku,v_loot.id,v_reward->>'kind',v_reward->>'label',
    greatest(0,coalesce((v_reward->>'amount')::integer,0)),v_loot.rarity);
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'case',case when v_reward->>'kind'='mxm_coins' then coalesce((v_reward->>'amount')::numeric,0) else 0 end,v_request,
    jsonb_build_object('unit',v_loot.reward_kind,'caseSku',p_case_sku,'reward',v_reward,'rarity',v_loot.rarity));
  return jsonb_build_object('status','opened','alreadyOpened',false,'requestId',v_request,
    'reward',jsonb_build_object('label',v_reward->>'label','rarity',v_loot.rarity,'kind',v_reward->>'kind',
      'amount',coalesce((v_reward->>'amount')::integer,0),'creditedEnergy',v_reward->'creditedEnergy','overflowMxmCoins',v_reward->'overflowMxmCoins'),
    'remaining',v_remaining);
end;
$$;

revoke execute on function public.open_case_v200(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.open_case_v200(uuid,text,uuid) to service_role;

-- Refresh PostgREST's procedure cache immediately after replacing the RPC.
notify pgrst, 'reload schema';

commit;
