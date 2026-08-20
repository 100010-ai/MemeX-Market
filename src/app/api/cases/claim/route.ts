import { claimCaseSchema } from '@/features/cases/schema';
import { claimCase } from '@/features/cases/server';
import { requireSession } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'case_claim', 30, 60);
    const body = claimCaseSchema.parse(await request.json());
    return noStoreJson({ ok: true, claimed: await claimCase(session.playerId, body.rollId) });
  } catch (error) { return apiError(error); }
}
