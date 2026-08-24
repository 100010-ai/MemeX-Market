-- MemeX Market v0.66.2
-- Make a paid first launch reachable from the normal 100 TON starter wallet.
-- The default 10 TON seed plus the 50 TON fee still creates a meaningful sink.

update public.economy_settings
set coin_launch_fee=50,
    updated_at=now()
where singleton=true
  and coin_launch_fee=150;
