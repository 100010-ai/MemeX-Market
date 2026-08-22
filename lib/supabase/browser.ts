"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

type RealtimeConfig = { enabled: true; url: string; key: string } | { enabled: false; reason: string };

let clientPromise: Promise<SupabaseClient | null> | null = null;

async function loadRealtimeConfig(): Promise<RealtimeConfig> {
  const response = await fetch("/api/realtime/config", { cache: "no-store", credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Не удалось получить конфигурацию Realtime (${response.status})`);
  return payload as RealtimeConfig;
}

export function getSupabaseBrowser(): Promise<SupabaseClient | null> {
  if (clientPromise) return clientPromise;
  clientPromise = loadRealtimeConfig().then((config) => {
    if (!config.enabled) {
      console.warn(`[MXM] Supabase Realtime отключён: ${config.reason}`);
      return null;
    }
    return import("@supabase/supabase-js").then(({ createClient }) => createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 10 } },
    }));
  });
  return clientPromise;
}
