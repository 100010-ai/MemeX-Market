"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Maximize2, RotateCcw, X } from "lucide-react";
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
  if (value !== 0 && Math.abs(value) < 0.0001) return value.toExponential(3).replace("e+", "e");
  return value.toLocaleString("ru-RU", { maximumFractionDigits: Math.min(8, precision), minimumFractionDigits: Math.min(2, precision) });
}

function axisPrice(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 0.0001) return value.toExponential(3).replace("e+", "e");
  if (Math.abs(value) < 1) return value.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
}

function eventTimestamp(time: Time | undefined) {
  if (typeof time === "number") return time;
  if (!time) return null;
  if (typeof time === "string") {
    const parsed = Date.parse(`${time}T00:00:00Z`);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
}

export function CoinChart({ candles, height = 330, showTimeframes = true, baseFrame = "15m", compact = false, emptyLabel = "Недостаточно сделок для свечного графика." }: { candles: Candle[]; height?: number; showTimeframes?: boolean; baseFrame?: Frame["key"]; compact?: boolean; emptyLabel?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const byTimeRef = useRef<Map<number, Candle>>(new Map());
  const [frame, setFrame] = useState<Frame>(() => timeframes.find((item) => item.key === baseFrame) ?? timeframes[2]);
  const [inspect, setInspect] = useState<InspectCandle>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => typeof window === "undefined" ? 800 : window.innerHeight);
  const display = useMemo(() => aggregate(candles, frame.seconds), [candles, frame.seconds]);
  const format = useMemo(() => precisionFor(display), [display]);
  const current = inspect || display.at(-1) || null;
  const delta = current && current.open > 0 ? ((current.close / current.open) - 1) * 100 : 0;
  const chartHeight = fullscreen ? Math.max(320, viewportHeight - (showTimeframes ? 148 : 112)) : height;
  const hasData = display.length > 0;

  useEffect(() => {
    byTimeRef.current = new Map(display.map((candle) => [Number(candle.time), candle]));
  }, [display]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onResize = () => setViewportHeight(window.innerHeight);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFullscreen(false); };
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasData) {
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
      return;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: chartHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#06080a" },
        textColor: "#747b85",
        attributionLogo: false,
        fontSize: 10,
      },
      localization: { priceFormatter: axisPrice },
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
      priceFormat: { type: "price", precision: 8, minMove: 0.00000001 },
    });
    priceSeriesRef.current = priceSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeriesRef.current = volumeSeries;
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      visible: false,
    });

    let crosshairRaf = 0;
    let pendingTimestamp: number | null = null;
    const crosshairHandler = (param: MouseEventParams<Time>) => {
      pendingTimestamp = eventTimestamp(param.time);
      if (crosshairRaf) return;
      crosshairRaf = window.requestAnimationFrame(() => {
        crosshairRaf = 0;
        const timestamp = pendingTimestamp;
        setInspect(timestamp != null && Number.isFinite(timestamp) ? byTimeRef.current.get(timestamp) || null : null);
      });
    };
    chart.subscribeCrosshairMove(crosshairHandler);

    let resizeRaf = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.floor(entry.contentRect.width));
      if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        chart.resize(width, chartHeight);
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (crosshairRaf) window.cancelAnimationFrame(crosshairRaf);
      if (resizeRaf) window.cancelAnimationFrame(resizeRaf);
      chart.unsubscribeCrosshairMove(crosshairHandler);
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [chartHeight, hasData]);

  useEffect(() => {
    const priceSeries = priceSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!priceSeries || !volumeSeries || !display.length) return;
    priceSeries.applyOptions({ priceFormat: { type: "price", precision: format.precision, minMove: format.minMove } });
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
    if (chartRef.current && display.length <= 2) chartRef.current.timeScale().fitContent();
  }, [display, format.minMove, format.precision]);

  function fit() {
    chartRef.current?.timeScale().fitContent();
  }

  const body = (
    <div className={fullscreen ? "flex h-full min-h-0 flex-col" : `min-w-0 ${compact ? "mxm-coin-chart-compact" : ""}`}>
      <div className={`${compact ? "mb-1" : "mb-2"} flex min-w-0 items-end justify-between gap-3`}>
        <div className="min-w-0">
          {current ? <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px]">
            <span className="font-semibold text-white">{displayPrice(current.close, format.precision)}</span>
            <span className={delta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)}%</span>
            {!compact ? <>
              <span className="text-[var(--muted)]">O {displayPrice(current.open, format.precision)}</span>
              <span className="text-[var(--muted)]">H {displayPrice(current.high, format.precision)}</span>
              <span className="text-[var(--muted)]">L {displayPrice(current.low, format.precision)}</span>
              <span className="text-[var(--muted)]">V {compactNumber(current.volume)} TON</span>
            </> : current.volume > 0 ? <span className="text-[var(--muted)]">V {compactNumber(current.volume)} TON</span> : null}
          </div> : <p className="text-[10px] text-[var(--muted)]">История цены</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {display.length ? <button type="button" onClick={fit} aria-label="Вместить график" className="inline-flex items-center gap-1 py-1 text-[10px] text-[var(--muted)] transition hover:text-white" title="Вместить данные"><RotateCcw size={12} />{compact ? null : "Сброс"}</button> : null}
          <button type="button" onClick={() => setFullscreen((value) => !value)} aria-label={fullscreen ? "Закрыть полный экран" : "Открыть график на весь экран"} className="inline-flex items-center gap-1 py-1 text-[10px] text-[var(--muted)] transition hover:text-white" title={fullscreen ? "Закрыть полный экран" : "Открыть на весь экран"}>{fullscreen ? <X size={13} /> : <Maximize2 size={12} />}{compact && !fullscreen ? null : fullscreen ? "Закрыть" : "На весь экран"}</button>
        </div>
      </div>

      {showTimeframes ? <div className={`mxm-hscroll ${compact ? "mb-1 gap-3" : "mb-2 gap-4 border-b border-[var(--border-soft)]"} pb-1`}>
        {timeframes.map((item) => <button key={item.key} type="button" onClick={() => { setFrame(item); setInspect(null); }} className={`relative shrink-0 py-1.5 text-[10px] transition ${frame.key === item.key ? "text-white" : "text-[var(--muted)] hover:text-white"}`}>{item.key}{frame.key === item.key ? <span className="absolute inset-x-0 -bottom-[5px] h-px bg-[var(--accent)]" /> : null}</button>)}
      </div> : null}

      {display.length ? <div ref={containerRef} className="w-full min-h-0 flex-1 overflow-hidden" style={{ minHeight: chartHeight }} /> : <div style={{ height: chartHeight }} className="grid place-items-center rounded-[12px] bg-white/[.012] text-[9px] text-[var(--muted)]">{emptyLabel}</div>}
    </div>
  );

  if (fullscreen) {
    return <div className="fixed inset-0 z-[120] bg-[#06080a] px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-[max(10px,env(safe-area-inset-top))] md:px-5">{body}</div>;
  }
  return body;
}
