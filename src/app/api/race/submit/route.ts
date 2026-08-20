import { raceSubmissionSchema } from '@/features/race/schema';
import { submitRace } from '@/features/race/server';
import { requireSession } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'race_submit', 30, 60);
    const race = raceSubmissionSchema.parse(await request.json());
    return noStoreJson({ ok: true, ...await submitRace(session.playerId, race) });
  } catch (error) { return apiError(error); }
}
