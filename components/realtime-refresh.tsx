"use client";

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type ChannelState = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | "CONNECTING";
const channelStates = new Map<string, ChannelState>();

export function getRealtimePerfSnapshot() {
  let subscribed = 0;
  let degraded = 0;
  for (const state of channelStates.values()) {
    if (state === "SUBSCRIBED") subscribed += 1;
    else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") degraded += 1;
  }
  return { channels: channelStates.size, subscribed, degraded };
}

export function RealtimeRefresh({ channelName, tables, onChange, debounceMs = 350 }: { channelName: string; tables: string[]; onChange: () => void; debounceMs?: number }) {
  const tableKey = tables.join("|");
  const callbackRef = useRef(onChange);
  useEffect(() => { callbackRef.current = onChange; }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRun = 0;
    channelStates.set(channelName, "CONNECTING");

    const scheduleRefresh = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const wait = Math.max(0, Math.max(100, debounceMs) - (Date.now() - lastRun));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const run = () => {
          if (cancelled || document.visibilityState === "hidden") return;
          lastRun = Date.now();
          callbackRef.current();
        };
        if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 650 });
        else run();
      }, wait);
    };

    const tableList = tableKey.split("|").filter(Boolean);

    void getSupabaseBrowser()
      .then((supabase) => {
        if (cancelled || !supabase) return;
        const channel = supabase.channel(channelName);
        for (const table of tableList) channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh);
        channel.subscribe((status) => {
          const normalized = status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
            ? status
            : "CONNECTING";
          channelStates.set(channelName, normalized);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.error(`[MXM] Realtime ${channelName}: ${status}`);
        });
        cleanup = () => { void supabase.removeChannel(channel); };
      })
      .catch((error) => {
        channelStates.set(channelName, "CHANNEL_ERROR");
        console.error("[MXM] Ошибка запуска Realtime", error);
      });

    return () => {
      cancelled = true;
      channelStates.delete(channelName);
      if (timer) clearTimeout(timer);
      cleanup?.();
    };
  }, [channelName, tableKey, debounceMs]);

  return null;
}
