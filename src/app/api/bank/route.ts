import { bankActionSchema } from '@/features/bank/schema';
import { applyBankAction, getBankHistory } from '@/features/bank/server';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { requireSession } from '@/lib/security/session';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'bank_read', 60, 60);
    return noStoreJson({ ok: true, data: await getBankHistory(session.playerId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'bank_write', 15, 60);
    const action = bankActionSchema.parse(await request.json());
    return noStoreJson({ ok: true, data: await applyBankAction(session.playerId, action) });
  } catch (error) {
    return apiError(error);
  }
}
