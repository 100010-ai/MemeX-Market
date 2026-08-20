import { caseRollRequestSchema } from '@/features/cases/schema';
import { rollCase } from '@/features/cases/server';
import { requireSession } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'case_roll', 12, 60);
    const body = caseRollRequestSchema.parse(await request.json());
    return noStoreJson({ ok: true, ...await rollCase(session.playerId, body) });
  } catch (error) { return apiError(error); }
}
