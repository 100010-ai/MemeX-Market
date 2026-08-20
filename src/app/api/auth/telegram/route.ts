import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerEnv } from '@/lib/env';
import { verifyTelegramInitData } from '@/lib/telegram/verify-init-data';
import { ensureTelegramPrincipal } from '@/features/auth/principal';
import { encodeSession, SESSION_COOKIE } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { createServerSupabase } from '@/lib/supabase/server';
import { ensureTelegramWebhook } from '@/features/bot/telegram';

export const runtime = 'nodejs';
const bodySchema = z.object({ initData: z.string().min(1).max(16_000) });

export async function POST(request: NextRequest) {
  let initData = '';
  try {
    assertSameOrigin(request);
    initData = bodySchema.parse(await request.json()).initData;
  } catch (error) {
    return apiError(error, 400);
  }

  let env;
  try {
    env = getServerEnv();
  } catch (error) {
    console.error('AutoSyndicate server environment is incomplete', error);
    return noStoreJson({ ok: false, error: 'server configuration incomplete', code: 'SERVER_CONFIG_INVALID' }, 503);
  }

  let user;
  try {
    user = verifyTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_AUTH_MAX_AGE_SECONDS);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'telegram auth rejected';
    return noStoreJson({ ok: false, error: message, code: 'TELEGRAM_AUTH_INVALID' }, 401);
  }

  try {
    await enforceRateLimit(`tg_${user.id}`, 'auth', 10, 60);
    const principal = await ensureTelegramPrincipal(user);
    const { data: profile, error: profileError } = await createServerSupabase()
      .from('player_profiles')
      .select('banned_at')
      .eq('id', principal.playerId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (profile?.banned_at) throw new Error('BANNED');

    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
    const token = encodeSession({
      playerId: principal.playerId,
      telegramId: user.id,
      username: user.username ?? null,
      name: user.first_name,
      exp
    });

    // Keep the Bot API webhook self-healing whenever a real Mini App session is verified.
    // Failure here must never block game authentication.
    try { await ensureTelegramWebhook(false); } catch (error) { console.warn('Telegram webhook ensure failed', error); }

    const response = NextResponse.json({
      ok: true,
      playerId: principal.playerId,
      tokenHash: principal.tokenHash,
      user: { name: user.first_name, username: user.username ?? null }
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      priority: 'high',
      path: '/',
      maxAge: 60 * 60 * 24 * 7
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('Telegram principal bootstrap failed', error);
    return apiError(error, 500);
  }
}
