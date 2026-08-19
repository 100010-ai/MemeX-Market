begin;

-- MXM v0.47 — sponsored campaigns, flexible partner tasks and promo codes.
-- Rewards are virtual MXM TON only.

alter table public.economy_events drop constraint if exists economy_events_kind_check;
alter table public.economy_events add constraint economy_events_kind_check
  check(kind in ('rewarded_ad','coin_launch','coin_trade_fee','mission','admin','system','stars','referral','sponsored_task','promo_code'));

alter table public.referral_rewards drop constraint if exists referral_rewards_source_kind_check;
alter table public.referral_rewards add constraint referral_rewards_source_kind_check
  check(source_kind in ('rewarded_ad','mission','stars','sponsored_task','promo_code'));

create table if not exists public.sponsored_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_name text not null check(char_length(advertiser_name) between 1 and 80),
  title text not null check(char_length(title) between 2 and 120),
  description text not null default '' check(char_length(description) <= 500),
  instructions text not null default '' check(char_length(instructions) <= 1000),
  verification_type text not null check(verification_type in ('telegram_membership','link_visit','manual')),
  target_url text not null check(char_length(target_url) between 5 and 1200),
  telegram_chat_id text,
  button_label text not null default 'Открыть' check(char_length(button_label) between 1 and 40),
  reward numeric(18,8) not null check(reward > 0 and reward <= 100000),
  max_completions integer not null check(max_completions between 1 and 1000000),
  completed_count integer not null default 0 check(completed_count >= 0),
  status text not null default 'draft' check(status in ('draft','active','paused','ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer not null default 100 check(priority between 0 and 10000),
  featured boolean not null default false,
  internal_note text not null default '' check(char_length(internal_note) <= 1000),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at is null or starts_at is null or ends_at > starts_at),
  check(completed_count <= max_completions)
);
create index if not exists sponsored_campaigns_active_v047_idx on public.sponsored_campaigns(status,priority desc,created_at desc);
create index if not exists sponsored_campaigns_schedule_v047_idx on public.sponsored_campaigns(starts_at,ends_at);

create table if not exists public.sponsored_task_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.sponsored_campaigns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'opened' check(status in ('opened','pending','claimed','rejected')),
  opened_at timestamptz,
  submitted_at timestamptz,
  verified_at timestamptz,
  claimed_at timestamptz,
  verification_source text,
  reviewed_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,profile_id)
);
create index if not exists sponsored_task_claims_campaign_status_v047_idx on public.sponsored_task_claims(campaign_id,status,created_at desc);
create index if not exists sponsored_task_claims_profile_v047_idx on public.sponsored_task_claims(profile_id,created_at desc);

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code ~ '^[A-Z0-9_-]{3,32}$'),
  reward numeric(18,8) not null check(reward > 0 and reward <= 100000),
  max_uses integer not null default 100 check(max_uses between 1 and 1000000),
  uses_count integer not null default 0 check(uses_count >= 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  note text not null default '' check(char_length(note) <= 500),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at is null or starts_at is null or ends_at > starts_at),
  check(uses_count <= max_uses)
);
create index if not exists promo_codes_active_v047_idx on public.promo_codes(active,created_at desc);

create table if not exists public.promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reward numeric(18,8) not null check(reward > 0),
  created_at timestamptz not null default now(),
  unique(promo_code_id,profile_id)
);
create index if not exists promo_code_redemptions_profile_v047_idx on public.promo_code_redemptions(profile_id,created_at desc);

alter table public.sponsored_campaigns enable row level security;
alter table public.sponsored_task_claims enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_code_redemptions enable row level security;
revoke all on public.sponsored_campaigns,public.sponsored_task_claims,public.promo_codes,public.promo_code_redemptions from public,anon,authenticated;
grant all on public.sponsored_campaigns,public.sponsored_task_claims,public.promo_codes,public.promo_code_redemptions to service_role;

-- Referral payout now also applies to partner tasks and promo rewards.
create or replace function public.credit_referral_bonus_v046(
  p_referred_profile_id uuid,
  p_source_kind text,
  p_source_amount numeric,
  p_reference_id uuid default null
)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_referrer uuid; v_bps integer; v_reward numeric;
begin
  if p_source_amount is null or p_source_amount<=0 or p_source_kind not in ('rewarded_ad','mission','stars','sponsored_task','promo_code') then return 0; end if;
  select referrer_profile_id into v_referrer from public.profiles where id=p_referred_profile_id;
  if v_referrer is null then return 0; end if;
  select referral_bonus_bps into v_bps from public.economy_settings where singleton=true;
  v_reward:=round(p_source_amount*coalesce(v_bps,500)/10000.0,8);
  if v_reward<=0 then return 0; end if;
  if p_reference_id is not null and exists(
    select 1 from public.referral_rewards
    where referrer_profile_id=v_referrer and referred_profile_id=p_referred_profile_id
      and source_kind=p_source_kind and reference_id=p_reference_id
  ) then return 0; end if;
  update public.profiles set balance=balance+v_reward,updated_at=now() where id=v_referrer;
  insert into public.referral_rewards(referrer_profile_id,referred_profile_id,source_kind,source_amount,reward_amount,reference_id)
  values(v_referrer,p_referred_profile_id,p_source_kind,p_source_amount,v_reward,p_reference_id)
  on conflict do nothing;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(v_referrer,'referral',v_reward,p_reference_id,jsonb_build_object('referredProfileId',p_referred_profile_id,'sourceKind',p_source_kind,'sourceAmount',p_source_amount));
  return v_reward;
end;
$$;

create or replace function public.claim_sponsored_campaign_v047(
  p_profile_id uuid,
  p_campaign_id uuid,
  p_verification_source text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_campaign public.sponsored_campaigns;
  v_claim public.sponsored_task_claims;
  v_balance numeric;
  v_ref numeric;
begin
  select * into v_campaign from public.sponsored_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'Партнёрское задание не найдено'; end if;

  select * into v_claim from public.sponsored_task_claims where campaign_id=p_campaign_id and profile_id=p_profile_id for update;
  if found and v_claim.status='claimed' then
    select balance into v_balance from public.profiles where id=p_profile_id;
    return jsonb_build_object('status','claimed','reward',v_campaign.reward,'balance',v_balance,'alreadyClaimed',true);
  end if;

  if v_campaign.status<>'active' then raise exception 'Задание сейчас недоступно'; end if;
  if v_campaign.starts_at is not null and v_campaign.starts_at>now() then raise exception 'Задание ещё не началось'; end if;
  if v_campaign.ends_at is not null and v_campaign.ends_at<=now() then raise exception 'Задание завершено'; end if;
  if v_campaign.completed_count>=v_campaign.max_completions then raise exception 'Лимит участников исчерпан'; end if;

  if v_campaign.verification_type='manual' and p_verification_source<>'admin_manual' then
    raise exception 'Задание требует проверки администратором';
  end if;
  if v_campaign.verification_type='telegram_membership' and p_verification_source<>'telegram_membership' then
    raise exception 'Некорректный способ проверки';
  end if;
  if v_campaign.verification_type='link_visit' and p_verification_source<>'link_visit' then
    raise exception 'Некорректный способ проверки';
  end if;

  insert into public.sponsored_task_claims(campaign_id,profile_id,status,opened_at,verified_at,claimed_at,verification_source,reviewed_by,updated_at)
  values(p_campaign_id,p_profile_id,'claimed',now(),now(),now(),p_verification_source,case when p_verification_source='admin_manual' then 'admin' else null end,now())
  on conflict(campaign_id,profile_id) do update set
    status='claimed', verified_at=now(), claimed_at=now(), verification_source=excluded.verification_source,
    reviewed_by=coalesce(public.sponsored_task_claims.reviewed_by,excluded.reviewed_by), updated_at=now();

  update public.sponsored_campaigns set completed_count=completed_count+1,updated_at=now() where id=p_campaign_id;
  update public.profiles set balance=balance+v_campaign.reward,updated_at=now() where id=p_profile_id returning balance into v_balance;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'sponsored_task',v_campaign.reward,p_campaign_id,jsonb_build_object('advertiser',v_campaign.advertiser_name,'title',v_campaign.title,'verification',p_verification_source));
  v_ref:=public.credit_referral_bonus_v046(p_profile_id,'sponsored_task',v_campaign.reward,p_campaign_id);
  return jsonb_build_object('status','claimed','reward',v_campaign.reward,'balance',v_balance,'referralReward',v_ref,'alreadyClaimed',false);
end;
$$;

create or replace function public.redeem_promo_code_v047(p_profile_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_promo public.promo_codes;
  v_balance numeric;
  v_ref numeric;
begin
  select * into v_promo from public.promo_codes where code=upper(trim(p_code)) for update;
  if not found then raise exception 'Промокод не найден'; end if;
  if not v_promo.active then raise exception 'Промокод отключён'; end if;
  if v_promo.starts_at is not null and v_promo.starts_at>now() then raise exception 'Промокод ещё не активен'; end if;
  if v_promo.ends_at is not null and v_promo.ends_at<=now() then raise exception 'Срок промокода истёк'; end if;
  if v_promo.uses_count>=v_promo.max_uses then raise exception 'Лимит активаций промокода исчерпан'; end if;
  if exists(select 1 from public.promo_code_redemptions where promo_code_id=v_promo.id and profile_id=p_profile_id) then
    raise exception 'Вы уже активировали этот промокод';
  end if;

  insert into public.promo_code_redemptions(promo_code_id,profile_id,reward) values(v_promo.id,p_profile_id,v_promo.reward);
  update public.promo_codes set uses_count=uses_count+1,updated_at=now() where id=v_promo.id;
  update public.profiles set balance=balance+v_promo.reward,updated_at=now() where id=p_profile_id returning balance into v_balance;
  insert into public.economy_events(profile_id,kind,amount,reference_id,metadata)
  values(p_profile_id,'promo_code',v_promo.reward,v_promo.id,jsonb_build_object('code',v_promo.code));
  v_ref:=public.credit_referral_bonus_v046(p_profile_id,'promo_code',v_promo.reward,v_promo.id);
  return jsonb_build_object('status','claimed','reward',v_promo.reward,'balance',v_balance,'referralReward',v_ref);
end;
$$;

revoke execute on function public.claim_sponsored_campaign_v047(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.redeem_promo_code_v047(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_sponsored_campaign_v047(uuid,uuid,text) to service_role;
grant execute on function public.redeem_promo_code_v047(uuid,text) to service_role;

update public.economy_settings set schema_version=47,updated_at=now() where singleton=true;
alter table public.economy_settings alter column schema_version set default 47;

commit;
