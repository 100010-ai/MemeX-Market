import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';

type ChatRow = {
  id: number;
  user_name: string;
  message: string;
  created_at: string;
  sender_uid: string;
};

export async function listChatMessages(limit = 50) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id,user_name,message,created_at,sender_uid')
    .order('id', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw error;

  const rows = (data ?? []) as ChatRow[];
  const uids = [...new Set(rows.map((row) => row.sender_uid).filter(Boolean))];
  const byUid = new Map<string, { id: string; telegram_username: string | null; photo_url: string | null }>();
  if (uids.length) {
    const { data: profiles, error: profileError } = await supabase
      .from('player_profiles')
      .select('id,owner_uid,telegram_username,photo_url')
      .in('owner_uid', uids);
    if (profileError) throw profileError;
    for (const profile of profiles ?? []) {
      if (profile.owner_uid) byUid.set(String(profile.owner_uid), {
        id: String(profile.id),
        telegram_username: profile.telegram_username ?? null,
        photo_url: profile.photo_url ?? null
      });
    }
  }

  return rows.reverse().map((row) => ({
    ...row,
    player_id: byUid.get(row.sender_uid)?.id ?? null,
    telegram_username: byUid.get(row.sender_uid)?.telegram_username ?? null,
    photo_url: byUid.get(row.sender_uid)?.photo_url ?? null
  }));
}

export async function sendChatMessage(playerId: string, text: string) {
  const supabase = createServerSupabase();
  const [{ data: profile, error: profileError }, { data: principal, error: principalError }] = await Promise.all([
    supabase.from('player_profiles').select('name,owner_uid,banned_at,telegram_username,photo_url').eq('id', playerId).maybeSingle(),
    supabase.from('telegram_principals').select('owner_uid').eq('player_id', playerId).maybeSingle()
  ]);
  if (profileError) throw profileError;
  if (principalError) throw principalError;
  if (!profile || profile.banned_at) throw new Error(profile?.banned_at ? 'BANNED' : 'profile missing');
  const ownerUid = profile.owner_uid ?? principal?.owner_uid;
  if (!ownerUid) throw new Error('profile principal missing');

  // Application limit plus the DB trigger gives us two independent anti-spam layers.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data: recent, error: recentError } = await supabase
    .from('chat_messages')
    .select('created_at')
    .eq('sender_uid', ownerUid)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(8);
  if (recentError) throw recentError;
  if ((recent?.length ?? 0) >= 8) throw new Error('chat rate limit');
  const latest = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0;
  if (latest && Date.now() - latest < 2500) throw new Error('chat cooldown');

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ sender_uid: ownerUid, user_name: profile.name, message: text })
    .select('id,user_name,message,created_at,sender_uid')
    .single();
  if (error) throw error;
  return {
    ...data,
    player_id: playerId,
    telegram_username: profile.telegram_username ?? null,
    photo_url: profile.photo_url ?? null
  };
}
