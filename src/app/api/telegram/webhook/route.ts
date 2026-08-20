import { timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '@/lib/env';
import { handleTelegramUpdate } from '@/features/bot/handler';
import type { TgUpdate } from '@/features/bot/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export async function POST(request: Request) {
  const expected = getServerEnv().TELEGRAM_WEBHOOK_SECRET;
  const provided = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeEqual(provided, expected)) return new Response('forbidden', { status: 403 });
  let update: TgUpdate;
  try { update = await request.json() as TgUpdate; } catch { return new Response('bad request', { status: 400 }); }
  if (!Number.isInteger(update.update_id)) return new Response('bad update', { status: 400 });
  try {
    await handleTelegramUpdate(update);
    return new Response('ok', { status: 200 });
  } catch (error) {
    console.error('telegram webhook failed', error);
    return new Response('ok', { status: 200 });
  }
}
