-- MemeX Market v0.64.9
-- Harden SECURITY DEFINER trigger/event-trigger helpers against direct PostgREST RPC calls.
-- These functions are executed by PostgreSQL triggers, not by browser clients.
-- Keep service_role access explicit for server-side administration and diagnostics.

revoke execute on function public.enforce_player_only_gift_listing() from public, anon, authenticated;
revoke execute on function public.notify_gift_offer_v048() from public, anon, authenticated;
revoke execute on function public.notify_gift_trade_v048() from public, anon, authenticated;
revoke execute on function public.notify_offer_resolved_v048() from public, anon, authenticated;
revoke execute on function public.notify_promo_redeemed_v048() from public, anon, authenticated;
revoke execute on function public.notify_referral_reward_v048() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.settle_main_channel_clawback_v700() from public, anon, authenticated;
revoke execute on function public.xp_from_coin_trade_v06() from public, anon, authenticated;
revoke execute on function public.xp_from_gift_trade_v06() from public, anon, authenticated;
revoke execute on function public.xp_from_market_event_v06() from public, anon, authenticated;
revoke execute on function public.xp_from_mission_claim_v06() from public, anon, authenticated;

grant execute on function public.enforce_player_only_gift_listing() to service_role;
grant execute on function public.notify_gift_offer_v048() to service_role;
grant execute on function public.notify_gift_trade_v048() to service_role;
grant execute on function public.notify_offer_resolved_v048() to service_role;
grant execute on function public.notify_promo_redeemed_v048() to service_role;
grant execute on function public.notify_referral_reward_v048() to service_role;
grant execute on function public.rls_auto_enable() to service_role;
grant execute on function public.settle_main_channel_clawback_v700() to service_role;
grant execute on function public.xp_from_coin_trade_v06() to service_role;
grant execute on function public.xp_from_gift_trade_v06() to service_role;
grant execute on function public.xp_from_market_event_v06() to service_role;
grant execute on function public.xp_from_mission_claim_v06() to service_role;
