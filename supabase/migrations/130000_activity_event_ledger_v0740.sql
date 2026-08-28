begin;

-- MemeX Market v0.74.0
-- One normalized, idempotent event stream for the public market feed and
-- future notification/progression consumers. Existing domain tables remain
-- authoritative; this table is a projection, never a source of balances.

create table if not exists public.activity_events_v074 (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  importance smallint not null default 20 check (importance between 0 and 100),
  visibility text not null default 'public' check (visibility in ('public','private','system')),
  audience_profile_id uuid references public.profiles(id) on delete cascade,
  coin_id uuid references public.coins(id) on delete set null,
  virtual_gift_id uuid references public.virtual_gifts(id) on delete set null,
  amount numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(dedupe_key) between 3 and 180),
  check (char_length(kind) between 2 and 80)
);

create index if not exists activity_events_public_v074_idx
  on public.activity_events_v074(created_at desc,importance desc,id)
  where visibility='public';
create index if not exists activity_events_actor_v074_idx
  on public.activity_events_v074(actor_profile_id,created_at desc)
  where actor_profile_id is not null;
create index if not exists activity_events_audience_v074_idx
  on public.activity_events_v074(audience_profile_id,created_at desc)
  where audience_profile_id is not null;
create index if not exists activity_events_coin_v074_idx
  on public.activity_events_v074(coin_id,created_at desc)
  where coin_id is not null;
create index if not exists activity_events_gift_v074_idx
  on public.activity_events_v074(virtual_gift_id,created_at desc)
  where virtual_gift_id is not null;

alter table public.activity_events_v074 enable row level security;
revoke all on public.activity_events_v074 from public,anon,authenticated;
grant select,insert,update,delete on public.activity_events_v074 to service_role;

create or replace function public.emit_activity_event_v074(
  p_dedupe_key text,
  p_actor_profile_id uuid,
  p_kind text,
  p_importance integer default 20,
  p_visibility text default 'public',
  p_audience_profile_id uuid default null,
  p_coin_id uuid default null,
  p_virtual_gift_id uuid default null,
  p_amount numeric default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid;
begin
  if coalesce(length(trim(p_dedupe_key)),0)<3 then raise exception 'Activity dedupe key missing'; end if;
  if coalesce(length(trim(p_kind)),0)<2 then raise exception 'Activity kind missing'; end if;
  if p_visibility not in ('public','private','system') then raise exception 'Invalid activity visibility'; end if;

  insert into public.activity_events_v074(
    dedupe_key,actor_profile_id,kind,importance,visibility,audience_profile_id,
    coin_id,virtual_gift_id,amount,metadata,created_at
  ) values (
    left(trim(p_dedupe_key),180),p_actor_profile_id,left(trim(p_kind),80),
    greatest(0,least(100,coalesce(p_importance,20))),p_visibility,p_audience_profile_id,
    p_coin_id,p_virtual_gift_id,p_amount,coalesce(p_metadata,'{}'::jsonb),coalesce(p_created_at,now())
  )
  on conflict(dedupe_key) do update set
    importance=greatest(public.activity_events_v074.importance,excluded.importance),
    metadata=public.activity_events_v074.metadata||excluded.metadata
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.activity_event_from_trade_v074()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_importance integer;
begin
  if coalesce(new.is_launch_seed,false) then return new; end if;
  v_importance:=case
    when new.quote_amount>=100 then 92
    when new.quote_amount>=25 then 76
    when new.quote_amount>=5 then 56
    when new.quote_amount>=1 then 38
    else 24 end;
  perform public.emit_activity_event_v074(
    'coin-trade:'||new.id,new.profile_id,
    case when new.side='buy' then 'coin_buy' else 'coin_sell' end,
    v_importance,'public',null,new.coin_id,null,new.quote_amount,
    jsonb_build_object('side',new.side,'price',new.price,'tokenAmount',new.token_amount,'realizedPnl',coalesce(new.realized_pnl,0)),
    new.created_at
  );
  return new;
end;
$$;

drop trigger if exists activity_trade_v074 on public.trades;
create trigger activity_trade_v074 after insert on public.trades
for each row execute function public.activity_event_from_trade_v074();

create or replace function public.activity_event_from_gift_trade_v074()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_importance integer;
begin
  v_importance:=case
    when new.price>=1000 then 94
    when new.price>=250 then 80
    when new.price>=50 then 62
    when new.price>=10 then 46
    else 30 end;
  perform public.emit_activity_event_v074(
    'gift-trade:'||new.id,new.buyer_profile_id,'gift_sale',v_importance,'public',null,null,new.virtual_gift_id,new.price,
    jsonb_build_object('sellerProfileId',new.seller_profile_id,'realizedPnl',coalesce(new.realized_pnl,0)),new.created_at
  );
  return new;
end;
$$;

drop trigger if exists activity_gift_trade_v074 on public.gift_trades;
create trigger activity_gift_trade_v074 after insert on public.gift_trades
for each row execute function public.activity_event_from_gift_trade_v074();

create or replace function public.activity_event_from_gift_listing_v074()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_kind text; v_amount numeric;
begin
  v_kind:=case new.kind
    when 'listed' then 'gift_listed'
    when 'repriced' then 'gift_repriced'
    when 'unlisted' then 'gift_unlisted'
    when 'expired' then 'gift_expired'
    else null end;
  if v_kind is null then return new; end if;
  v_amount:=case when new.kind in ('listed','repriced') then new.price else new.previous_price end;
  perform public.emit_activity_event_v074(
    'gift-listing:'||new.id,new.actor_profile_id,v_kind,
    case when new.kind='listed' then 34 when new.kind='repriced' then 25 else 14 end,
    'public',null,null,new.virtual_gift_id,v_amount,
    jsonb_build_object('price',new.price,'previousPrice',new.previous_price),new.created_at
  );
  return new;
end;
$$;

drop trigger if exists activity_gift_listing_v074 on public.gift_listing_events;
create trigger activity_gift_listing_v074 after insert on public.gift_listing_events
for each row execute function public.activity_event_from_gift_listing_v074();

create or replace function public.activity_event_from_market_event_v074()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.kind='launch' and new.coin_id is not null then
    perform public.emit_activity_event_v074('market-event:'||new.id,new.actor_profile_id,'coin_launch',70,'public',null,new.coin_id,null,new.amount,'{}'::jsonb,new.created_at);
  elsif new.kind='offer' and new.virtual_gift_id is not null and new.amount is not null then
    perform public.emit_activity_event_v074('market-event:'||new.id,new.actor_profile_id,'gift_offer',28,'public',null,null,new.virtual_gift_id,new.amount,'{}'::jsonb,new.created_at);
  end if;
  return new;
end;
$$;

drop trigger if exists activity_market_event_v074 on public.market_events;
create trigger activity_market_event_v074 after insert on public.market_events
for each row execute function public.activity_event_from_market_event_v074();

create or replace function public.activity_event_from_case_open_v074()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.rarity not in ('epic','legendary') then return new; end if;
  perform public.emit_activity_event_v074(
    'case-open:'||new.id,new.profile_id,'case_drop',
    case when new.rarity='legendary' then 88 else 66 end,'public',null,null,null,new.reward_amount,
    jsonb_build_object('caseSku',new.case_sku,'rewardLabel',new.reward_label,'rewardKind',new.reward_kind,'rarity',new.rarity,'pityTriggered',new.pity_triggered,'pityRarity',new.pity_rarity),
    new.opened_at
  );
  return new;
end;
$$;

drop trigger if exists activity_case_open_v074 on public.case_openings;
create trigger activity_case_open_v074 after insert on public.case_openings
for each row execute function public.activity_event_from_case_open_v074();

-- Recent backfill only. The ledger is a live projection, not a second permanent
-- copy of every historical row the project has ever produced.
insert into public.activity_events_v074(dedupe_key,actor_profile_id,kind,importance,visibility,coin_id,amount,metadata,created_at)
select 'coin-trade:'||t.id,t.profile_id,case when t.side='buy' then 'coin_buy' else 'coin_sell' end,
  case when t.quote_amount>=100 then 92 when t.quote_amount>=25 then 76 when t.quote_amount>=5 then 56 when t.quote_amount>=1 then 38 else 24 end,
  'public',t.coin_id,t.quote_amount,jsonb_build_object('side',t.side,'price',t.price,'tokenAmount',t.token_amount,'realizedPnl',coalesce(t.realized_pnl,0)),t.created_at
from public.trades t
where not coalesce(t.is_launch_seed,false) and t.created_at>=now()-interval '14 days'
on conflict(dedupe_key) do nothing;

insert into public.activity_events_v074(dedupe_key,actor_profile_id,kind,importance,visibility,virtual_gift_id,amount,metadata,created_at)
select 'gift-trade:'||g.id,g.buyer_profile_id,'gift_sale',
  case when g.price>=1000 then 94 when g.price>=250 then 80 when g.price>=50 then 62 when g.price>=10 then 46 else 30 end,
  'public',g.virtual_gift_id,g.price,jsonb_build_object('sellerProfileId',g.seller_profile_id,'realizedPnl',coalesce(g.realized_pnl,0)),g.created_at
from public.gift_trades g where g.created_at>=now()-interval '14 days'
on conflict(dedupe_key) do nothing;

insert into public.activity_events_v074(dedupe_key,actor_profile_id,kind,importance,visibility,virtual_gift_id,amount,metadata,created_at)
select 'gift-listing:'||e.id,e.actor_profile_id,
  case e.kind when 'listed' then 'gift_listed' when 'repriced' then 'gift_repriced' when 'unlisted' then 'gift_unlisted' when 'expired' then 'gift_expired' end,
  case when e.kind='listed' then 34 when e.kind='repriced' then 25 else 14 end,'public',e.virtual_gift_id,
  case when e.kind in ('listed','repriced') then e.price else e.previous_price end,
  jsonb_build_object('price',e.price,'previousPrice',e.previous_price),e.created_at
from public.gift_listing_events e
where e.kind in ('listed','repriced','unlisted','expired') and e.created_at>=now()-interval '14 days'
on conflict(dedupe_key) do nothing;

insert into public.activity_events_v074(dedupe_key,actor_profile_id,kind,importance,visibility,coin_id,virtual_gift_id,amount,metadata,created_at)
select 'market-event:'||e.id,e.actor_profile_id,
  case when e.kind='launch' then 'coin_launch' else 'gift_offer' end,
  case when e.kind='launch' then 70 else 28 end,'public',e.coin_id,e.virtual_gift_id,e.amount,'{}'::jsonb,e.created_at
from public.market_events e
where e.created_at>=now()-interval '14 days'
  and ((e.kind='launch' and e.coin_id is not null) or (e.kind='offer' and e.virtual_gift_id is not null and e.amount is not null))
on conflict(dedupe_key) do nothing;

insert into public.activity_events_v074(dedupe_key,actor_profile_id,kind,importance,visibility,amount,metadata,created_at)
select 'case-open:'||o.id,o.profile_id,'case_drop',case when o.rarity='legendary' then 88 else 66 end,'public',o.reward_amount,
  jsonb_build_object('caseSku',o.case_sku,'rewardLabel',o.reward_label,'rewardKind',o.reward_kind,'rarity',o.rarity,'pityTriggered',o.pity_triggered,'pityRarity',o.pity_rarity),o.opened_at
from public.case_openings o
where o.rarity in ('epic','legendary') and o.opened_at>=now()-interval '14 days'
on conflict(dedupe_key) do nothing;

create or replace function public.activity_feed_snapshot_v074(p_limit integer default 30)
returns jsonb language sql security definer set search_path=public,pg_temp stable as $$
  with picked as (
    select e.*
    from public.activity_events_v074 e
    left join public.profiles p on p.id=e.actor_profile_id
    where e.visibility='public' and not coalesce(p.is_system,false)
    order by e.created_at desc,e.importance desc,e.id desc
    limit greatest(1,least(coalesce(p_limit,30),100))
  ), shaped as (
    select e.id,
      case e.kind
        when 'coin_buy' then 'coin'
        when 'coin_sell' then 'coin'
        when 'gift_sale' then 'gift'
        when 'coin_launch' then 'launch'
        when 'gift_listed' then 'listing'
        when 'gift_repriced' then 'reprice'
        when 'gift_unlisted' then 'unlist'
        when 'gift_expired' then 'unlist'
        when 'gift_offer' then 'offer'
        when 'case_drop' then 'case'
        else 'event' end as ui_kind,
      e.actor_profile_id,
      coalesce(nullif(p.username,''),'') as username,
      coalesce(nullif(p.first_name,''),'Удалённый игрок') as first_name,
      e.kind,e.importance,e.coin_id,c.symbol,c.image_url as coin_image_url,e.virtual_gift_id,
      g.base_name,g.gift_number,g.model_preview_url,g.model_media_url,g.symbol_media_url,
      e.amount,e.metadata,e.created_at
    from picked e
    left join public.profiles p on p.id=e.actor_profile_id
    left join public.coins c on c.id=e.coin_id
    left join public.gift_market_overview g on g.virtual_gift_id=e.virtual_gift_id
  )
  select jsonb_build_object('activity',coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'kind',ui_kind,'actorId',actor_profile_id,
    'actorName',case when username<>'' then '@'||username else first_name end,
    'eventKind',kind,'importance',importance,'coinId',coin_id,'symbol',symbol,'coinImageUrl',coin_image_url,
    'virtualGiftId',virtual_gift_id,'baseName',base_name,'giftNumber',gift_number,
    'modelPreviewUrl',model_preview_url,'modelMediaUrl',model_media_url,'symbolMediaUrl',symbol_media_url,
    'amount',amount,'metadata',metadata,'createdAt',created_at
  ) order by created_at desc,importance desc,id desc),'[]'::jsonb)) from shaped;
$$;

revoke execute on function public.emit_activity_event_v074(text,uuid,text,integer,text,uuid,uuid,uuid,numeric,jsonb,timestamptz) from public,anon,authenticated;
revoke execute on function public.activity_feed_snapshot_v074(integer) from public,anon,authenticated;
grant execute on function public.emit_activity_event_v074(text,uuid,text,integer,text,uuid,uuid,uuid,numeric,jsonb,timestamptz),public.activity_feed_snapshot_v074(integer) to service_role;

commit;
