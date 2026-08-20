import { profileSyncSchema } from '@/features/profile/schema';
import { syncProfile } from '@/features/profile/server';
import { requireSession } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'profile_sync', 20, 60);
    const body = profileSyncSchema.parse(await request.json());
    await syncProfile(session.playerId, session.username, body);
    return noStoreJson({ ok: true });
  } catch (error) { return apiError(error); }
}
