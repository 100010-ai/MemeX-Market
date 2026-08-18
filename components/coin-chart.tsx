"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/types";

const timeframes = [
  { key: "5m", seconds: 300 },
  { key: "15m", seconds: 900 },
  { key: "1h", seconds: 3600 },
  { key: "4h", seconds: 14400 },
  { key: "1d", seconds: 86400 },
] as const;

function aggregate(candles: Candle[], seconds: number) {
  const buckets = new Map<number, Candle>();
  for (const candle of candles) {
    const time = Math.floor(candle.time / seconds) * seconds;
    const previous = buckets.get(time);
    if (!previous) buckets.set(time, { ...candle, time });
    else buckets.set(time, { time, open: previous.open, high: Math.max(previous.high, candle.high), low: Math.min(previous.low, candle.low), close: candle.close, volume: previous.volume + candle.volume });
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function CoinChart({ candles, height = 330, showTimeframes = true, baseFrame = "15m" }: { candles: Candle[]; height?: number; showTimeframes?: boolean; baseFrame?: (typeof timeframes)[number]["key"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<(typeof timeframes)[number]>(() => timeframes.find((item) => item.key === baseFrame) ?? timeframes[1]);
  const display = useMemo(() => aggregate(candles, frame.seconds), [candles, frame]);

  useEffect(() => {
    if (!ref.current || !display.length) return;
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: "#191a1c" }, textColor: "#858a92", attributionLogo: false },
      grid: { vertLines: { color: "#222428" }, horzLines: { color: "#222428" } },
      rightPriceScale: { borderColor: "#303238" },
      timeScale: { borderColor: "#303238", timeVisible: true, secondsVisible: false, rightOffset: 3 },
      crosshair: { vertLine: { color: "#666b73", style: 2 }, horzLine: { color: "#666b73", style: 2 } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#25cb81", downColor: "#ff5b68", borderVisible: false, wickUpColor: "#25cb81", wickDownColor: "#ff5b68",
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 },
    });
    series.setData(display.map((candle) => ({ time: candle.time as UTCTimestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width }));
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [display, height]);

  return (
    <div>
      {showTimeframes ? <div className="mb-2 flex gap-1">{timeframes.map((item) => <button key={item.key} onClick={() => setFrame(item)} className={`rounded-xl px-2.5 py-1.5 text-[11px] ${frame.key === item.key ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)] hover:text-white"}`}>{item.key}</button>)}</div> : null}
      {display.length ? <div ref={ref} className="w-full" /> : <div style={{ height }} className="grid place-items-center rounded-2xl border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">На этом рынке пока нет сделок.</div>}
    </div>
  );
}
