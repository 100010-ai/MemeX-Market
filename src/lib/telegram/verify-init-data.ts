import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1).max(64),
  last_name: z.string().max(64).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional(),
  photo_url: z.string().url().optional()
});

export type VerifiedTelegramUser = z.infer<typeof telegramUserSchema>;

export function verifyTelegramInitData(initData: string, botToken: string, maxAgeSeconds: number): VerifiedTelegramUser {
  const cleanToken = botToken.trim();
  if (!cleanToken) throw new Error('telegram bot token missing');
  if (!initData || initData.length > 16_000) throw new Error('telegram initData missing');
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) throw new Error('telegram hash missing');
  params.delete('hash');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate)) throw new Error('telegram auth_date invalid');
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 30 || now - authDate > maxAgeSeconds) throw new Error('telegram initData expired');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(cleanToken).digest();
  const calculated = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(calculated, 'hex');
  const b = Buffer.from(receivedHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('telegram signature invalid');

  const rawUser = params.get('user');
  if (!rawUser) throw new Error('telegram user missing');
  return telegramUserSchema.parse(JSON.parse(rawUser));
}
