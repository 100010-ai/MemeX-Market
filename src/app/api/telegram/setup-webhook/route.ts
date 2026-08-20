import { assertSameOrigin, apiError, noStoreJson } from '@/lib/security/http';
import { requireAdmin } from '@/features/admin/auth';
import { setTelegramWebhook } from '@/features/bot/telegram';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin();
    const result = await setTelegramWebhook();
    return noStoreJson({ ok: true, result });
  } catch (error) { return apiError(error); }
}
