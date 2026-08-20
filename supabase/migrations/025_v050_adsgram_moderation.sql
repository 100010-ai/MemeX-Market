begin;

-- MXM v0.50 — AdsGram moderation-safe defaults.
-- Rewarded ads are optional. MXM TON is an internal, non-withdrawable game balance.

update public.economy_settings
set schema_version=50,
    rewarded_ad_reward=1,
    rewarded_ad_daily_limit=3,
    rewarded_ad_cooldown_minutes=30,
    updated_at=now()
where singleton=true;

alter table public.economy_settings alter column schema_version set default 50;

-- Incentivized third-party subscription/click campaigns are not part of the
-- AdsGram moderation build. Preserve campaigns, but stop currently active ones.
update public.sponsored_campaigns
set status='paused', updated_at=now()
where status='active';

commit;
