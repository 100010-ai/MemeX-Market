"use client";

import { useEffect, useRef, useState } from "react";
import { getGiftMediaPerfSnapshot } from "@/components/gifts/gift-media";
import { getRealtimePerfSnapshot } from "@/components/realtime-refresh";
import { getApiPerfSnapshot } from "@/lib/api";

type Snapshot = {
  fps: number;
  dom: number;
  animationCandidates: number;
  animationPermits: number;
  animationLimit: number;
  lottieCacheEntries: number;
  motionPaused: boolean;
  memoryMb: number | null;
  apiInFlight: number;
  apiAverageMs: number;
  apiFailures: number;
  realtimeChannels: number;
  realtimeSubscribed: number;
  realtimeDegraded: number;
};

type PerformanceMemory = { usedJSHeapSize?: number };

function enabledFromLocation() {
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  const query = new URLSearchParams(window.location.search);
  if (query.get("perf") === "1") {
    localStorage.setItem("mxm-perf", "1");
    return true;
  }
  if (query.get("perf") === "0") {
    localStorage.removeItem("mxm-perf");
    return false;
  }
  return localStorage.getItem("mxm-perf") === "1";
}

export function PerfOverlay() {
  const [enabled] = useState(() => enabledFromLocation());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const frames = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const tick = (time: number) => {
      frames.current.push(time);
      while (frames.current.length && time - frames.current[0] > 1000) frames.current.shift();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const timer = window.setInterval(() => {
      const media = getGiftMediaPerfSnapshot();
      const api = getApiPerfSnapshot();
      const realtime = getRealtimePerfSnapshot();
      const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
      setSnapshot({
        fps: Math.max(0, frames.current.length - 1),
        dom: document.getElementsByTagName("*").length,
        ...media,
        memoryMb: memory?.usedJSHeapSize ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null,
        apiInFlight: api.inFlight,
        apiAverageMs: api.avgLatencyMs,
        apiFailures: api.failures,
        realtimeChannels: realtime.channels,
        realtimeSubscribed: realtime.subscribed,
        realtimeDegraded: realtime.degraded,
      });
    }, 650);
    return () => { cancelAnimationFrame(raf); window.clearInterval(timer); };
  }, [enabled]);

  if (!enabled || !snapshot) return null;
  return (
    <div className="pointer-events-none fixed right-2 top-[62px] z-[9999] min-w-[138px] rounded-xl border border-white/10 bg-black/85 px-2 py-1.5 font-mono text-[9px] leading-4 text-white/80 shadow-xl">
      <div>FPS <b className={snapshot.fps < 45 ? "text-[#ff8c95]" : "text-[#79dcb6]"}>{snapshot.fps}</b> · DOM {snapshot.dom}</div>
      <div>MEDIA {snapshot.animationPermits}/{snapshot.animationCandidates} · max {snapshot.animationLimit}</div>
      <div>LOT {snapshot.lottieCacheEntries} · {snapshot.motionPaused ? "paused" : "run"}</div>
      <div>API {snapshot.apiInFlight} live · {snapshot.apiAverageMs}ms · err {snapshot.apiFailures}</div>
      <div>WS {snapshot.realtimeSubscribed}/{snapshot.realtimeChannels}{snapshot.realtimeDegraded ? ` · bad ${snapshot.realtimeDegraded}` : ""}</div>
      {snapshot.memoryMb != null ? <div>HEAP {snapshot.memoryMb} MB</div> : null}
    </div>
  );
}
