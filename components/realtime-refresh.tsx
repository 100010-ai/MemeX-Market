"use client";

import { useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export function RealtimeRefresh({ channelName, tables, onChange }: { channelName: string; tables: string[]; onChange: () => void }) {
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const channel = supabase.channel(channelName);
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
    }
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error(`Realtime channel ${channelName} failed with ${status}`);
      }
    });
    return () => { void supabase.removeChannel(channel); };
  }, [channelName, onChange, tables]);
  return null;
}
