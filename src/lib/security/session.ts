import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getServerEnv } from '@/lib/env';
import { createServerSupabase } from '@/lib/supabase/server';

export const SESSION_COOKIE = 'autosyndicate_session';
const sessionSchema = z.object({
  playerId: z.string().regex(/^tg_[0-9]{1,24}$/),
  telegramId: z.number().int().positive(),
  username: z.string().max(64).nullable(),
  name: z.string().min(1).max(64),
  exp: z.number().int().positive()
});
export type GameSession = z.infer<typeof sessionSchema>;

type ValidationCache = { telegramId: number; checkedAt: number; banned: boolean };
const validationCache = new Map<string, ValidationCache>();
const VALIDATION_TTL_MS = 20_000;

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeSession(session: GameSession) {
  const secret = getServerEnv().SESSION_SECRET.trim();
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${signPayload(payload, secret)}`;
}

export function decodeSession(value: string | undefined | null): GameSession | null {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = signPayload(payload, getServerEnv().SESSION_SECRET.trim());
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = sessionSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return parsed.exp > Math.floor(Date.now() / 1000) ? parsed : null;
  } catch { return null; }
}

export async function getSession() {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

export function invalidateSessionValidation(playerId?: string) {
  if (playerId) validationCache.delete(playerId);
  else validationCache.clear();
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error('UNAUTHORIZED');

  const cached = validationCache.get(session.playerId);
  const now = Date.now();
  if (cached && cached.telegramId === session.telegramId && now - cached.checkedAt < VALIDATION_TTL_MS) {
    if (cached.banned) throw new Error('BANNED');
    return session;
  }

  const supabase = createServerSupabase();
  const [{ data: profile, error: profileError }, { data: principal, error: principalError }] = await Promise.all([
    supabase.from('player_profiles').select('owner_uid,banned_at').eq('id', session.playerId).maybeSingle(),
    supabase.from('telegram_principals').select('telegram_user_id,player_id,owner_uid').eq('telegram_user_id', session.telegramId).maybeSingle()
  ]);
  if (profileError) throw profileError;
  if (principalError) throw principalError;
  if (!profile || !principal || principal.player_id !== session.playerId || principal.owner_uid !== profile.owner_uid) {
    validationCache.delete(session.playerId);
    throw new Error('UNAUTHORIZED');
  }

  const banned = Boolean(profile.banned_at);
  validationCache.set(session.playerId, { telegramId: session.telegramId, checkedAt: now, banned });
  if (banned) throw new Error('BANNED');
  return session;
}
