import { createClient } from "@supabase/supabase-js";

function supabaseServerConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, serverKey };
}

export function getSupabaseAdmin() {
  const { url, serverKey } = supabaseServerConfig();

  if (!url || !serverKey) {
    const missing = [
      !url ? "SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL)" : null,
      !serverKey ? "SUPABASE_SECRET_KEY (или SUPABASE_SERVICE_ROLE_KEY)" : null,
    ].filter(Boolean).join(", ");
    throw new Error(`Supabase server config не найден: ${missing}. Добавь значения в .env/.env.local и перезапусти pnpm run dev.`);
  }

  return createClient(url, serverKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getSupabaseAdminConfigStatus() {
  const { url, serverKey } = supabaseServerConfig();
  return { configured: Boolean(url && serverKey), hasUrl: Boolean(url), hasServerKey: Boolean(serverKey) };
}
