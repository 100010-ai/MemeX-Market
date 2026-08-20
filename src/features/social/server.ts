import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { z } from 'zod';
import type { friendshipActionSchema } from './schema';

type FriendshipAction = z.infer<typeof friendshipActionSchema>;

type PublicFriendProfile = {
  id: string;
  name: string;
  telegram_username: string | null;
  photo_url: string | null;
  rating: number;
  wins: number;
  races: number;
  current_car_name: string | null;
  last_seen: string | null;
};

export async function applyFriendAction(playerId: string, body: FriendshipAction) {
  const supabase = createServerSupabase();
  let rpc: string;
  let args: Record<string, unknown>;
  if (body.action === 'request') {
    rpc = 'autosyndicate_server_friend_request_v10';
    args = { p_player_id: playerId, p_query: body.query };
  } else if (body.action === 'accept') {
    rpc = 'autosyndicate_server_friend_accept_v10';
    args = { p_player_id: playerId, p_friendship_id: body.friendshipId };
  } else {
    rpc = 'autosyndicate_server_friend_remove_v10';
    args = { p_player_id: playerId, p_friendship_id: body.friendshipId };
  }
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) throw error;
  return data;
}

export async function listFriends(playerId: string) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('friendships')
    .select('id,requester_id,recipient_id,requester_name,recipient_name,status,created_at,responded_at')
    .or(`requester_id.eq.${playerId},recipient_id.eq.${playerId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: number; requester_id: string; recipient_id: string; requester_name: string; recipient_name: string; status: string; created_at: string; responded_at: string | null }>;
  const ids = [...new Set(rows.flatMap((row) => [String(row.requester_id), String(row.recipient_id)]))];
  const profileMap = new Map<string, PublicFriendProfile>();
  if (ids.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from('player_profiles')
      .select('id,name,telegram_username,photo_url,rating,wins,races,current_car_name,last_seen')
      .in('id', ids);
    if (profilesError) throw profilesError;
    for (const profile of (profiles ?? []) as PublicFriendProfile[]) profileMap.set(String(profile.id), profile);
  }

  const now = Date.now();
  return rows.map((row) => {
    const requester = profileMap.get(String(row.requester_id)) ?? null;
    const recipient = profileMap.get(String(row.recipient_id)) ?? null;
    const other = String(row.requester_id) === playerId ? recipient : requester;
    const lastSeen = other?.last_seen ? new Date(other.last_seen).getTime() : 0;
    return {
      ...row,
      requester_profile: requester,
      recipient_profile: recipient,
      other_profile: other,
      other_online: Boolean(lastSeen && now - lastSeen < 5 * 60_000)
    };
  });
}
