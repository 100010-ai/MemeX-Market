"use client";

import { useEffect, useMemo, useRef } from "react";
import { AreaSeries, ColorType, HistogramSeries, LineSeries, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";

export type AdminChartSeries = {
  key: string;
  label: string;
  color: string;
  kind?: "area" | "line" | "histogram";
  values: Array<{ date: string; value: number }>;
};

function chartTime(date: string) {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000) as UTCTimestamp;
}

function compact(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function AdminTrendChart({ series, height = 260 }: { series: AdminChartSeries[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const hasData = useMemo(() => series.some((item) => item.values.some((point) => Number(point.value) !== 0)), [series]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasData) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#69717b",
        fontFamily: "var(--font-geist-sans), Inter, sans-serif",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,.028)" },
        horzLines: { color: "rgba(255,255,255,.04)" },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: false, rightOffset: 0.3, barSpacing: 12, minBarSpacing: 4 },
      crosshair: {
        vertLine: { color: "rgba(166,181,255,.28)", labelBackgroundColor: "#20252b" },
        horzLine: { color: "rgba(166,181,255,.16)", labelBackgroundColor: "#20252b" },
      },
      localization: { priceFormatter: compact },
    });
    chartRef.current = chart;

    for (const item of series) {
      const points = item.values.map((point) => ({ time: chartTime(point.date), value: Number(point.value) || 0 }));
      if (item.kind === "histogram") {
        chart.addSeries(HistogramSeries, { color: item.color, priceLineVisible: false, lastValueVisible: false }).setData(points);
      } else if (item.kind === "line") {
        chart.addSeries(LineSeries, { color: item.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }).setData(points);
      } else {
        chart.addSeries(AreaSeries, { lineColor: item.color, topColor: `${item.color}32`, bottomColor: `${item.color}02`, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }).setData(points);
      }
    }
    chart.timeScale().fitContent();

    const resize = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width || container.clientWidth);
      if (width > 0) chart.applyOptions({ width });
    });
    resize.observe(container);
    return () => {
      resize.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [hasData, height, series]);

  if (!hasData) return <div className="admin-chart-empty" style={{ height }}>Данные за выбранный период появятся после первых активных сессий.</div>;
  return <div ref={containerRef} className="admin-chart-canvas" style={{ height }} aria-label="График продуктовой аналитики" />;
}
