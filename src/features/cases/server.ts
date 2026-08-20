import { createServerSupabase } from '@/lib/supabase/server';
import type { z } from 'zod';
import type { caseRollRequestSchema } from './schema';

type CaseRollRequest=z.infer<typeof caseRollRequestSchema>;
export async function rollCase(playerId:string,body:CaseRollRequest){
  const supabase=createServerSupabase();
  const {data,error}=await supabase.rpc('autosyndicate_server_roll_case_v10',{p_player_id:playerId,p_case_id:body.caseId,p_context:body.context});
  if(error)throw error;
  return Array.isArray(data)?data[0]:data;
}
export async function claimCase(playerId:string,rollId:string){
  const supabase=createServerSupabase();
  const {data,error}=await supabase.rpc('autosyndicate_server_claim_case_v10',{p_player_id:playerId,p_roll_id:rollId});
  if(error)throw error;
  return Boolean(data);
}
