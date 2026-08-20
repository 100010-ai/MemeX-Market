import { requireSession } from '@/lib/security/session';
import { apiError, noStoreJson } from '@/lib/security/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await requireSession();
    return noStoreJson({
      authenticated: true,
      session: {
        playerId: session.playerId,
        telegramId: session.telegramId,
        username: session.username,
        name: session.name
      }
    });
  } catch (error) {
    return apiError(error, 500);
  }
}
