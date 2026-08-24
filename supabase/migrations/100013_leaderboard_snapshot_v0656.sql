-- MemeX Market v0.65.6
-- Compute leaderboard finances, presentation and caller rank in one set-based pass.

create or replace function public.leaderboard_snapshot_v0656(
  p_profile_id uuid,
  p_board text default 'overall',
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      case when p_board in ('overall','pnl','giftPnl','coinPnl','gifts','coins') then p_board else 'overall' end as board,
      greatest(5,least(coalesce(p_limit,100),100)) as row_limit
  ), eligible as materialized (
    select
      p.id,
      p.telegram_id,
      p.username,
      p.first_name,
      p.photo_url,
      p.balance,
      p.equipped_profile_frame
    from public.profiles p
    where coalesce(p.is_system,false)=false
      and coalesce(p.hidden_from_leaderboard,false)=false
      and not (
        coalesce(p.is_banned,false)=true
        and (p.banned_until is null or p.banned_until>now())
      )
  ), holding_stats as (
    select
      h.profile_id,
      coalesce(sum(h.quantity*c.current_price),0) as coin_value
    from public.holdings h
    join eligible e on e.id=h.profile_id
    join public.coins c on c.id=h.coin_id
    where h.quantity>0
    group by h.profile_id
  ), gift_stats as (
    select
      vg.owner_profile_id as profile_id,
      coalesce(sum(coalesce(
        case
          when ga.telegram_resale_price_ton is not null
            and ga.telegram_resale_price_ton>0
            and (ga.resale_seen_at is null or ga.resale_seen_at>=now()-interval '24 hours')
          then ga.telegram_resale_price_ton
        end,
        vg.last_sale_price,
        vg.acquired_price,
        0
      )),0) as gift_value,
      count(*) as gift_count
    from public.virtual_gifts vg
    join eligible e on e.id=vg.owner_profile_id
    join public.gift_assets ga on ga.id=vg.asset_id
    where coalesce(ga.is_burned,false)=false
    group by vg.owner_profile_id
  ), coin_stats as (
    select
      t.profile_id,
      coalesce(sum(t.realized_pnl),0) as coin_realized_pnl,
      count(*) as coin_trade_count
    from public.trades t
    join eligible e on e.id=t.profile_id
    where not coalesce(t.is_launch_seed,false)
    group by t.profile_id
  ), gift_seller as (
    select
      gt.seller_profile_id as profile_id,
      coalesce(sum(gt.realized_pnl),0) as gift_realized_pnl,
      count(*) as seller_trades
    from public.gift_trades gt
    join eligible e on e.id=gt.seller_profile_id
    where gt.seller_profile_id is not null
    group by gt.seller_profile_id
  ), gift_buyer as (
    select
      gt.buyer_profile_id as profile_id,
      count(*) as buyer_trades
    from public.gift_trades gt
    join eligible e on e.id=gt.buyer_profile_id
    group by gt.buyer_profile_id
  ), creator_caps as (
    select
      c.creator_profile_id as profile_id,
      coalesce(sum(c.market_cap),0) as created_coin_market_cap
    from public.coins c
    join eligible e on e.id=c.creator_profile_id
    where c.status='active'
    group by c.creator_profile_id
  ), base as (
    select
      e.id,
      e.username,
      e.first_name,
      e.photo_url,
      e.balance,
      e.equipped_profile_frame,
      coalesce(h.coin_value,0) as coin_value,
      coalesce(g.gift_value,0) as gift_value,
      e.balance+coalesce(h.coin_value,0)+coalesce(g.gift_value,0) as net_worth,
      coalesce(cs.coin_realized_pnl,0) as coin_realized_pnl,
      coalesce(gs.gift_realized_pnl,0) as gift_realized_pnl,
      coalesce(cs.coin_realized_pnl,0)+coalesce(gs.gift_realized_pnl,0) as realized_pnl,
      coalesce(cs.coin_trade_count,0) as coin_trade_count,
      coalesce(gs.seller_trades,0)+coalesce(gb.buyer_trades,0) as gift_trade_count,
      coalesce(g.gift_count,0) as gift_count,
      coalesce(cc.created_coin_market_cap,0) as created_coin_market_cap
    from eligible e
    left join holding_stats h on h.profile_id=e.id
    left join gift_stats g on g.profile_id=e.id
    left join coin_stats cs on cs.profile_id=e.id
    left join gift_seller gs on gs.profile_id=e.id
    left join gift_buyer gb on gb.profile_id=e.id
    left join creator_caps cc on cc.profile_id=e.id
  ), scored as (
    select b.*,
      case (select board from params)
        when 'pnl' then b.realized_pnl
        when 'giftPnl' then b.gift_realized_pnl
        when 'coinPnl' then b.coin_realized_pnl
        when 'gifts' then b.gift_value
        when 'coins' then b.created_coin_market_cap
        else b.net_worth
      end as score
    from base b
  ), ranked as materialized (
    select
      s.*,
      rank() over(order by s.score desc)::integer as rank,
      row_number() over(order by s.score desc,s.id asc)::integer as position
    from scored s
  )
  select jsonb_build_object(
    'players',coalesce((
      select jsonb_agg(
        to_jsonb(r)-'score'-'position'
        order by r.position
      )
      from ranked r
      cross join params p
      where r.position<=p.row_limit
    ),'[]'::jsonb),
    'meRank',(select r.rank from ranked r where r.id=p_profile_id limit 1)
  );
$$;

revoke execute on function public.leaderboard_snapshot_v0656(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.leaderboard_snapshot_v0656(uuid,text,integer) to service_role;
