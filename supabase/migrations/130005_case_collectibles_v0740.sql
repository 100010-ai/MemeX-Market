begin;

create table if not exists public.case_drop_serial_counters_v074 (
  case_sku text not null references public.case_definitions(sku) on delete cascade,
  rarity text not null check(rarity in ('epic','legendary')),
  last_serial bigint not null default 0 check(last_serial>=0),
  updated_at timestamptz not null default now(),
  primary key(case_sku,rarity)
);
create table if not exists public.case_drop_serials_v074 (
  opening_id uuid primary key references public.case_openings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  case_sku text not null references public.case_definitions(sku) on delete cascade,
  rarity text not null check(rarity in ('epic','legendary')),
  reward_label text not null,
  serial_number bigint not null check(serial_number>0),
  minted_at timestamptz not null,
  unique(case_sku,rarity,serial_number)
);
create index if not exists case_drop_serial_profile_v074_idx on public.case_drop_serials_v074(profile_id,minted_at desc);
create index if not exists case_drop_serial_global_v074_idx on public.case_drop_serials_v074(rarity,minted_at desc);
alter table public.case_drop_serial_counters_v074 enable row level security;
alter table public.case_drop_serials_v074 enable row level security;
revoke all on public.case_drop_serial_counters_v074,public.case_drop_serials_v074 from public,anon,authenticated;
grant select,insert,update,delete on public.case_drop_serial_counters_v074,public.case_drop_serials_v074 to service_role;

-- Preserve provenance for already-opened rare drops before live trigger starts.
with ranked as (
  select o.id opening_id,o.profile_id,o.case_sku,o.rarity,o.reward_label,o.opened_at,
    row_number() over(partition by o.case_sku,o.rarity order by o.opened_at,o.id)::bigint serial_number
  from public.case_openings o where o.rarity in ('epic','legendary')
)
insert into public.case_drop_serials_v074(opening_id,profile_id,case_sku,rarity,reward_label,serial_number,minted_at)
select opening_id,profile_id,case_sku,rarity,reward_label,serial_number,opened_at from ranked on conflict(opening_id) do nothing;
insert into public.case_drop_serial_counters_v074(case_sku,rarity,last_serial)
select case_sku,rarity,max(serial_number) from public.case_drop_serials_v074 group by case_sku,rarity
on conflict(case_sku,rarity) do update set last_serial=greatest(public.case_drop_serial_counters_v074.last_serial,excluded.last_serial),updated_at=now();

create or replace function public.mint_case_drop_serial_v074()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_serial bigint;
begin
  if new.rarity not in ('epic','legendary') then return new; end if;
  insert into public.case_drop_serial_counters_v074(case_sku,rarity,last_serial)
  values(new.case_sku,new.rarity,1)
  on conflict(case_sku,rarity) do update set last_serial=public.case_drop_serial_counters_v074.last_serial+1,updated_at=now()
  returning last_serial into v_serial;
  insert into public.case_drop_serials_v074(opening_id,profile_id,case_sku,rarity,reward_label,serial_number,minted_at)
  values(new.id,new.profile_id,new.case_sku,new.rarity,new.reward_label,v_serial,new.opened_at) on conflict(opening_id) do nothing;
  perform public.emit_activity_event_v074('case-open:'||new.id,new.profile_id,'case_drop',case when new.rarity='legendary' then 90 else 68 end,'public',null,null,null,new.reward_amount,
    jsonb_build_object('caseSku',new.case_sku,'rewardLabel',new.reward_label,'rewardKind',new.reward_kind,'rarity',new.rarity,'serialNumber',v_serial,'pityTriggered',new.pity_triggered),new.opened_at);
  return new;
end;$$;
drop trigger if exists mint_case_drop_serial_v074 on public.case_openings;
create trigger mint_case_drop_serial_v074 after insert on public.case_openings for each row execute function public.mint_case_drop_serial_v074();

create or replace function public.case_collection_snapshot_v074(p_profile_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp stable as $$
  select jsonb_build_object(
    'stats',jsonb_build_object(
      'serializedDrops',(select count(*) from public.case_drop_serials_v074 where profile_id=p_profile_id),
      'legendaryDrops',(select count(*) from public.case_drop_serials_v074 where profile_id=p_profile_id and rarity='legendary'),
      'caseSeries',(select count(distinct case_sku) from public.case_drop_serials_v074 where profile_id=p_profile_id),
      'bestSerial',(select min(serial_number) from public.case_drop_serials_v074 where profile_id=p_profile_id)
    ),
    'mine',coalesce((select jsonb_agg(jsonb_build_object('openingId',s.opening_id,'caseSku',s.case_sku,'rarity',s.rarity,'rewardLabel',s.reward_label,'serialNumber',s.serial_number,'mintedAt',s.minted_at) order by s.minted_at desc) from (select * from public.case_drop_serials_v074 where profile_id=p_profile_id order by minted_at desc limit 40) s),'[]'::jsonb),
    'recentRareDrops',coalesce((select jsonb_agg(jsonb_build_object('openingId',s.opening_id,'caseSku',s.case_sku,'rarity',s.rarity,'rewardLabel',s.reward_label,'serialNumber',s.serial_number,'mintedAt',s.minted_at,'profileId',p.id,'name',coalesce(nullif(p.username,''),p.first_name),'photoUrl',p.photo_url) order by s.minted_at desc) from (select * from public.case_drop_serials_v074 order by minted_at desc limit 30) s join public.profiles p on p.id=s.profile_id where not coalesce(p.is_system,false)),'[]'::jsonb)
  );
$$;

create or replace function public.case_snapshot_v074(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base jsonb; begin v_base:=public.case_snapshot_v200(p_profile_id); return coalesce(v_base,'{}'::jsonb)||jsonb_build_object('collection',public.case_collection_snapshot_v074(p_profile_id)); end; $$;

create or replace function public.open_case_v074(p_profile_id uuid,p_case_sku text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb; v_serial public.case_drop_serials_v074; begin
  v_result:=public.open_case_v200(p_profile_id,p_case_sku,p_request_id);
  select s.* into v_serial from public.case_openings o join public.case_drop_serials_v074 s on s.opening_id=o.id where o.profile_id=p_profile_id and o.request_id=p_request_id limit 1;
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('collectible',case when v_serial.opening_id is null then null else jsonb_build_object('serialNumber',v_serial.serial_number,'rarity',v_serial.rarity,'caseSku',v_serial.case_sku,'rewardLabel',v_serial.reward_label,'mintedAt',v_serial.minted_at) end);
end;$$;

revoke execute on function public.case_collection_snapshot_v074(uuid),public.case_snapshot_v074(uuid),public.open_case_v074(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.case_collection_snapshot_v074(uuid),public.case_snapshot_v074(uuid),public.open_case_v074(uuid,text,uuid) to service_role;
commit;
