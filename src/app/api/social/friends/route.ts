import { friendshipActionSchema } from '@/features/social/schema';
import { applyFriendAction, listFriends } from '@/features/social/server';
import { requireSession } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'friends_write', 20, 60);
    const body = friendshipActionSchema.parse(await request.json());
    return noStoreJson({ ok: true, data: await applyFriendAction(session.playerId, body) });
  } catch (error) { return apiError(error); }
}
export async function GET() {
  try {
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'friends_read', 60, 60);
    return noStoreJson({ ok: true, data: await listFriends(session.playerId) });
  } catch (error) { return apiError(error); }
}
