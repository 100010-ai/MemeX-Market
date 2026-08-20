import { requireSession } from '@/lib/security/session';
import { apiError, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { findPlayer, listPlayers } from '@/features/profile/directory';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'profiles_read', 90, 60);
    const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    return noStoreJson(q ? { ok: true, player: await findPlayer(q) } : { ok: true, players: await listPlayers() });
  } catch (error) {
    return apiError(error);
  }
}
