"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/types";

const timeframes = [
  { key: "1m", seconds: 60 },
  { key: "5m", seconds: 300 },
  { key: "15m", seconds: 900 },
  { key: "1h", seconds: 3600 },
] as const;

function aggregate(candles: Candle[], seconds: number) {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const time = Math.floor(c.time / seconds) * seconds;
    const prev = buckets.get(time);
    if (!prev) buckets.set(time, { ...c, time });
    else buckets.set(time, { time, open: prev.open, high: Math.max(prev.high, c.high), low: Math.min(prev.low, c.low), close: c.close, volume: prev.volume + c.volume });
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function CoinChart({ candles, height = 330, showTimeframes = true }: { candles: Candle[]; height?: number; showTimeframes?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<(typeof timeframes)[number]>(timeframes[1]);
  const display = useMemo(() => aggregate(candles, frame.seconds), [candles, frame]);

  useEffect(() => {
    if (!ref.current || !display.length) return;
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: "#191a1c" }, textColor: "#838890", attributionLogo: false },
      grid: { vertLines: { color: "#222428" }, horzLines: { color: "#222428" } },
      rightPriceScale: { borderColor: "#2c2e32" },
      timeScale: { borderColor: "#2c2e32", timeVisible: true, secondsVisible: false, rightOffset: 3 },
      crosshair: { vertLine: { color: "#565b63", style: 2 }, horzLine: { color: "#565b63", style: 2 } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#28cf83", downColor: "#ff5b68", borderVisible: false, wickUpColor: "#28cf83", wickDownColor: "#ff5b68",
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 },
    });
    series.setData(display.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width }));
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [display, height]);

  return (
    <div>
      {showTimeframes ? <div className="mb-2 flex gap-1">{timeframes.map((t) => <button key={t.key} onClick={() => setFrame(t)} className={`rounded-md px-2.5 py-1.5 text-[11px] ${frame.key === t.key ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)] hover:text-white"}`}>{t.key}</button>)}</div> : null}
      {display.length ? <div ref={ref} className="w-full" /> : <div style={{ height }} className="grid place-items-center text-sm text-[var(--muted)]">No candle data yet.</div>}
    </div>
  );
}
