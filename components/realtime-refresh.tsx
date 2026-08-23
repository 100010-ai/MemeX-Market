"use client";

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type ChannelState = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | "CONNECTING";
const channelStates = new Map<string, ChannelState>();
const channelFallbacks = new Map<string, number>();
const channelLastEventAt = new Map<string, number>();

function pageHidden() {
  return document.visibilityState === "hidden";
}

export function getRealtimePerfSnapshot() {
  let subscribed = 0;
  let degraded = 0;
  let fallbackPolls = 0;
  for (const state of channelStates.values()) {
    if (state === "SUBSCRIBED") subscribed += 1;
    else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") degraded += 1;
  }
  for (const count of channelFallbacks.values()) fallbackPolls += count;
  const lastEventAt = Math.max(0, ...channelLastEventAt.values());
  return { channels: channelStates.size, subscribed, degraded, fallbackPolls, lastEventAt };
}

export function RealtimeRefresh({ channelName, tables, filters, onChange, debounceMs = 700 }: { channelName: string; tables: string[]; filters?: Record<string, string>; onChange: () => void; debounceMs?: number }) {
  const tableKey = tables.join("|");
  const filterKey = Object.entries(filters || {}).sort(([a], [b]) => a.localeCompare(b)).map(([table, filter]) => `${table}:${filter}`).join("|");
  const callbackRef = useRef(onChange);
  useEffect(() => { callbackRef.current = onChange; }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    let disconnect: (() => void) | null = null;
    let connecting = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let lastRun = 0;
    channelStates.set(channelName, "CONNECTING");

    const scheduleRefresh = () => {
      if (cancelled || pageHidden()) return;
      channelLastEventAt.set(channelName, Date.now());
      const wait = Math.max(0, Math.max(100, debounceMs) - (Date.now() - lastRun));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const run = () => {
          if (cancelled || pageHidden()) return;
          lastRun = Date.now();
          callbackRef.current();
        };
        if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 650 });
        else run();
      }, wait);
    };

    const tableList = tableKey.split("|").filter(Boolean);

    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    const startFallback = () => {
      if (fallbackTimer || cancelled) return;
      fallbackTimer = setInterval(() => {
        if (cancelled || pageHidden()) return;
        channelFallbacks.set(channelName, (channelFallbacks.get(channelName) || 0) + 1);
        scheduleRefresh();
      }, 15_000);
    };

    const connect = async () => {
      if (cancelled || connecting || disconnect || pageHidden()) return;
      connecting = true;
      channelStates.set(channelName, "CONNECTING");
      try {
        const supabase = await getSupabaseBrowser();
        if (cancelled || pageHidden() || !supabase) return;
        const channel = supabase.channel(channelName);
        for (const table of tableList) {
          const filter = filters?.[table];
          const config = filter
            ? { event: "*" as const, schema: "public", table, filter }
            : { event: "*" as const, schema: "public", table };
          channel.on("postgres_changes", config, scheduleRefresh);
        }
        channel.subscribe((status) => {
          if (cancelled) return;
          const normalized = status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
            ? status
            : "CONNECTING";
          channelStates.set(channelName, normalized);
          if (status === "SUBSCRIBED") stopFallback();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error(`[MXM] Realtime ${channelName}: ${status}; включён fallback polling`);
            startFallback();
          }
        });
        disconnect = () => {
          disconnect = null;
          void supabase.removeChannel(channel);
        };
      } catch (error) {
        channelStates.set(channelName, "CHANNEL_ERROR");
        startFallback();
        console.error("[MXM] Ошибка запуска Realtime", error);
      } finally {
        connecting = false;
      }
    };

    const onVisibility = () => {
      if (pageHidden()) {
        if (timer) { clearTimeout(timer); timer = null; }
        disconnect?.();
        stopFallback();
        channelStates.set(channelName, "CLOSED");
        return;
      }
      void connect();
      // Reconcile data once after returning from the background; changes may
      // have happened while the websocket was intentionally disconnected.
      scheduleRefresh();
    };

    document.addEventListener("visibilitychange", onVisibility, { passive: true });
    let startupTimer = 0;
    let startupIdle: number | null = null;
    const startRealtime = () => { if (!cancelled) void connect(); };
    if (typeof window.requestIdleCallback === "function") startupIdle = window.requestIdleCallback(startRealtime, { timeout: 1_200 });
    else startupTimer = window.setTimeout(startRealtime, 500);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      channelStates.delete(channelName);
      channelFallbacks.delete(channelName);
      channelLastEventAt.delete(channelName);
      if (timer) clearTimeout(timer);
      stopFallback();
      if (startupTimer) window.clearTimeout(startupTimer);
      if (startupIdle != null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(startupIdle);
      disconnect?.();
    };
  }, [channelName, tableKey, filterKey, debounceMs]);

  return null;
}
