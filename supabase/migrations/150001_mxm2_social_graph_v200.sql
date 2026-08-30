begin;

create table if not exists public.social_reactions_v200 (
  activity_event_id uuid not null references public.activity_events_v074(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('fire','eyes','diamond')),
  created_at timestamptz not null default now(),
  primary key(activity_event_id,profile_id)
);
create index if not exists social_reactions_v200_event_idx on public.social_reactions_v200(activity_event_id,reaction);
create index if not exists social_reactions_v200_profile_idx on public.social_reactions_v200(profile_id,created_at desc);
alter table public.social_reactions_v200 enable row level security;
revoke all on public.social_reactions_v200 from anon, authenticated;

create table if not exists public.profile_follows_v200 (
  follower_profile_id uuid not null references public.profiles(id) on delete cascade,
  following_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_profile_id,following_profile_id),
  check (follower_profile_id<>following_profile_id)
);
create index if not exists profile_follows_v200_following_idx on public.profile_follows_v200(following_profile_id,created_at desc);
alter table public.profile_follows_v200 enable row level security;
revoke all on public.profile_follows_v200 from anon, authenticated;

create or replace function public.social_feed_reactions_v200(p_profile_id uuid,p_event_ids uuid[])
returns jsonb language sql stable security definer set search_path to 'public','pg_temp' as $$
  with wanted as (select unnest(coalesce(p_event_ids,array[]::uuid[])) as event_id),
  counts as (
    select r.activity_event_id,
      count(*) filter(where r.reaction='fire')::int fire,
      count(*) filter(where r.reaction='eyes')::int eyes,
      count(*) filter(where r.reaction='diamond')::int diamond,
      max(case when r.profile_id=p_profile_id then r.reaction end) viewer_reaction
    from public.social_reactions_v200 r join wanted w on w.event_id=r.activity_event_id group by r.activity_event_id
  )
  select coalesce(jsonb_object_agg(w.event_id::text,jsonb_build_object('fire',coalesce(c.fire,0),'eyes',coalesce(c.eyes,0),'diamond',coalesce(c.diamond,0),'viewerReaction',c.viewer_reaction)),'{}'::jsonb)
  from wanted w left join counts c on c.activity_event_id=w.event_id;
$$;

create or replace function public.social_toggle_reaction_v200(p_profile_id uuid,p_event_id uuid,p_reaction text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_existing text;
begin
  if p_reaction not in ('fire','eyes','diamond') then raise exception 'Invalid reaction'; end if;
  if not exists(select 1 from public.activity_events_v074 where id=p_event_id and visibility='public') then raise exception 'Activity event not found'; end if;
  select reaction into v_existing from public.social_reactions_v200 where activity_event_id=p_event_id and profile_id=p_profile_id for update;
  if found and v_existing=p_reaction then
    delete from public.social_reactions_v200 where activity_event_id=p_event_id and profile_id=p_profile_id;
    return jsonb_build_object('active',false,'reaction',p_reaction);
  end if;
  insert into public.social_reactions_v200(activity_event_id,profile_id,reaction) values(p_event_id,p_profile_id,p_reaction)
  on conflict(activity_event_id,profile_id) do update set reaction=excluded.reaction,created_at=now();
  return jsonb_build_object('active',true,'reaction',p_reaction);
end;
$$;

grant execute on function public.social_feed_reactions_v200(uuid,uuid[]) to service_role;
grant execute on function public.social_toggle_reaction_v200(uuid,uuid,text) to service_role;

commit;
