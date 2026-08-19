"use client";

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export function RealtimeRefresh({ channelName, tables, onChange, debounceMs = 350 }: { channelName: string; tables: string[]; onChange: () => void; debounceMs?: number }) {
  const tableKey = tables.join("|");
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRun = 0;

    const scheduleRefresh = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const wait = Math.max(0, Math.max(100, debounceMs) - (Date.now() - lastRun));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        lastRun = Date.now();
        callbackRef.current();
      }, wait);
    };

    const tableList = tableKey.split("|").filter(Boolean);

    void getSupabaseBrowser()
      .then((supabase) => {
        if (cancelled || !supabase) return;
        const channel = supabase.channel(channelName);
        for (const table of tableList) channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh);
        channel.subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.error(`[MXM] Realtime ${channelName}: ${status}`);
        });
        cleanup = () => { void supabase.removeChannel(channel); };
      })
      .catch((error) => console.error("[MXM] Ошибка запуска Realtime", error));

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cleanup?.();
    };
  }, [channelName, tableKey, debounceMs]);

  return null;
}
