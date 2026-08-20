import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';

export async function getReferralDashboard(playerId: string) {
  const { data, error } = await createServerSupabase().rpc('autosyndicate_server_referral_dashboard_v12', { p_player_id: playerId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function bindReferral(playerId: string, code: string) {
  const { data, error } = await createServerSupabase().rpc('autosyndicate_server_bind_referrer_v12', { p_player_id: playerId, p_referral_code: code });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function claimReferralRewards(playerId: string) {
  const { data, error } = await createServerSupabase().rpc('autosyndicate_server_claim_referrals_v12', { p_player_id: playerId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return Number(row?.amount ?? row ?? 0) || 0;
}

export async function claimFirstRaceBonus(playerId: string) {
  const { data, error } = await createServerSupabase().rpc('autosyndicate_server_claim_first_race_bonus_v12', { p_player_id: playerId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return Number(row?.bonus ?? row ?? 0) || 0;
}
