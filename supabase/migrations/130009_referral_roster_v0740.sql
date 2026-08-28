begin;

create or replace function public.referral_roster_v074(p_referrer_profile_id uuid,p_limit integer default 50)
returns jsonb language sql security definer set search_path=public,pg_temp stable as $$
  with people as (
    select p.id,p.username,p.first_name,p.photo_url,p.created_at,
      public.referral_qualification_v074(p.id) qualification
    from public.profiles p
    where p.referrer_profile_id=p_referrer_profile_id and not coalesce(p.is_system,false)
    order by p.created_at desc
    limit greatest(1,least(coalesce(p_limit,50),100))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,
    'username',username,
    'firstName',first_name,
    'photoUrl',photo_url,
    'joinedAt',created_at,
    'qualified',coalesce((qualification->>'qualified')::boolean,false),
    'ageHours',coalesce((qualification->>'ageHours')::integer,0),
    'activeDays',coalesce((qualification->>'activeDays')::integer,0),
    'tradeCount',coalesce((qualification->>'tradeCount')::bigint,0),
    'tradeVolume',coalesce((qualification->>'tradeVolume')::numeric,0),
    'starsPaidCount',coalesce((qualification->>'starsPaidCount')::bigint,0),
    'xp',coalesce((qualification->>'xp')::bigint,0)
  ) order by joinedAt desc),'[]'::jsonb) from people;
$$;

revoke execute on function public.referral_roster_v074(uuid,integer) from public,anon,authenticated;
grant execute on function public.referral_roster_v074(uuid,integer) to service_role;
commit;
