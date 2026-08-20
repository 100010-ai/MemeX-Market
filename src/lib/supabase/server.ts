import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';

let serverClient: SupabaseClient | null = null;

/**
 * One Supabase client per warm Vercel instance. Creating a new GoTrue/PostgREST
 * client for every tiny API request adds avoidable allocations and connection
 * setup work. The service key never leaves the server bundle.
 */
export function createServerSupabase() {
  if (serverClient) return serverClient;
  const env = getServerEnv();
  serverClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'autosyndicate-vercel-server-v12.6' } }
  });
  return serverClient;
}
