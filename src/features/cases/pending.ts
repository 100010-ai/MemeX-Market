import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';

export async function listPendingCaseRolls(playerId: string) {
  const supabase = createServerSupabase();
  const { data: principal, error: principalError } = await supabase
    .from('player_profiles')
    .select('owner_uid')
    .eq('id', playerId)
    .maybeSingle();
  if (principalError) throw principalError;
  if (!principal?.owner_uid) throw new Error('profile principal missing');
  const { data, error } = await supabase
    .from('case_rolls')
    .select('id,case_id,price,prize,created_at')
    .eq('owner_uid', principal.owner_uid)
    .is('claimed_at', null)
    .order('created_at', { ascending: true })
    .limit(8);
  if (error) throw error;
  return data ?? [];
}
