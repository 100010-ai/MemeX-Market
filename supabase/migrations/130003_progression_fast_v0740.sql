begin;

create or replace function public.refresh_achievements_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_created timestamptz; v_totals public.profile_activity_totals_v074;
  v_coin_trades integer:=0; v_gift_trades integer:=0; v_sales integer:=0; v_volume numeric:=0; v_gifts integer:=0; v_coins integer:=0; v_cases integer:=0; v_legendaries integer:=0;
  v_collections integer:=0; v_streak integer:=0; v_season integer:=0; v_level integer:=1; v_row public.achievements; v_value numeric:=0; v_inserted integer:=0; v_unlocked integer:=0;
begin
  select created_at into v_created from public.profiles where id=p_profile_id; if v_created is null then raise exception 'Profile not found'; end if;
  select * into v_totals from public.profile_activity_totals_v074 where profile_id=p_profile_id;
  v_coin_trades:=coalesce(v_totals.coin_trade_count,0); v_gift_trades:=coalesce(v_totals.gift_trade_count,0);
  v_sales:=coalesce(v_totals.coin_sell_count,0)+coalesce(v_totals.gift_sale_count,0); v_volume:=coalesce(v_totals.trade_volume,0);
  v_coins:=coalesce(v_totals.coins_created,0); v_cases:=coalesce(v_totals.cases_opened,0); v_legendaries:=coalesce(v_totals.legendary_drops,0);
  select count(*)::integer into v_gifts from public.virtual_gifts where owner_profile_id=p_profile_id;
  select count(distinct lower(trim(base_name)))::integer into v_collections from public.collection_milestone_claims where profile_id=p_profile_id and milestone=100;
  select coalesce(best_streak,0) into v_streak from public.daily_streak_state where profile_id=p_profile_id; v_streak:=coalesce(v_streak,0);
  select count(*)::integer into v_season from public.season_claims where profile_id=p_profile_id;
  select public.account_level_v064(xp) into v_level from public.profiles where id=p_profile_id;
  for v_row in select * from public.achievements where active=true and metric_key is not null order by sort_order,key loop
    v_value:=case v_row.metric_key when 'trades' then v_coin_trades+v_gift_trades when 'sales' then v_sales when 'volume' then v_volume when 'gifts_owned' then v_gifts when 'coins_created' then v_coins when 'cases_opened' then v_cases when 'legendary_drops' then v_legendaries when 'collections_completed' then v_collections when 'streak_best' then v_streak when 'season_claims' then v_season when 'account_level' then v_level when 'early_user' then case when v_created<'2026-09-01'::timestamptz then 1 else 0 end else 0 end;
    if v_value>=v_row.target then
      insert into public.user_achievements(profile_id,achievement_key,metadata) values(p_profile_id,v_row.key,jsonb_build_object('metric',v_row.metric_key,'value',v_value,'target',v_row.target)) on conflict(profile_id,achievement_key) do nothing;
      get diagnostics v_inserted=row_count;
      if v_inserted=1 then v_unlocked:=v_unlocked+1; if v_row.xp_reward>0 then perform public.award_profile_xp(p_profile_id,'achievement:'||v_row.key,v_row.xp_reward); end if; end if;
    end if;
  end loop;
  return jsonb_build_object('newlyUnlocked',v_unlocked,'metrics',jsonb_build_object('trades',v_coin_trades+v_gift_trades,'sales',v_sales,'volume',v_volume,'giftsOwned',v_gifts,'coinsCreated',v_coins,'casesOpened',v_cases,'legendaryDrops',v_legendaries,'collectionsCompleted',v_collections,'streakBest',v_streak,'seasonClaims',v_season,'accountLevel',v_level,'activeDays',coalesce(v_totals.active_days,0),'starsPaid',coalesce(v_totals.stars_paid_total,0)));
end;$$;

create or replace function public.progression_snapshot_v064(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_refresh jsonb; v_metrics jsonb; v_achievements jsonb:='[]'::jsonb; v_row record; v_value numeric;
  v_account jsonb; v_streak jsonb; v_season public.seasons; v_week_xp integer:=0; v_week_level integer:=1; v_claims integer:=0;
begin
  v_refresh:=public.refresh_achievements_v064(p_profile_id); v_metrics:=coalesce(v_refresh->'metrics','{}'::jsonb);
  for v_row in select a.*,ua.unlocked_at from public.achievements a left join public.user_achievements ua on ua.profile_id=p_profile_id and ua.achievement_key=a.key where a.active=true order by a.sort_order,a.key loop
    v_value:=case v_row.metric_key when 'trades' then coalesce((v_metrics->>'trades')::numeric,0) when 'sales' then coalesce((v_metrics->>'sales')::numeric,0) when 'volume' then coalesce((v_metrics->>'volume')::numeric,0) when 'gifts_owned' then coalesce((v_metrics->>'giftsOwned')::numeric,0) when 'coins_created' then coalesce((v_metrics->>'coinsCreated')::numeric,0) when 'cases_opened' then coalesce((v_metrics->>'casesOpened')::numeric,0) when 'legendary_drops' then coalesce((v_metrics->>'legendaryDrops')::numeric,0) when 'collections_completed' then coalesce((v_metrics->>'collectionsCompleted')::numeric,0) when 'streak_best' then coalesce((v_metrics->>'streakBest')::numeric,0) when 'season_claims' then coalesce((v_metrics->>'seasonClaims')::numeric,0) when 'account_level' then coalesce((v_metrics->>'accountLevel')::numeric,0) when 'early_user' then case when v_row.unlocked_at is not null then 1 else 0 end else 0 end;
    v_achievements:=v_achievements||jsonb_build_array(jsonb_build_object('key',v_row.key,'title',v_row.title,'description',v_row.description,'icon',v_row.icon,'xpReward',v_row.xp_reward,'category',v_row.category,'rarity',v_row.rarity,'progress',least(v_value,v_row.target),'target',v_row.target,'unlocked',v_row.unlocked_at is not null,'unlockedAt',v_row.unlocked_at));
  end loop;
  v_account:=public.account_progression_snapshot_v064(p_profile_id); v_streak:=public.daily_streak_snapshot_v064(p_profile_id);
  select * into v_season from public.seasons where active=true and now()>=starts_at and now()<ends_at order by starts_at desc limit 1;
  if v_season.id is not null then
    select coalesce(sum(amount),0)::integer into v_week_xp from public.profile_xp_events where profile_id=p_profile_id and created_at>=v_season.starts_at and created_at<v_season.ends_at;
    select coalesce(max(level),1) into v_week_level from public.season_rewards where season_id=v_season.id and track='free' and required_xp<=v_week_xp;
    select count(*)::integer into v_claims from public.season_claims where profile_id=p_profile_id and season_id=v_season.id;
  end if;
  return jsonb_build_object('account',v_account,'streak',v_streak,'achievements',v_achievements,'newlyUnlocked',coalesce((v_refresh->>'newlyUnlocked')::integer,0),
    'journey',jsonb_build_object('reputation',jsonb_build_object('xp',v_account->'xp','level',v_account->'level','prestigeLevel',v_account->'prestigeLevel'),'season',case when v_season.id is null then null else jsonb_build_object('id',v_season.id,'title',v_season.title,'xp',v_week_xp,'level',v_week_level,'claims',v_claims,'endsAt',v_season.ends_at) end,'activity',jsonb_build_object('activeDays',coalesce((v_metrics->>'activeDays')::integer,0),'starsPaid',coalesce((v_metrics->>'starsPaid')::bigint,0))));
end;$$;

commit;
