import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';

type Bucket = { hits: number; resetAt: number };
const emergencyBuckets = new Map<string, Bucket>();
let lastCleanup = 0;

function localFallback(subject: string, scope: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  if (now - lastCleanup > 60_000) {
    lastCleanup = now;
    for (const [key, bucket] of emergencyBuckets) if (bucket.resetAt <= now) emergencyBuckets.delete(key);
  }
  const key = `${subject}:${scope}`;
  const current = emergencyBuckets.get(key);
  if (!current || current.resetAt <= now) {
    emergencyBuckets.set(key, { hits: 1, resetAt: now + windowSeconds * 1000 });
    return;
  }
  current.hits += 1;
  if (current.hits > limit) throw new Error('rate limit exceeded');
}

function isActualLimit(error: unknown) {
  const e = error as { message?: string; details?: string; hint?: string } | null;
  const text = `${e?.message ?? ''} ${e?.details ?? ''} ${e?.hint ?? ''}`.toLowerCase();
  return text.includes('rate limit exceeded');
}

export async function enforceRateLimit(subject: string, scope: string, limit: number, windowSeconds: number) {
  const supabase = createServerSupabase();
  try {
    const { error } = await supabase.rpc('autosyndicate_rate_limit_v12_6', {
      p_subject: subject,
      p_scope: scope,
      p_limit: limit,
      p_window_seconds: windowSeconds
    });
    if (!error) return;
    if (isActualLimit(error)) throw new Error('rate limit exceeded');

    // A broken/missing DB limiter must not turn every feature into HTTP 400.
    // We fail over to a process-local limiter; the next migration restores the
    // persistent limiter automatically.
    console.warn('Persistent rate limiter unavailable; using emergency limiter', {
      code: error.code,
      message: error.message,
      scope
    });
    localFallback(subject, scope, limit, windowSeconds);
  } catch (error) {
    if (isActualLimit(error) || (error instanceof Error && error.message.includes('rate limit'))) throw error;
    console.warn('Persistent rate limiter failed; using emergency limiter', { scope, error });
    localFallback(subject, scope, limit, windowSeconds);
  }
}
