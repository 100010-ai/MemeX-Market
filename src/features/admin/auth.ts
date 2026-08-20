import 'server-only';
import { getAdminTelegramIds } from '@/lib/env';
import { requireSession, type GameSession } from '@/lib/security/session';

export async function requireAdmin(): Promise<GameSession> {
  const session = await requireSession();
  if (!getAdminTelegramIds().has(String(session.telegramId))) throw new Error('FORBIDDEN');
  return session;
}

export function isAdminTelegramId(id: number) {
  return getAdminTelegramIds().has(String(id));
}
