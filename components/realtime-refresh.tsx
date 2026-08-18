"use client";

import { useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export function RealtimeRefresh({ channelName, tables, onChange }: { channelName: string; tables: string[]; onChange: () => void }) {
  const tableKey = tables.join("|");

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void getSupabaseBrowser()
      .then((supabase) => {
        if (cancelled || !supabase) return;
        const channel = supabase.channel(channelName);
        for (const table of tables) {
          channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
        }
        channel.subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error(`[MXM] Realtime ${channelName}: ${status}`);
          }
        });
        cleanup = () => { void supabase.removeChannel(channel); };
      })
      .catch((error) => console.error("[MXM] Ошибка запуска Realtime", error));

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [channelName, onChange, tableKey]);

  return null;
}
