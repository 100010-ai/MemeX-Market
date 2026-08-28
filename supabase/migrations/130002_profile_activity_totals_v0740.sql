begin;

create table if not exists public.profile_activity_totals_v074 (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  coin_trade_count bigint not null default 0 check(coin_trade_count>=0),
  coin_sell_count bigint not null default 0 check(coin_sell_count>=0),
  gift_trade_count bigint not null default 0 check(gift_trade_count>=0),
  gift_sale_count bigint not null default 0 check(gift_sale_count>=0),
  trade_volume numeric not null default 0 check(trade_volume>=0),
  cases_opened bigint not null default 0 check(cases_opened>=0),
  legendary_drops bigint not null default 0 check(legendary_drops>=0),
  coins_created bigint not null default 0 check(coins_created>=0),
  stars_paid_count bigint not null default 0 check(stars_paid_count>=0),
  stars_paid_total bigint not null default 0 check(stars_paid_total>=0),
  active_days integer not null default 0 check(active_days>=0),
  last_activity_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists profile_activity_active_v074_idx on public.profile_activity_totals_v074(active_days desc,trade_volume desc,profile_id);
create table if not exists public.profile_activity_days_v074 (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  created_at timestamptz not null default now(),
  primary key(profile_id,activity_date)
);
alter table public.profile_activity_totals_v074 enable row level security;
alter table public.profile_activity_days_v074 enable row level security;
revoke all on public.profile_activity_totals_v074,public.profile_activity_days_v074 from public,anon,authenticated;
grant select,insert,update,delete on public.profile_activity_totals_v074,public.profile_activity_days_v074 to service_role;

create or replace function public.profile_activity_touch_day_v074(p_profile_id uuid,p_at timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_rows integer:=0; v_at timestamptz:=coalesce(p_at,now());
begin
  insert into public.profile_activity_days_v074(profile_id,activity_date) values(p_profile_id,(v_at at time zone 'UTC')::date) on conflict do nothing;
  get diagnostics v_rows=row_count;
  insert into public.profile_activity_totals_v074(profile_id,active_days,last_activity_at)
  values(p_profile_id,case when v_rows=1 then 1 else 0 end,v_at)
  on conflict(profile_id) do update set active_days=public.profile_activity_totals_v074.active_days+case when v_rows=1 then 1 else 0 end,last_activity_at=greatest(coalesce(public.profile_activity_totals_v074.last_activity_at,v_at),v_at),updated_at=now();
end;$$;

create or replace function public.profile_activity_trade_v074() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(new.is_launch_seed,false) then return new; end if;
  insert into public.profile_activity_totals_v074(profile_id,coin_trade_count,coin_sell_count,trade_volume,last_activity_at)
  values(new.profile_id,1,case when new.side='sell' then 1 else 0 end,new.quote_amount,new.created_at)
  on conflict(profile_id) do update set coin_trade_count=public.profile_activity_totals_v074.coin_trade_count+1,coin_sell_count=public.profile_activity_totals_v074.coin_sell_count+case when new.side='sell' then 1 else 0 end,trade_volume=public.profile_activity_totals_v074.trade_volume+new.quote_amount,last_activity_at=greatest(coalesce(public.profile_activity_totals_v074.last_activity_at,new.created_at),new.created_at),updated_at=now();
  perform public.profile_activity_touch_day_v074(new.profile_id,new.created_at); return new;
end;$$;
drop trigger if exists profile_activity_trade_v074 on public.trades;
create trigger profile_activity_trade_v074 after insert on public.trades for each row execute function public.profile_activity_trade_v074();

create or replace function public.profile_activity_gift_trade_v074() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.profile_activity_totals_v074(profile_id,gift_trade_count,trade_volume,last_activity_at) values(new.buyer_profile_id,1,new.price,new.created_at)
  on conflict(profile_id) do update set gift_trade_count=public.profile_activity_totals_v074.gift_trade_count+1,trade_volume=public.profile_activity_totals_v074.trade_volume+new.price,last_activity_at=greatest(coalesce(public.profile_activity_totals_v074.last_activity_at,new.created_at),new.created_at),updated_at=now();
  perform public.profile_activity_touch_day_v074(new.buyer_profile_id,new.created_at);
  if new.seller_profile_id is not null and new.seller_profile_id<>new.buyer_profile_id then
    insert into public.profile_activity_totals_v074(profile_id,gift_trade_count,gift_sale_count,trade_volume,last_activity_at) values(new.seller_profile_id,1,1,new.price,new.created_at)
    on conflict(profile_id) do update set gift_trade_count=public.profile_activity_totals_v074.gift_trade_count+1,gift_sale_count=public.profile_activity_totals_v074.gift_sale_count+1,trade_volume=public.profile_activity_totals_v074.trade_volume+new.price,last_activity_at=greatest(coalesce(public.profile_activity_totals_v074.last_activity_at,new.created_at),new.created_at),updated_at=now();
    perform public.profile_activity_touch_day_v074(new.seller_profile_id,new.created_at);
  elsif new.seller_profile_id=new.buyer_profile_id then update public.profile_activity_totals_v074 set gift_sale_count=gift_sale_count+1,updated_at=now() where profile_id=new.buyer_profile_id; end if;
  return new;
end;$$;
drop trigger if exists profile_activity_gift_trade_v074 on public.gift_trades;
create trigger profile_activity_gift_trade_v074 after insert on public.gift_trades for each row execute function public.profile_activity_gift_trade_v074();

create or replace function public.profile_activity_case_v074() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.profile_activity_totals_v074(profile_id,cases_opened,legendary_drops,last_activity_at) values(new.profile_id,1,case when new.rarity='legendary' then 1 else 0 end,new.opened_at)
  on conflict(profile_id) do update set cases_opened=public.profile_activity_totals_v074.cases_opened+1,legendary_drops=public.profile_activity_totals_v074.legendary_drops+case when new.rarity='legendary' then 1 else 0 end,last_activity_at=greatest(coalesce(public.profile_activity_totals_v074.last_activity_at,new.opened_at),new.opened_at),updated_at=now();
  perform public.profile_activity_touch_day_v074(new.profile_id,new.opened_at); return new;
end;$$;
drop trigger if exists profile_activity_case_v074 on public.case_openings;
create trigger profile_activity_case_v074 after insert on public.case_openings for each row execute function public.profile_activity_case_v074();

create or replace function public.profile_activity_coin_v074() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.creator_profile_id is null then return new; end if;
  insert into public.profile_activity_totals_v074(profile_id,coins_created,last_activity_at) values(new.creator_profile_id,1,new.created_at)
  on conflict(profile_id) do update set coins_created=public.profile_activity_totals_v074.coins_created+1,last_activity_at=greatest(coalesce(public.profile_activity_totals_v074.last_activity_at,new.created_at),new.created_at),updated_at=now();
  perform public.profile_activity_touch_day_v074(new.creator_profile_id,new.created_at); return new;
end;$$;
drop trigger if exists profile_activity_coin_v074 on public.coins;
create trigger profile_activity_coin_v074 after insert on public.coins for each row execute function public.profile_activity_coin_v074();

create or replace function public.profile_activity_stars_v074() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_at timestamptz;
begin
  if new.status='paid' and (tg_op='INSERT' or old.status is distinct from 'paid') then
    v_at:=coalesce(new.paid_at,new.updated_at,new.created_at);
    insert into public.profile_activity_totals_v074(profile_id,stars_paid_count,stars_paid_total,last_activity_at) values(new.profile_id,1,new.stars,v_at)
    on conflict(profile_id) do update set stars_paid_count=public.profile_activity_totals_v074.stars_paid_count+1,stars_paid_total=public.profile_activity_totals_v074.stars_paid_total+new.stars,last_activity_at=greatest(coalesce(public.profile_activity_totals_v074.last_activity_at,v_at),v_at),updated_at=now();
    perform public.profile_activity_touch_day_v074(new.profile_id,v_at);
  end if; return new;
end;$$;
drop trigger if exists profile_activity_stars_v074 on public.star_purchases;
create trigger profile_activity_stars_v074 after insert or update of status on public.star_purchases for each row execute function public.profile_activity_stars_v074();

insert into public.profile_activity_totals_v074(profile_id) select id from public.profiles on conflict do nothing;
with x as (select profile_id,count(*)::bigint c,count(*) filter(where side='sell')::bigint sells,coalesce(sum(quote_amount),0) v,max(created_at) last_at from public.trades where not coalesce(is_launch_seed,false) group by profile_id)
update public.profile_activity_totals_v074 a set coin_trade_count=x.c,coin_sell_count=x.sells,trade_volume=x.v,last_activity_at=x.last_at,updated_at=now() from x where a.profile_id=x.profile_id;
with parties as (select id,buyer_profile_id profile_id,price,created_at,false is_sale from public.gift_trades union all select id,seller_profile_id,price,created_at,true from public.gift_trades where seller_profile_id is not null and seller_profile_id<>buyer_profile_id), x as (select profile_id,count(*)::bigint c,count(*) filter(where is_sale)::bigint sales,coalesce(sum(price),0) v,max(created_at) last_at from parties group by profile_id)
update public.profile_activity_totals_v074 a set gift_trade_count=x.c,gift_sale_count=x.sales,trade_volume=a.trade_volume+x.v,last_activity_at=greatest(coalesce(a.last_activity_at,x.last_at),x.last_at),updated_at=now() from x where a.profile_id=x.profile_id;
with x as (select profile_id,count(*)::bigint c,count(*) filter(where rarity='legendary')::bigint legendary,max(opened_at) last_at from public.case_openings group by profile_id)
update public.profile_activity_totals_v074 a set cases_opened=x.c,legendary_drops=x.legendary,last_activity_at=greatest(coalesce(a.last_activity_at,x.last_at),x.last_at),updated_at=now() from x where a.profile_id=x.profile_id;
with x as (select creator_profile_id profile_id,count(*)::bigint c,max(created_at) last_at from public.coins where creator_profile_id is not null group by creator_profile_id)
update public.profile_activity_totals_v074 a set coins_created=x.c,last_activity_at=greatest(coalesce(a.last_activity_at,x.last_at),x.last_at),updated_at=now() from x where a.profile_id=x.profile_id;
with x as (select profile_id,count(*)::bigint c,coalesce(sum(stars),0)::bigint total,max(coalesce(paid_at,updated_at,created_at)) last_at from public.star_purchases where status='paid' group by profile_id)
update public.profile_activity_totals_v074 a set stars_paid_count=x.c,stars_paid_total=x.total,last_activity_at=greatest(coalesce(a.last_activity_at,x.last_at),x.last_at),updated_at=now() from x where a.profile_id=x.profile_id;
insert into public.profile_activity_days_v074(profile_id,activity_date)
select distinct profile_id,activity_date from (
 select profile_id,(created_at at time zone 'UTC')::date activity_date from public.trades where not coalesce(is_launch_seed,false)
 union select buyer_profile_id,(created_at at time zone 'UTC')::date from public.gift_trades
 union select seller_profile_id,(created_at at time zone 'UTC')::date from public.gift_trades where seller_profile_id is not null
 union select profile_id,(opened_at at time zone 'UTC')::date from public.case_openings
 union select creator_profile_id,(created_at at time zone 'UTC')::date from public.coins where creator_profile_id is not null
 union select profile_id,(coalesce(paid_at,updated_at,created_at) at time zone 'UTC')::date from public.star_purchases where status='paid'
) q where profile_id is not null on conflict do nothing;
update public.profile_activity_totals_v074 a set active_days=x.c,updated_at=now() from (select profile_id,count(*)::integer c from public.profile_activity_days_v074 group by profile_id) x where x.profile_id=a.profile_id;

revoke execute on function public.profile_activity_touch_day_v074(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.profile_activity_touch_day_v074(uuid,timestamptz) to service_role;
commit;
