import { marketActionSchema } from '@/features/market/schema';
import { applyMarketAction, getMarketListing, listActiveMarket, listPlayerMarket } from '@/features/market/server';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { requireSession } from '@/lib/security/session';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));
    const scope = url.searchParams.get('scope');
    if (Number.isInteger(id) && id > 0) {
      const session = await requireSession();
      await enforceRateLimit(session.playerId, 'market_read', 120, 60);
      return noStoreJson({ ok: true, data: await getMarketListing(id) });
    }
    if (scope === 'mine') {
      const session = await requireSession();
      await enforceRateLimit(session.playerId, 'market_read', 120, 60);
      return noStoreJson({ ok: true, data: await listPlayerMarket(session.playerId) });
    }
    return noStoreJson({ ok: true, data: await listActiveMarket() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'market_write', 30, 60);
    const body = marketActionSchema.parse(await request.json());
    const data = await applyMarketAction(session.playerId, body);
    return noStoreJson({ ok: true, data });
  } catch (error) {
    return apiError(error);
  }
}
