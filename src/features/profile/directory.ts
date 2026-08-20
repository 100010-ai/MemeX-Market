import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';

const PROFILE_FIELDS = 'id,name,photo_url,telegram_username,level,balance,xp,races,wins,losses,total_earned,owned_cars,active_car_id,current_car_name,best_0_100,rating,last_seen';

export async function listPlayers() {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('player_profiles')
    .select(PROFILE_FIELDS)
    .is('banned_at', null)
    .order('rating', { ascending: false })
    .order('wins', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function findPlayer(query: string) {
  const supabase = createServerSupabase();
  const raw = query.trim();
  if (!raw) return null;
  let request = supabase.from('player_profiles').select(PROFILE_FIELDS).is('banned_at', null);
  if (/^tg_[0-9]{1,24}$/.test(raw)) request = request.eq('id', raw);
  else if (raw.startsWith('@')) request = request.ilike('telegram_username', raw.slice(1));
  else request = request.ilike('name', raw);
  const { data, error } = await request.order('last_seen', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
