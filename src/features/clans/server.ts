import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { z } from 'zod';
import type { clanActionSchema } from './schema';

type ClanAction = z.infer<typeof clanActionSchema>;

export async function applyClanAction(playerId: string, body: ClanAction) {
  const supabase = createServerSupabase();
  let rpc = '';
  const args: Record<string, unknown> = { p_player_id: playerId };

  if (body.action === 'create') {
    rpc = 'autosyndicate_server_clan_create_v10';
    args.p_name = body.name;
  } else if (body.action === 'invite') {
    rpc = 'autosyndicate_server_clan_invite_v10';
    args.p_query = body.query;
  } else if (body.action === 'accept') {
    rpc = 'autosyndicate_server_clan_accept_v10';
    args.p_invite_id = body.inviteId;
  } else if (body.action === 'leave') {
    rpc = 'autosyndicate_server_clan_leave_v10';
  } else {
    rpc = 'autosyndicate_server_clan_kick_v10';
    args.p_member_uid = body.memberUid;
  }

  const { data, error } = await supabase.rpc(rpc, args);
  if (error) throw error;
  return data;
}

export async function getClanView(playerId: string) {
  const supabase = createServerSupabase();

  const [{ data: membership, error: membershipError }, { data: invites, error: invitesError }, { data: leaderboard, error: leaderboardError }] = await Promise.all([
    supabase
      .from('clan_members')
      .select('clan_id,role,clans(id,name,owner_uid,created_at)')
      .eq('player_id', playerId)
      .maybeSingle(),
    supabase
      .from('clan_invites')
      .select('id,clan_id,inviter_name,created_at,clans(name)')
      .eq('invitee_id', playerId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('clan_leaderboard')
      .select('*')
      .order('score', { ascending: false })
      .limit(100)
  ]);

  if (membershipError) throw membershipError;
  if (invitesError) throw invitesError;
  if (leaderboardError) throw leaderboardError;

  let members: unknown[] = [];
  let clanRank: unknown = null;
  if (membership?.clan_id) {
    const [{ data: memberRows, error: memberError }, { data: rankRow, error: rankError }] = await Promise.all([
      supabase
        .from('clan_members')
        .select('member_uid,player_id,player_name,role,joined_at,player_profiles(rating,wins,current_car_name)')
        .eq('clan_id', membership.clan_id)
        .order('joined_at', { ascending: true }),
      supabase
        .from('clan_leaderboard')
        .select('*')
        .eq('id', membership.clan_id)
        .maybeSingle()
    ]);
    if (memberError) throw memberError;
    if (rankError) throw rankError;
    members = memberRows ?? [];
    clanRank = rankRow ?? null;
  }

  return {
    membership: membership ?? null,
    invites: invites ?? [],
    members,
    clanRank,
    leaderboard: leaderboard ?? []
  };
}
