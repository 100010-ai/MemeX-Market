import { z } from 'zod';
import { listChatMessages, sendChatMessage } from '@/features/social/chat';
import { requireSession } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const bodySchema = z.object({ message: z.string().trim().min(1).max(300) });

export async function GET() {
  try {
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'chat_read', 90, 60);
    return noStoreJson({ ok: true, data: await listChatMessages(50) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'chat_write', 12, 60);
    const { message } = bodySchema.parse(await request.json());
    return noStoreJson({ ok: true, data: await sendChatMessage(session.playerId, message) });
  } catch (error) {
    return apiError(error);
  }
}
