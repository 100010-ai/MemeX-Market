import { createServerSupabase } from '@/lib/supabase/server';
import type { z } from 'zod';
import type { profileSyncSchema } from './schema';

type ProfileSync = z.infer<typeof profileSyncSchema>;
export async function syncProfile(playerId:string, username:string|null, body:ProfileSync){
  const supabase=createServerSupabase();
  const {error}=await supabase.from('player_profiles').update({
    name:body.displayName,photo_url:body.photoUrl??null,current_car_name:body.currentCarName??null,
    active_car_id:body.activeCarId,telegram_username:username,last_seen:new Date().toISOString()
  }).eq('id',playerId);
  if(error)throw error;
}
