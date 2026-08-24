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
  clientPromise = (async () => {
    try {
      const config = await loadRealtimeConfig();
      if (!config.enabled) {
        console.warn(`[MXM] Supabase Realtime отключён: ${config.reason}`);
        return null;
      }
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 10 } },
      });
    } catch (error) {
      // A transient config/network/chunk failure must not poison Realtime for
      // the entire lifetime of the Mini App. Let the next reconnect attempt
      // build a fresh client instead of reusing a permanently rejected promise.
      clientPromise = null;
      throw error;
    }
  })();
  return clientPromise;
}
