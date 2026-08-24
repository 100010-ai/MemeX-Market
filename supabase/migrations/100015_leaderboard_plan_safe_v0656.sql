-- MemeX Market v0.65.6
-- Keep the leaderboard RPC plan-safe inside SECURITY DEFINER by forcing each
-- financial aggregate through the eligible player's indexed profile key.

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
  ), base as materialized (
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
      coalesce(cs.coin_trade_count,0::bigint) as coin_trade_count,
      coalesce(gs.seller_trades,0::bigint)+coalesce(gb.buyer_trades,0::bigint) as gift_trade_count,
      coalesce(g.gift_count,0::bigint) as gift_count,
      coalesce(cc.created_coin_market_cap,0) as created_coin_market_cap
    from eligible e
    left join lateral (
      select coalesce(sum(h.quantity*c.current_price),0) as coin_value
      from public.holdings h
      join public.coins c on c.id=h.coin_id
      where h.profile_id=e.id and h.quantity>0
    ) h on true
    left join lateral (
      select
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
      join public.gift_assets ga on ga.id=vg.asset_id
      where vg.owner_profile_id=e.id
        and coalesce(ga.is_burned,false)=false
    ) g on true
    left join lateral (
      select
        coalesce(sum(t.realized_pnl),0) as coin_realized_pnl,
        count(*) as coin_trade_count
      from public.trades t
      where t.profile_id=e.id
        and not coalesce(t.is_launch_seed,false)
    ) cs on true
    left join lateral (
      select
        coalesce(sum(gt.realized_pnl),0) as gift_realized_pnl,
        count(*) as seller_trades
      from public.gift_trades gt
      where gt.seller_profile_id=e.id
    ) gs on true
    left join lateral (
      select count(*) as buyer_trades
      from public.gift_trades gt
      where gt.buyer_profile_id=e.id
    ) gb on true
    left join lateral (
      select coalesce(sum(c.market_cap),0) as created_coin_market_cap
      from public.coins c
      where c.creator_profile_id=e.id
        and c.status='active'
    ) cc on true
  ), scored as materialized (
    select
      b.*,
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