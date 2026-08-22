begin;

-- Real Telegram channel subscription mission. Verification itself is performed by
-- the trusted Next.js backend via Bot API getChatMember; this migration owns the
-- atomic mission progress, claim guard and reward clawback state.

create table if not exists public.telegram_channel_task_state_v700 (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  telegram_id bigint not null,
  channel_username text not null default 'Meme_X_Market',
  currently_member boolean not null default false,
  member_status text not null default 'unknown',
  last_verified_at timestamptz,
  rewarded_at timestamptz,
  revoked_at timestamptz,
  reward_amount numeric(18,8) not null default 0 check (reward_amount >= 0),
  recovered_amount numeric(18,8) not null default 0 check (recovered_amount >= 0),
  clawback_due numeric(18,8) not null default 0 check (clawback_due >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_channel_task_audit_v700_idx
  on public.telegram_channel_task_state_v700(revoked_at,last_verified_at)
  where rewarded_at is not null;

alter table public.telegram_channel_task_state_v700 enable row level security;
revoke all on public.telegram_channel_task_state_v700 from public,anon,authenticated;
grant all on public.telegram_channel_task_state_v700 to service_role;

insert into public.missions(key,period,title,description,reward,target,action_type,sort_order,active)
values(
  'join_main_channel',
  'onboarding',
  'Подписаться на MEMEX MARKET',
  'Подпишись на официальный канал @Meme_X_Market. Бот проверит подписку перед выдачей награды.',
  10,
  1,
  'telegram_channel_subscription',
  15,
  true
)
on conflict(key) do update set
  period=excluded.period,
  title=excluded.title,
  description=excluded.description,
  reward=excluded.reward,
  target=excluded.target,
  action_type=excluded.action_type,
  sort_order=excluded.sort_order,
  active=true;

create or replace function public.apply_main_channel_membership_v700(
  p_profile_id uuid,
  p_telegram_id bigint,
  p_channel_username text,
  p_is_member boolean,
  p_member_status text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_mission public.missions;
  v_period_key text;
  v_claimed_at timestamptz;
  v_balance numeric:=0;
  v_reward numeric:=0;
  v_recovered numeric:=0;
  v_due numeric:=0;
  v_state public.telegram_channel_task_state_v700;
begin
  if p_profile_id is null or p_telegram_id is null or p_telegram_id<=0 then
    raise exception 'Invalid Telegram profile';
  end if;

  select * into v_mission from public.missions where key='join_main_channel' and active=true;
  if not found then raise exception 'Channel subscription mission is unavailable'; end if;

  perform public.ensure_user_missions(p_profile_id);
  v_period_key:=public.mission_period_key(v_mission.period);

  select claimed_at into v_claimed_at
  from public.user_missions
  where profile_id=p_profile_id and mission_id=v_mission.id and period_key=v_period_key
  for update;
  if not found then raise exception 'Channel subscription mission state is missing'; end if;

  insert into public.telegram_channel_task_state_v700(
    profile_id,telegram_id,channel_username,currently_member,member_status,last_verified_at,updated_at
  ) values(
    p_profile_id,p_telegram_id,trim(leading '@' from coalesce(nullif(trim(p_channel_username),''),'Meme_X_Market')),
    coalesce(p_is_member,false),left(coalesce(nullif(trim(p_member_status),''),'unknown'),32),now(),now()
  )
  on conflict(profile_id) do update set
    telegram_id=excluded.telegram_id,
    channel_username=excluded.channel_username,
    currently_member=excluded.currently_member,
    member_status=excluded.member_status,
    last_verified_at=excluded.last_verified_at,
    updated_at=now();

  if coalesce(p_is_member,false) then
    if v_claimed_at is null then
      update public.user_missions
      set progress=greatest(progress,v_mission.target),updated_at=now()
      where profile_id=p_profile_id and mission_id=v_mission.id and period_key=v_period_key;
    end if;
  else
    if v_claimed_at is null then
      update public.user_missions
      set progress=0,updated_at=now()
      where profile_id=p_profile_id and mission_id=v_mission.id and period_key=v_period_key;
    else
      select * into v_state from public.telegram_channel_task_state_v700 where profile_id=p_profile_id for update;
      if v_state.revoked_at is null then
        v_reward:=greatest(0,coalesce(nullif(v_state.reward_amount,0),v_mission.reward));
        select balance into v_balance from public.profiles where id=p_profile_id for update;
        if not found then raise exception 'Profile not found'; end if;
        v_recovered:=least(greatest(0,coalesce(v_balance,0)),v_reward);
        v_due:=greatest(0,v_reward-v_recovered);

        if v_recovered>0 then
          update public.profiles
          set balance=greatest(0,balance-v_recovered),updated_at=now()
          where id=p_profile_id;
        end if;

        update public.telegram_channel_task_state_v700
        set revoked_at=now(),recovered_amount=v_recovered,clawback_due=v_due,updated_at=now()
        where profile_id=p_profile_id;

        insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
        values(
          p_profile_id,'mission',-v_recovered,v_mission.id,
          jsonb_build_object(
            'key',v_mission.key,
            'reason','channel_unsubscribed',
            'rewardAmount',v_reward,
            'recoveredNow',v_recovered,
            'clawbackDue',v_due,
            'channel',coalesce(nullif(trim(p_channel_username),''),'Meme_X_Market')
          )
        );
      end if;
    end if;
  end if;

  select * into v_state from public.telegram_channel_task_state_v700 where profile_id=p_profile_id;
  return jsonb_build_object(
    'member',v_state.currently_member,
    'status',v_state.member_status,
    'verifiedAt',v_state.last_verified_at,
    'rewardedAt',v_state.rewarded_at,
    'revokedAt',v_state.revoked_at,
    'rewardAmount',v_state.reward_amount,
    'recoveredAmount',v_state.recovered_amount,
    'clawbackDue',v_state.clawback_due
  );
end;
$$;

-- Protect future credits when the user spent the conditional reward before
-- unsubscribing. Any later positive balance delta first settles the clawback.
create or replace function public.settle_main_channel_clawback_v700()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_due numeric:=0;
  v_increase numeric:=0;
  v_collect numeric:=0;
begin
  if new.balance is null or old.balance is null or new.balance<=old.balance then return new; end if;

  select clawback_due into v_due
  from public.telegram_channel_task_state_v700
  where profile_id=old.id and clawback_due>0
  for update;
  if not found or coalesce(v_due,0)<=0 then return new; end if;

  v_increase:=new.balance-old.balance;
  v_collect:=least(v_increase,v_due);
  new.balance:=new.balance-v_collect;

  update public.telegram_channel_task_state_v700
  set recovered_amount=recovered_amount+v_collect,
      clawback_due=greatest(0,clawback_due-v_collect),
      updated_at=now()
  where profile_id=old.id;

  return new;
end;
$$;

drop trigger if exists profiles_main_channel_clawback_v700 on public.profiles;
create trigger profiles_main_channel_clawback_v700
before update of balance on public.profiles
for each row execute function public.settle_main_channel_clawback_v700();

-- Final mission claimer. The subscription task can only be claimed after a
-- fresh server-side Telegram membership verification (<= 2 minutes old).
create or replace function public.claim_mission(p_profile_id uuid,p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_um public.user_missions;
  v_mission public.missions;
  v_key text;
  v_balance numeric;
  v_ref numeric:=0;
  v_channel public.telegram_channel_task_state_v700;
begin
  select * into v_mission from public.missions where id=p_mission_id and active=true;
  if not found then raise exception 'Задание недоступно'; end if;

  v_key:=public.mission_period_key(v_mission.period);
  select * into v_um
  from public.user_missions
  where profile_id=p_profile_id and mission_id=p_mission_id and period_key=v_key
  for update;
  if not found then raise exception 'Задание не найдено'; end if;
  if v_um.claimed_at is not null then raise exception 'Награда уже получена'; end if;
  if v_um.progress<v_mission.target then raise exception 'Задание ещё не выполнено'; end if;

  if v_mission.key='join_main_channel' then
    select * into v_channel
    from public.telegram_channel_task_state_v700
    where profile_id=p_profile_id
    for update;
    if not found
       or v_channel.currently_member is distinct from true
       or v_channel.last_verified_at is null
       or v_channel.last_verified_at<now()-interval '2 minutes'
       or v_channel.revoked_at is not null then
      raise exception 'Сначала подтвердите подписку на @Meme_X_Market';
    end if;
  end if;

  update public.user_missions
  set claimed_at=now(),updated_at=now()
  where profile_id=p_profile_id and mission_id=p_mission_id and period_key=v_key;

  update public.profiles
  set balance=balance+v_mission.reward,updated_at=now()
  where id=p_profile_id
  returning balance into v_balance;

  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'mission',v_mission.reward,p_mission_id,
    jsonb_build_object('key',v_mission.key,'period',v_mission.period,'conditional',v_mission.key='join_main_channel'));

  if v_mission.key='join_main_channel' then
    update public.telegram_channel_task_state_v700
    set rewarded_at=now(),reward_amount=v_mission.reward,recovered_amount=0,clawback_due=0,updated_at=now()
    where profile_id=p_profile_id;
  else
    v_ref:=public.credit_referral_bonus_v046(p_profile_id,'mission',v_mission.reward,p_mission_id);
  end if;

  return jsonb_build_object('reward',v_mission.reward,'balance',v_balance,'referralReward',v_ref);
end;
$$;

revoke execute on function public.apply_main_channel_membership_v700(uuid,bigint,text,boolean,text) from public,anon,authenticated;
revoke execute on function public.claim_mission(uuid,uuid) from public,anon,authenticated;
grant execute on function public.apply_main_channel_membership_v700(uuid,bigint,text,boolean,text) to service_role;
grant execute on function public.claim_mission(uuid,uuid) to service_role;

commit;
