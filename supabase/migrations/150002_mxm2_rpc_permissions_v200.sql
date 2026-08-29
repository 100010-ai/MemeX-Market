begin;

revoke all on function public.trader_profile_stats_v200(uuid) from public, anon, authenticated;
revoke all on function public.leaderboard_snapshot_v200(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.create_gift_trade_offer_v200(uuid,uuid,uuid,numeric,integer,text) from public, anon, authenticated;
revoke all on function public.resolve_gift_trade_offer_v200(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.social_feed_reactions_v200(uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.social_toggle_reaction_v200(uuid,uuid,text) from public, anon, authenticated;

grant execute on function public.trader_profile_stats_v200(uuid) to service_role;
grant execute on function public.leaderboard_snapshot_v200(uuid,text,integer) to service_role;
grant execute on function public.create_gift_trade_offer_v200(uuid,uuid,uuid,numeric,integer,text) to service_role;
grant execute on function public.resolve_gift_trade_offer_v200(uuid,uuid,text) to service_role;
grant execute on function public.social_feed_reactions_v200(uuid,uuid[]) to service_role;
grant execute on function public.social_toggle_reaction_v200(uuid,uuid,text) to service_role;

commit;
