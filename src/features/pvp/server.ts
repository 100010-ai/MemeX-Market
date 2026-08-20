import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { z } from 'zod';
import type { pvpActionSchema } from './schema';

type PvpAction = z.infer<typeof pvpActionSchema>;

const PVP_FIELDS = 'id,challenger_id,challenger_name,accepter_id,accepter_name,power,stake,status,winner_id,created_at,resolved_at,settled_at';

export async function getPvpView(playerId: string) {
  const supabase = createServerSupabase();
  const [{ data: open, error: openError }, { data: resolved, error: resolvedError }] = await Promise.all([
    supabase.from('pvp_challenges').select(PVP_FIELDS).eq('status', 'open').order('id', { ascending: false }).limit(40),
    supabase.from('pvp_challenges').select(PVP_FIELDS).eq('challenger_id', playerId).eq('status', 'resolved').order('id', { ascending: false }).limit(20)
  ]);
  if (openError) throw openError;
  if (resolvedError) throw resolvedError;
  return { open: open ?? [], resolved: resolved ?? [] };
}

export async function applyPvpAction(playerId: string, action: PvpAction) {
  const args: Record<string, unknown> = {
    p_player_id: playerId,
    p_action: action.action,
    p_id: 'id' in action ? action.id : null,
    p_power: action.action === 'create' ? action.power : null,
    p_stake: action.action === 'create' ? action.stake : null,
    p_winner_id: action.action === 'resolve' ? action.winnerId : null
  };
  const { data, error } = await createServerSupabase().rpc('autosyndicate_server_pvp_action_v12', args);
  if (error) throw error;
  return data;
}
