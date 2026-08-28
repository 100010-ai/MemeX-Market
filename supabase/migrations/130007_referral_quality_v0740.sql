begin;

create or replace function public.referral_qualification_v074(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp stable as $$
  select jsonb_build_object(
    'qualified',
      not coalesce(p.is_system,false)
      and not (coalesce(p.is_banned,false) and (p.banned_until is null or p.banned_until>now()))
      and p.created_at<=now()-interval '24 hours'
      and coalesce(a.active_days,0)>=2
      and (
        (coalesce(a.coin_trade_count,0)+coalesce(a.gift_trade_count,0)>=3 and coalesce(a.trade_volume,0)>=5)
        or (coalesce(a.stars_paid_count,0)>=1 and (coalesce(a.coin_trade_count,0)+coalesce(a.gift_trade_count,0)>=1 or coalesce(p.xp,0)>=20))
      ),
    'ageHours',greatest(0,floor(extract(epoch from(now()-p.created_at))/3600)::integer),
    'activeDays',coalesce(a.active_days,0),
    'tradeCount',coalesce(a.coin_trade_count,0)+coalesce(a.gift_trade_count,0),
    'tradeVolume',coalesce(a.trade_volume,0),
    'starsPaidCount',coalesce(a.stars_paid_count,0),
    'xp',coalesce(p.xp,0)
  )
  from public.profiles p left join public.profile_activity_totals_v074 a on a.profile_id=p.id where p.id=p_profile_id;
$$;

create or replace function public.referral_partner_status_v200(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_invited integer:=0; v_qualified integer:=0; v_level text; v_bps integer; v_next integer; v_earned_ton numeric:=0; v_earned_mxm numeric:=0;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Profile not found'; end if;
  select count(*)::integer,count(*) filter(where coalesce((public.referral_qualification_v074(p.id)->>'qualified')::boolean,false))::integer
  into v_invited,v_qualified from public.profiles p where p.referrer_profile_id=p_profile_id and not coalesce(p.is_system,false);
  if v_qualified>=50 then v_level:='Diamond'; v_bps:=1500; v_next:=null;
  elsif v_qualified>=20 then v_level:='Gold'; v_bps:=1000; v_next:=50;
  elsif v_qualified>=5 then v_level:='Silver'; v_bps:=750; v_next:=20;
  else v_level:='Bronze'; v_bps:=500; v_next:=5; end if;
  select coalesce(sum(r.reward_amount) filter(where r.source_kind<>'store'),0),coalesce(sum(r.reward_amount) filter(where r.source_kind='store'),0)
  into v_earned_ton,v_earned_mxm
  from public.referral_rewards r left join public.referral_reward_reversals_v074 rr on rr.reward_id=r.id
  where r.referrer_profile_id=p_profile_id and rr.reward_id is null;
  return jsonb_build_object('level',v_level,'bonusBps',v_bps,'invited',v_invited,'qualified',v_qualified,'pending',greatest(0,v_invited-v_qualified),'nextQualified',v_next,'earnedVirtualTon',v_earned_ton,'earnedMxmCoins',v_earned_mxm,'qualificationModel','quality-v074');
end;$$;

revoke execute on function public.referral_qualification_v074(uuid) from public,anon,authenticated;
grant execute on function public.referral_qualification_v074(uuid) to service_role;
commit;
