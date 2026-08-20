import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { z } from 'zod';
import type { bankActionSchema } from './schema';

type BankAction = z.infer<typeof bankActionSchema>;

export async function getBankHistory(playerId: string) {
  const { data, error } = await createServerSupabase()
    .from('bank_transfers')
    .select('id,sender_id,sender_name,receiver_id,amount,claimed,created_at,claimed_at')
    .or(`sender_id.eq.${playerId},receiver_id.eq.${playerId}`)
    .order('id', { ascending: false })
    .limit(60);
  if (error) throw error;
  return data ?? [];
}

export async function applyBankAction(playerId: string, action: BankAction) {
  const supabase = createServerSupabase();
  if (action.action === 'send') {
    const { data, error } = await supabase.rpc('autosyndicate_server_bank_send_v12', {
      p_player_id: playerId,
      p_receiver_id: action.receiverId,
      p_amount: action.amount
    });
    if (error) throw error;
    return { transfer: data };
  }
  const { data, error } = await supabase.rpc('autosyndicate_server_bank_claim_v12', { p_player_id: playerId });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return {
    claimed: rows,
    amount: rows.reduce((sum, row) => sum + Number(row?.amount ?? 0), 0)
  };
}
