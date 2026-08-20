import { listPendingCaseRolls } from '@/features/cases/pending';
import { requireSession } from '@/lib/security/session';
import { apiError, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export async function GET() {
  try {
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'case_pending', 30, 60);
    return noStoreJson({ ok: true, data: await listPendingCaseRolls(session.playerId) });
  } catch (error) {
    return apiError(error);
  }
}
