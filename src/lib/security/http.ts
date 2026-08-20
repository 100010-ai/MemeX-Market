import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

type ErrorLike = {
  name?: string;
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) throw new Error('invalid host');
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { throw new Error('invalid origin'); }
  if (originHost !== host) throw new Error('origin rejected');
}

function classifyInfrastructureError(error: unknown) {
  const e = (error ?? {}) as ErrorLike;
  const message = String(e.message ?? 'request failed');
  const code = String(e.code ?? '');
  const context = `${message} ${e.details ?? ''} ${e.hint ?? ''}`.toLowerCase();

  const migrationCodes = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);
  const migrationText =
    (context.includes('relation') && context.includes('does not exist')) ||
    context.includes('could not find the table') ||
    context.includes('could not find the function') ||
    context.includes('schema cache') ||
    context.includes('telegram_principals') ||
    context.includes('game_settings_v11');

  if (migrationCodes.has(code) || migrationText) {
    return { status: 503, code: 'DATABASE_MIGRATION_REQUIRED', error: 'online services are being updated' };
  }

  // PostgREST/Postgres failures are infrastructure failures unless explicitly
  // converted to a domain error by the route. Returning 400 caused the client
  // to treat a broken database as bad user input and then spam retries.
  if (/^(PGRST|[0-9A-Z]{5})/.test(code) || e.name === 'PostgrestError') {
    return { status: 503, code: 'DATABASE_UNAVAILABLE', error: 'online services temporarily unavailable' };
  }

  if (message === 'SERVER_CONFIG_INVALID') {
    return { status: 503, code: 'SERVER_CONFIG_INVALID', error: 'server configuration incomplete' };
  }

  return null;
}

export function apiError(error: unknown, status = 400) {
  if (error instanceof ZodError) {
    console.warn('AutoSyndicate request validation failed', error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })));
    return NextResponse.json({ ok: false, error: 'invalid request', code: 'INVALID_REQUEST' }, {
      status: 422,
      headers: { 'Cache-Control': 'no-store' }
    });
  }

  const infra = classifyInfrastructureError(error);
  if (infra) {
    console.error('AutoSyndicate infrastructure error', error);
    return NextResponse.json({ ok: false, error: infra.error, code: infra.code }, {
      status: infra.status,
      headers: { 'Cache-Control': 'no-store' }
    });
  }

  const message = error instanceof Error ? error.message : 'request failed';
  let code = 'REQUEST_FAILED';
  let safe = message.slice(0, 180);
  let resolvedStatus = status;

  if (message === 'UNAUTHORIZED') {
    code = 'UNAUTHORIZED'; safe = 'unauthorized'; resolvedStatus = 401;
  } else if (message === 'FORBIDDEN') {
    code = 'FORBIDDEN'; safe = 'forbidden'; resolvedStatus = 403;
  } else if (message === 'BANNED') {
    code = 'PLAYER_BANNED'; safe = 'player banned'; resolvedStatus = 403;
  } else if (message.includes('rate limit')) {
    code = 'RATE_LIMITED'; safe = 'rate limit exceeded'; resolvedStatus = 429;
  }

  if (resolvedStatus >= 500) console.error('AutoSyndicate API error', error);
  return NextResponse.json({ ok: false, error: safe, code }, {
    status: resolvedStatus,
    headers: { 'Cache-Control': 'no-store' }
  });
}

export function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
