begin;

create index if not exists league_daily_entities_profile_v074_idx on public.league_daily_entities_v074(profile_id,activity_date desc,season_id);
create index if not exists star_purchase_reversals_profile_v074_idx on public.star_purchase_reversals_v074(profile_id,created_at desc);
create index if not exists referral_reward_reversals_referrer_v074_idx on public.referral_reward_reversals_v074(referrer_profile_id,created_at desc);

alter function public.league_division_v074(numeric) set search_path=public,pg_temp;

revoke execute on function public.activity_event_from_trade_v074() from public,anon,authenticated;
revoke execute on function public.activity_event_from_gift_trade_v074() from public,anon,authenticated;
revoke execute on function public.activity_event_from_gift_listing_v074() from public,anon,authenticated;
revoke execute on function public.activity_event_from_market_event_v074() from public,anon,authenticated;
revoke execute on function public.activity_event_from_case_open_v074() from public,anon,authenticated;
revoke execute on function public.league_trade_rollup_v074() from public,anon,authenticated;
revoke execute on function public.league_gift_trade_rollup_v074() from public,anon,authenticated;
revoke execute on function public.profile_activity_trade_v074() from public,anon,authenticated;
revoke execute on function public.profile_activity_gift_trade_v074() from public,anon,authenticated;
revoke execute on function public.profile_activity_case_v074() from public,anon,authenticated;
revoke execute on function public.profile_activity_coin_v074() from public,anon,authenticated;
revoke execute on function public.profile_activity_stars_v074() from public,anon,authenticated;
revoke execute on function public.mint_case_drop_serial_v074() from public,anon,authenticated;
revoke execute on function public.notify_activity_event_v074() from public,anon,authenticated;

commit;
