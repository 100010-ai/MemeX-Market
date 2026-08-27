-- MemeX Market v0.72.3
-- Cover foreign-key columns added by verification and social league migrations.

create index if not exists coin_verifications_request_v071_idx
  on public.coin_verifications_v071 (request_id);
create index if not exists coin_verifications_verified_by_v071_idx
  on public.coin_verifications_v071 (verified_by);
create index if not exists creator_verifications_request_v071_idx
  on public.creator_verifications_v071 (request_id);
create index if not exists creator_verifications_verified_by_v071_idx
  on public.creator_verifications_v071 (verified_by);
create index if not exists league_hall_of_fame_profile_v0723_idx
  on public.league_hall_of_fame (profile_id);
create index if not exists league_season_entries_profile_v0723_idx
  on public.league_season_entries (profile_id);
create index if not exists verification_requests_coin_v071_idx
  on public.verification_requests_v071 (coin_id);
create index if not exists verification_requests_reviewed_by_v071_idx
  on public.verification_requests_v071 (reviewed_by);
