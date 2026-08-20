import { requireSession } from '@/lib/security/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { apiError, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await requireSession();
    await enforceRateLimit(session.playerId, 'sync_status', 30, 60);
    const supabase = createServerSupabase();
    const [{ data: settings, error: settingsError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from('game_settings_v11').select('key,value').in('key', ['server.schema_version', 'server.schema_patch', 'server.sync_mode']),
      supabase.from('player_profiles').select('id,last_seen,telegram_username').eq('id', session.playerId).single()
    ]);
    if (settingsError) throw settingsError;
    if (profileError) throw profileError;
    const map = Object.fromEntries((settings ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
    return noStoreJson({
      ok: true,
      serverTime: new Date().toISOString(),
      schemaVersion: Number(map['server.schema_version'] ?? 0),
      schemaPatch: String(map['server.schema_patch'] ?? ''),
      syncMode: String(map['server.sync_mode'] ?? ''),
      profile
    });
  } catch (error) {
    return apiError(error);
  }
}
