begin;

-- MXM v0.40 — compact game hub, additional virtual-only games and a cheaper
-- profile snapshot RPC used by hot read paths. Nothing in the game hub can be
-- deposited, withdrawn or redeemed for real value.

alter table public.game_rounds drop constraint if exists game_rounds_game_check;
alter table public.game_rounds add constraint game_rounds_game_check
  check (game in ('coinflip','dice','wheel','slots','hilo','roulette','plinko'));
alter table public.game_rounds add column if not exists request_key text;
create unique index if not exists game_rounds_profile_request_uidx
  on public.game_rounds(profile_id,request_key) where request_key is not null;

create or replace function public.profile_snapshot_v040(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'balance',p.balance,
    'reservedBalance',coalesce(public.pending_gift_offer_total(p.id,null),0),
    'coinValue',coalesce(f.coin_value,0),
    'giftValue',coalesce(f.gift_value,0),
    'netWorth',coalesce(f.net_worth,p.balance)
  )
  from public.profiles p
  left join public.profile_financial_overview f on f.id=p.id
  where p.id=p_profile_id;
$$;
revoke execute on function public.profile_snapshot_v040(uuid) from public,anon,authenticated;
grant execute on function public.profile_snapshot_v040(uuid) to service_role;

-- One round-trip snapshot for /api/me. It keeps ban state authoritative while
-- avoiding the old profiles -> financial RPC waterfall during every app start.
create or replace function public.session_profile_snapshot_v040(p_telegram_id bigint)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'id',p.id,
    'telegram_id',p.telegram_id,
    'username',p.username,
    'first_name',p.first_name,
    'last_name',p.last_name,
    'photo_url',p.photo_url,
    'balance',p.balance,
    'xp',p.xp,
    'last_gift_sync_at',p.last_gift_sync_at,
    'is_banned',p.is_banned,
    'banned_until',p.banned_until,
    'created_at',p.created_at,
    'reserved_balance',coalesce(public.pending_gift_offer_total(p.id,null),0),
    'coin_value',coalesce(f.coin_value,0),
    'gift_value',coalesce(f.gift_value,0),
    'net_worth',coalesce(f.net_worth,p.balance)
  )
  from public.profiles p
  left join public.profile_financial_overview f on f.id=p.id
  where p.telegram_id=p_telegram_id;
$$;
revoke execute on function public.session_profile_snapshot_v040(bigint) from public,anon,authenticated;
grant execute on function public.session_profile_snapshot_v040(bigint) to service_role;

drop function if exists public.play_virtual_game(uuid,text,numeric,text);
create or replace function public.play_virtual_game(p_profile_id uuid,p_game text,p_bet numeric,p_choice text default null,p_request_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.profiles;
  v_reserved numeric;
  v_bytes bytea;
  v_u32 numeric;
  v_u32b numeric;
  v_u32c numeric;
  v_u32d numeric;
  v_roll numeric;
  v_roll2 numeric;
  v_roll3 numeric;
  v_roll4 numeric;
  v_multiplier numeric := 0;
  v_result text;
  v_number integer;
  v_payout numeric;
  v_balance numeric;
  v_round_id uuid;
  v_visual jsonb := '{}'::jsonb;
  v_reel1 integer;
  v_reel2 integer;
  v_reel3 integer;
  v_existing public.game_rounds;
begin
  if p_game is null or p_game not in ('coinflip','dice','wheel','slots','hilo','roulette','plinko') then raise exception 'Неизвестная игра'; end if;
  if p_bet is null or p_bet<0.1 or p_bet>100 then raise exception 'Ставка должна быть от 0.1 до 100 виртуальных TON'; end if;

  select * into v_profile from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_banned and (v_profile.banned_until is null or v_profile.banned_until>now()) then raise exception 'Account is banned'; end if;

  if p_request_key is not null then
    if char_length(p_request_key)>120 then raise exception 'Invalid request key'; end if;
    select * into v_existing from public.game_rounds where profile_id=p_profile_id and request_key=p_request_key limit 1;
    if found then
      if v_existing.game<>p_game
        or abs(v_existing.bet-p_bet)>0.00000001
        or coalesce(v_existing.choice,'')<>coalesce(p_choice,'') then
        raise exception 'Idempotency key was reused with different game parameters';
      end if;
      return jsonb_build_object(
        'id',v_existing.id,'game',v_existing.game,'bet',v_existing.bet,'choice',v_existing.choice,
        'result',v_existing.outcome->>'result','number',case when v_existing.outcome->>'number' is null then null else (v_existing.outcome->>'number')::integer end,
        'visual',coalesce(v_existing.outcome->'visual','{}'::jsonb),'multiplier',v_existing.multiplier,
        'payout',v_existing.payout,'balance',v_existing.balance_after,'won',v_existing.payout>v_existing.bet
      );
    end if;
  end if;

  v_reserved := public.pending_gift_offer_total(p_profile_id,null);
  if v_profile.balance-v_reserved<p_bet then raise exception 'Недостаточно доступного виртуального TON'; end if;

  v_bytes := gen_random_bytes(16);
  v_u32 := get_byte(v_bytes,0)::numeric*16777216 + get_byte(v_bytes,1)::numeric*65536 + get_byte(v_bytes,2)::numeric*256 + get_byte(v_bytes,3)::numeric;
  v_u32b := get_byte(v_bytes,4)::numeric*16777216 + get_byte(v_bytes,5)::numeric*65536 + get_byte(v_bytes,6)::numeric*256 + get_byte(v_bytes,7)::numeric;
  v_u32c := get_byte(v_bytes,8)::numeric*16777216 + get_byte(v_bytes,9)::numeric*65536 + get_byte(v_bytes,10)::numeric*256 + get_byte(v_bytes,11)::numeric;
  v_u32d := get_byte(v_bytes,12)::numeric*16777216 + get_byte(v_bytes,13)::numeric*65536 + get_byte(v_bytes,14)::numeric*256 + get_byte(v_bytes,15)::numeric;
  v_roll := v_u32/4294967296::numeric;
  v_roll2 := v_u32b/4294967296::numeric;
  v_roll3 := v_u32c/4294967296::numeric;
  v_roll4 := v_u32d/4294967296::numeric;

  if p_game='coinflip' then
    if p_choice is null or p_choice not in ('heads','tails') then raise exception 'Выбери сторону монеты'; end if;
    v_result := case when v_roll<0.5 then 'heads' else 'tails' end;
    v_multiplier := case when v_result=p_choice then 1.92 else 0 end;
    v_visual := jsonb_build_object('side',v_result);

  elsif p_game='dice' then
    if p_choice is null or p_choice not in ('low','high') then raise exception 'Выбери диапазон'; end if;
    v_number := floor(v_roll*6)::integer+1;
    v_result := v_number::text;
    if (p_choice='low' and v_number<=3) or (p_choice='high' and v_number>=4) then v_multiplier:=1.92; else v_multiplier:=0; end if;
    v_visual := jsonb_build_object('face',v_number);

  elsif p_game='wheel' then
    if v_roll<0.50 then v_multiplier:=0; v_number:=0;
    elsif v_roll<0.75 then v_multiplier:=1.20; v_number:=1;
    elsif v_roll<0.90 then v_multiplier:=1.80; v_number:=2;
    elsif v_roll<0.98 then v_multiplier:=3.00; v_number:=3;
    else v_multiplier:=8.00; v_number:=4;
    end if;
    v_result := trim(to_char(v_multiplier,'FM999990.00'))||'x';
    v_visual := jsonb_build_object('sector',v_number);

  elsif p_game='slots' then
    v_reel1 := floor(v_roll*5)::integer;
    v_reel2 := floor(v_roll2*5)::integer;
    v_reel3 := floor(v_roll3*5)::integer;
    if v_reel1=v_reel2 and v_reel2=v_reel3 then
      v_multiplier := case when v_reel1=4 then 10.00 else 5.00 end;
    elsif v_reel1=v_reel2 or v_reel1=v_reel3 or v_reel2=v_reel3 then
      v_multiplier := 1.50;
    else
      v_multiplier := 0;
    end if;
    v_result := v_reel1::text||'-'||v_reel2::text||'-'||v_reel3::text;
    v_visual := jsonb_build_object('reels',jsonb_build_array(v_reel1,v_reel2,v_reel3));

  elsif p_game='hilo' then
    if p_choice is null or p_choice not in ('low','high') then raise exception 'Выбери диапазон'; end if;
    v_number := floor(v_roll*13)::integer+1;
    v_result := v_number::text;
    if (p_choice='low' and v_number<=6) or (p_choice='high' and v_number>=8) then v_multiplier:=2.05; else v_multiplier:=0; end if;
    v_visual := jsonb_build_object('rank',v_number,'suit',floor(v_roll2*4)::integer);

  elsif p_game='roulette' then
    if p_choice is null or p_choice not in ('red','black') then raise exception 'Выбери цвет'; end if;
    v_number := floor(v_roll*37)::integer;
    v_result := v_number::text;
    if v_number<>0 and (
      (p_choice='red' and v_number in (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36)) or
      (p_choice='black' and v_number not in (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36))
    ) then v_multiplier:=1.92; else v_multiplier:=0; end if;
    v_visual := jsonb_build_object(
      'roulette',v_number,
      'color',case when v_number=0 then 'green' when v_number in (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36) then 'red' else 'black' end
    );

  else
    -- 8-row Plinko. Counting eight independent random byte decisions gives the
    -- exact binomial landing distribution instead of inventing a flat slot RNG.
    v_number :=
      (case when get_byte(v_bytes,0)<128 then 1 else 0 end) +
      (case when get_byte(v_bytes,1)<128 then 1 else 0 end) +
      (case when get_byte(v_bytes,2)<128 then 1 else 0 end) +
      (case when get_byte(v_bytes,3)<128 then 1 else 0 end) +
      (case when get_byte(v_bytes,4)<128 then 1 else 0 end) +
      (case when get_byte(v_bytes,5)<128 then 1 else 0 end) +
      (case when get_byte(v_bytes,6)<128 then 1 else 0 end) +
      (case when get_byte(v_bytes,7)<128 then 1 else 0 end);
    v_multiplier := case v_number
      when 0 then 8.00 when 1 then 2.60 when 2 then 1.30 when 3 then 0.80
      when 4 then 0.40 when 5 then 0.80 when 6 then 1.30 when 7 then 2.60 else 8.00 end;
    v_result := v_number::text;
    v_visual := jsonb_build_object('slot',v_number);
  end if;

  v_payout := round(p_bet*v_multiplier,8);
  update public.profiles set balance=balance-p_bet+v_payout,updated_at=now() where id=p_profile_id returning balance into v_balance;

  insert into public.game_rounds(profile_id,game,bet,choice,outcome,multiplier,payout,balance_after,request_key)
  values(p_profile_id,p_game,p_bet,p_choice,jsonb_build_object('result',v_result,'number',v_number,'visual',v_visual),v_multiplier,v_payout,v_balance,p_request_key)
  returning id into v_round_id;

  perform public.bump_mission(p_profile_id,'game_play',1);
  return jsonb_build_object(
    'id',v_round_id,'game',p_game,'bet',p_bet,'choice',p_choice,'result',v_result,'number',v_number,
    'visual',v_visual,'multiplier',v_multiplier,'payout',v_payout,'balance',v_balance,'won',v_multiplier>1
  );
end;
$$;
revoke execute on function public.play_virtual_game(uuid,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.play_virtual_game(uuid,text,numeric,text,text) to service_role;


-- Rarity aggregation belongs in PostgreSQL, not in a 5k-row JS download.
-- This handles the full discovered collection and turns thousands of client-side
-- updates into one set-based UPDATE.
create or replace function public.recalculate_tonapi_collection_rarity_v040(p_collection_address text)
returns integer language plpgsql security definer set search_path=public as $$
declare
  v_updated integer := 0;
begin
  if p_collection_address is null or length(trim(p_collection_address))<8 then
    raise exception 'Invalid collection address';
  end if;

  with scoped as (
    select
      id,
      model_name,
      symbol_name,
      backdrop_name,
      count(*) over () as total_count,
      count(*) over (partition by model_name) as model_count,
      count(*) over (partition by symbol_name) as symbol_count,
      count(*) over (partition by backdrop_name) as backdrop_count
    from public.gift_assets
    where chain_collection_address=p_collection_address
      and catalog_source='tonapi'
  ),
  rarity as (
    select
      id,
      greatest(1,least(1000,round(1000.0 * case when model_name is null or model_name='' then 1 else model_count end / greatest(total_count,1))))::integer as model_rarity,
      greatest(1,least(1000,round(1000.0 * case when symbol_name is null or symbol_name='' then 1 else symbol_count end / greatest(total_count,1))))::integer as symbol_rarity,
      greatest(1,least(1000,round(1000.0 * case when backdrop_name is null or backdrop_name='' then 1 else backdrop_count end / greatest(total_count,1))))::integer as backdrop_rarity
    from scoped
  )
  update public.gift_assets ga
  set
    model_rarity_per_mille=r.model_rarity,
    symbol_rarity_per_mille=r.symbol_rarity,
    backdrop_rarity_per_mille=r.backdrop_rarity
  from rarity r
  where ga.id=r.id
    and (
      ga.model_rarity_per_mille is distinct from r.model_rarity
      or ga.symbol_rarity_per_mille is distinct from r.symbol_rarity
      or ga.backdrop_rarity_per_mille is distinct from r.backdrop_rarity
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;
revoke execute on function public.recalculate_tonapi_collection_rarity_v040(text) from public,anon,authenticated;
grant execute on function public.recalculate_tonapi_collection_rarity_v040(text) to service_role;

update public.missions
set title='3 раунда',description='Сыграй 3 раунда.',updated_at=now()
where key='daily_game_3';

commit;
