'use client';

import { createBrowserSupabase } from '@/lib/supabase/client';

type ClientAuthIssue = {
  code: string;
  message: string;
  status?: number;
  at: number;
};

type SessionPayload = {
  authenticated?: boolean;
  session?: { playerId: string; username: string | null; name: string; telegramId?: number } | null;
  error?: string;
  code?: string;
};

type TelegramAuthPayload = {
  ok?: boolean;
  playerId?: string;
  tokenHash?: string;
  user?: { name?: string; username?: string | null };
  error?: string;
  code?: string;
};

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function setAuthIssue(code: string, message: string, status?: number) {
  window.__AUTOSYNDICATE_AUTH_ERROR__ = { code, message, status, at: Date.now() };
}

function clearAuthIssue() {
  window.__AUTOSYNDICATE_AUTH_ERROR__ = null;
}

async function timedFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function waitForTelegramInitData(timeoutMs = 6500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const webApp = window.Telegram?.WebApp;
    try {
      webApp?.ready?.();
      webApp?.expand?.();
    } catch {
      // Telegram SDK may still be attaching to the WebView.
    }
    const value = webApp?.initData;
    if (typeof value === 'string' && value.length > 0) return value;
    await delay(100);
  }
  return '';
}

async function readServerSession(): Promise<SessionPayload['session']> {
  try {
    const response = await timedFetch('/api/session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
    const payload = (await response.json().catch(() => null)) as SessionPayload | null;
    if (!response.ok) {
      // 401 simply means there is no cookie yet. Infrastructure failures are actionable.
      if (response.status >= 500) {
        setAuthIssue(payload?.code || 'SERVER_SESSION_ERROR', payload?.error || 'server session unavailable', response.status);
      }
      return null;
    }
    return payload?.authenticated && payload.session ? payload.session : null;
  } catch (error) {
    setAuthIssue('SERVER_UNREACHABLE', error instanceof Error ? error.message : 'server unreachable');
    return null;
  }
}

async function establishBrowserSupabaseSession(tokenHash: string) {
  try {
    const supabase = createBrowserSupabase();
    const current = await supabase.auth.getSession();
    if (current.data.session?.user) {
      window.__AUTOSYNDICATE_SUPABASE_SESSION__ = true;
      return true;
    }
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw error;
    window.__AUTOSYNDICATE_SUPABASE_SESSION__ = true;
    return true;
  } catch (error) {
    // Realtime is optional. Server-backed gameplay remains available through the HttpOnly session.
    window.__AUTOSYNDICATE_SUPABASE_SESSION__ = false;
    console.warn('Optional browser Supabase session unavailable', error);
    return false;
  }
}

export async function bootstrapSecureSession() {
  window.__AUTOSYNDICATE_REAUTH__ = bootstrapSecureSession;
  window.__AUTOSYNDICATE_SUPABASE_SESSION__ = Boolean(window.__AUTOSYNDICATE_SUPABASE_SESSION__);

  // Keep a working session alive while re-auth is attempted. Do not blank the UI first.
  const existing = await readServerSession();
  if (existing) {
    window.__AUTOSYNDICATE_SERVER_SESSION__ = existing;
    window.__AUTOSYNDICATE_AUTHENTICATED__ = true;
    clearAuthIssue();
  } else {
    window.__AUTOSYNDICATE_AUTHENTICATED__ = false;
    window.__AUTOSYNDICATE_SERVER_SESSION__ = null;
  }

  const initData = await waitForTelegramInitData();
  if (!initData) {
    if (existing) return true;
    setAuthIssue('TELEGRAM_INITDATA_MISSING', 'Telegram initData is unavailable. Open the Mini App from the bot.');
    return false;
  }

  let response: Response;
  try {
    response = await timedFetch('/api/auth/telegram', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData })
    });
  } catch (error) {
    if (existing) return true;
    setAuthIssue('SERVER_UNREACHABLE', error instanceof Error ? error.message : 'authentication server unreachable');
    return false;
  }

  const payload = (await response.json().catch(() => null)) as TelegramAuthPayload | null;
  if (!response.ok) {
    if (payload?.code === 'PLAYER_BANNED' || payload?.error === 'player banned') throw new Error('PLAYER_BANNED');
    setAuthIssue(payload?.code || 'TELEGRAM_AUTH_REJECTED', payload?.error || `telegram auth rejected (${response.status})`, response.status);
    // A valid existing cookie still wins over a failed optional refresh.
    if (existing) return true;
    return false;
  }

  const refreshed = await readServerSession();
  if (!refreshed) {
    if (existing) return true;
    if (!window.__AUTOSYNDICATE_AUTH_ERROR__) setAuthIssue('SERVER_SESSION_MISSING', 'Server accepted Telegram auth but did not create a session.');
    return false;
  }

  window.__AUTOSYNDICATE_SERVER_SESSION__ = refreshed;
  window.__AUTOSYNDICATE_AUTHENTICATED__ = true;
  clearAuthIssue();

  if (payload?.tokenHash) await establishBrowserSupabaseSession(payload.tokenHash);
  return true;
}
