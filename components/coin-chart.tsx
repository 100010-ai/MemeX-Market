"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { Maximize2 } from "lucide-react";
import type { Candle } from "@/lib/types";

const timeframes = [
  { key: "1m", seconds: 60 },
  { key: "5m", seconds: 300 },
  { key: "15m", seconds: 900 },
  { key: "1h", seconds: 3600 },
  { key: "4h", seconds: 14400 },
  { key: "1d", seconds: 86400 },
] as const;

type Frame = (typeof timeframes)[number];
type InspectCandle = Candle | null;

function aggregate(candles: Candle[], seconds: number) {
  const buckets = new Map<number, Candle>();
  for (const candle of candles) {
    const time = Math.floor(candle.time / seconds) * seconds;
    const previous = buckets.get(time);
    if (!previous) buckets.set(time, { ...candle, time });
    else buckets.set(time, {
      time,
      open: previous.open,
      high: Math.max(previous.high, candle.high),
      low: Math.min(previous.low, candle.low),
      close: candle.close,
      volume: previous.volume + candle.volume,
    });
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function precisionFor(candles: Candle[]) {
  const values = candles.flatMap((item) => [item.open, item.high, item.low, item.close]).filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return { precision: 6, minMove: 0.000001 };
  const min = Math.min(...values);
  const magnitude = Math.floor(Math.log10(min));
  const precision = Math.max(2, Math.min(12, magnitude < 0 ? Math.abs(magnitude) + 4 : 2));
  return { precision, minMove: 10 ** -precision };
}

function compactNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function displayPrice(value: number, precision: number) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("ru-RU", { maximumFractionDigits: precision, minimumFractionDigits: Math.min(2, precision) });
}

export function CoinChart({ candles, height = 330, showTimeframes = true, baseFrame = "15m" }: { candles: Candle[]; height?: number; showTimeframes?: boolean; baseFrame?: Frame["key"] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [frame, setFrame] = useState<Frame>(() => timeframes.find((item) => item.key === baseFrame) ?? timeframes[2]);
  const [inspect, setInspect] = useState<InspectCandle>(null);
  const display = useMemo(() => aggregate(candles, frame.seconds), [candles, frame.seconds]);
  const format = useMemo(() => precisionFor(display), [display]);
  const current = inspect || display.at(-1) || null;
  const delta = current && current.open > 0 ? ((current.close / current.open) - 1) * 100 : 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !display.length) {
      chartRef.current = null;
      return;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#06080a" },
        textColor: "#747b85",
        attributionLogo: false,
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,.028)" },
        horzLines: { color: "rgba(255,255,255,.035)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.24 },
        entireTextOnly: true,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 8,
        minBarSpacing: 3,
        fixLeftEdge: false,
      },
      crosshair: {
        vertLine: { color: "rgba(255,255,255,.22)", style: 2, width: 1, labelBackgroundColor: "#20252b" },
        horzLine: { color: "rgba(255,255,255,.18)", style: 2, width: 1, labelBackgroundColor: "#20252b" },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    chartRef.current = chart;

    const priceSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#28c989",
      downColor: "#f25f6d",
      borderVisible: false,
      wickUpColor: "#28c989",
      wickDownColor: "#f25f6d",
      priceLineColor: "rgba(198,170,88,.7)",
      priceLineWidth: 1,
      lastValueVisible: true,
      priceFormat: { type: "price", precision: format.precision, minMove: format.minMove },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      visible: false,
    });

    priceSeries.setData(display.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })));
    volumeSeries.setData(display.map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.volume,
      color: candle.close >= candle.open ? "rgba(40,201,137,.26)" : "rgba(242,95,109,.25)",
    })));

    const byTime = new Map(display.map((candle) => [Number(candle.time), candle]));
    let crosshairRaf = 0;
    let pendingTimestamp: number | null = null;
    const crosshairHandler = (param: any) => {
      pendingTimestamp = param.time == null ? null : (typeof param.time === "number" ? param.time : Number(param.time));
      if (crosshairRaf) return;
      crosshairRaf = window.requestAnimationFrame(() => {
        crosshairRaf = 0;
        const timestamp = pendingTimestamp;
        setInspect(timestamp != null && Number.isFinite(timestamp) ? byTime.get(timestamp) || null : null);
      });
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    chart.timeScale().fitContent();

    let resizeRaf = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.floor(entry.contentRect.width));
      if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        chart.resize(width, height);
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (crosshairRaf) window.cancelAnimationFrame(crosshairRaf);
      if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chartRef.current = null;
      chart.remove();
    };
  }, [display, format.minMove, format.precision, height]);

  function fit() {
    chartRef.current?.timeScale().fitContent();
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          {current ? <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px]">
            <span className="font-semibold text-white">{displayPrice(current.close, format.precision)}</span>
            <span className={delta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)}%</span>
            <span className="text-[var(--muted)]">O {displayPrice(current.open, format.precision)}</span>
            <span className="text-[var(--muted)]">H {displayPrice(current.high, format.precision)}</span>
            <span className="text-[var(--muted)]">L {displayPrice(current.low, format.precision)}</span>
            <span className="text-[var(--muted)]">V {compactNumber(current.volume)} TON</span>
          </div> : <p className="text-[10px] text-[var(--muted)]">История цены</p>}
        </div>
        {display.length ? <button type="button" onClick={fit} className="inline-flex shrink-0 items-center gap-1 py-1 text-[10px] text-[var(--muted)] transition hover:text-white" title="Показать весь график"><Maximize2 size={12} />Весь график</button> : null}
      </div>

      {showTimeframes ? <div className="mxm-hscroll mb-2 gap-4 border-b border-[var(--border-soft)] pb-1">
        {timeframes.map((item) => <button key={item.key} type="button" onClick={() => { setFrame(item); setInspect(null); }} className={`relative shrink-0 py-1.5 text-[10px] transition ${frame.key === item.key ? "text-white" : "text-[var(--muted)] hover:text-white"}`}>{item.key}{frame.key === item.key ? <span className="absolute inset-x-0 -bottom-[5px] h-px bg-[var(--accent)]" /> : null}</button>)}
      </div> : null}

      {display.length ? <div ref={containerRef} className="w-full overflow-hidden" style={{ minHeight: height }} /> : <div style={{ height }} className="grid place-items-center border-y border-[var(--border-soft)] text-xs text-[var(--muted)]">Недостаточно сделок для свечного графика.</div>}
    </div>
  );
}
