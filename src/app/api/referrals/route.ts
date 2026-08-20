import { z } from 'zod';
import { bindReferral, claimFirstRaceBonus, claimReferralRewards, getReferralDashboard } from '@/features/social/referrals';
import { requireSession } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bind'), code: z.string().trim().min(4).max(20) }),
  z.object({ action: z.literal('claim') }),
  z.object({ action: z.literal('firstRace') })
]);

export async function GET() {
  try {
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'referral_read', 30, 60);
    return noStoreJson({ ok: true, data: await getReferralDashboard(session.playerId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'referral_write', 12, 60);
    const body = actionSchema.parse(await request.json());
    if (body.action === 'bind') return noStoreJson({ ok: true, data: await bindReferral(session.playerId, body.code.toUpperCase()) });
    if (body.action === 'firstRace') return noStoreJson({ ok: true, amount: await claimFirstRaceBonus(session.playerId) });
    return noStoreJson({ ok: true, amount: await claimReferralRewards(session.playerId) });
  } catch (error) {
    return apiError(error);
  }
}
