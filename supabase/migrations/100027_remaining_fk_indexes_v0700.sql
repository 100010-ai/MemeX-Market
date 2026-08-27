begin;

-- Complete the remaining foreign-key coverage reported after the v0.70
-- hardening migration. Composite indexes start with the referenced columns so
-- they cover both referential actions and their common lookup shape.

create index if not exists app_error_affected_v056_profile_fk_idx
  on public.app_error_affected_v056(profile_id);
create index if not exists case_pity_state_case_sku_fk_idx
  on public.case_pity_state(case_sku);
create index if not exists profile_item_inventory_item_key_fk_idx
  on public.profile_item_inventory(item_key);
create index if not exists profile_level_claims_level_fk_idx
  on public.profile_level_claims(level);
create index if not exists referral_rewards_referred_profile_fk_idx
  on public.referral_rewards(referred_profile_id);
create index if not exists season_claims_reward_fk_idx
  on public.season_claims(season_id, level, track);
create index if not exists season_prestige_claims_season_fk_idx
  on public.season_prestige_claims(season_id);
create index if not exists star_purchases_product_sku_fk_idx
  on public.star_purchases(product_sku);
create index if not exists user_achievements_key_fk_idx
  on public.user_achievements(achievement_key);
create index if not exists user_missions_mission_id_fk_idx
  on public.user_missions(mission_id);

commit;
