"use client";

import { useId } from "react";

export type DonutItem = { name: string; value: number };
export type TrendPoint = { date: string; [key: string]: string | number };

const palette = ["#8ba4ff", "#59d5a1", "#f2b66d", "#ff7f89", "#a98df0", "#6db8d8", "#d1d5db", "#6b7280"];

function compact(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

export function DonutChart({ title, items, centerLabel }: { title: string; items: DonutItem[]; centerLabel?: string }) {
  const clean = items.filter((item) => Number(item.value) > 0);
  const total = clean.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <section className="rounded-[18px] border border-white/[.07] bg-[#0b0e12] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold text-white">{title}</h3>
        <span className="text-[10px] text-white/40">{compact(total)} всего</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-[132px_1fr] sm:items-center">
        <div className="relative mx-auto h-[132px] w-[132px]">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,.055)" strokeWidth="13" />
            {clean.map((item, index) => {
              const length = total ? (Number(item.value) / total) * circumference : 0;
              const dashOffset = -offset;
              offset += length;
              return <circle key={`${item.name}-${index}`} cx="60" cy="60" r={radius} fill="none" stroke={palette[index % palette.length]} strokeWidth="13" strokeLinecap="butt" strokeDasharray={`${length} ${Math.max(0, circumference - length)}`} strokeDashoffset={dashOffset} />;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div><div className="text-[18px] font-semibold tracking-[-.04em] text-white">{compact(total)}</div><div className="mt-0.5 text-[9px] text-white/35">{centerLabel || "объектов"}</div></div>
          </div>
        </div>
        <div className="space-y-2">
          {clean.slice(0, 8).map((item, index) => {
            const share = total ? (Number(item.value) / total) * 100 : 0;
            return <div key={`${item.name}-legend`} className="flex items-center gap-2 text-[10px]"><span className="h-2 w-2 rounded-[3px]" style={{ background: palette[index % palette.length] }} /><span className="min-w-0 flex-1 truncate text-white/55">{item.name}</span><span className="tabular-nums text-white/80">{compact(Number(item.value))}</span><span className="w-10 text-right tabular-nums text-white/30">{share.toFixed(0)}%</span></div>;
          })}
          {!clean.length ? <div className="text-[10px] text-white/35">Пока нет данных</div> : null}
        </div>
      </div>
    </section>
  );
}

export function TrendChart({
  title,
  points,
  series,
  height = 220,
}: {
  title: string;
  points: TrendPoint[];
  series: Array<{ key: string; label: string; color?: string }>;
  height?: number;
}) {
  const gradientId = useId().replace(/:/g, "");
  const width = 760;
  const padX = 20;
  const padY = 24;
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;
  const values = points.flatMap((point) => series.map((line) => Number(point[line.key] || 0))).filter(Number.isFinite);
  const max = Math.max(1, ...values);
  const x = (index: number) => padX + (points.length <= 1 ? usableW / 2 : (index / (points.length - 1)) * usableW);
  const y = (value: number) => padY + usableH - (Math.max(0, value) / max) * usableH;

  return (
    <section className="rounded-[18px] border border-white/[.07] bg-[#0b0e12] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold text-white">{title}</h3>
        <div className="flex flex-wrap items-center gap-3">{series.map((line, index) => <span key={line.key} className="inline-flex items-center gap-1.5 text-[9px] text-white/40"><span className="h-1.5 w-4 rounded-full" style={{ background: line.color || palette[index % palette.length] }} />{line.label}</span>)}</div>
      </div>
      <div className="overflow-hidden rounded-[14px] border border-white/[.04] bg-black/15">
        <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto min-h-[180px] w-full" preserveAspectRatio="none" role="img" aria-label={title}>
          <defs>
            <linearGradient id={`fade-${gradientId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8ba4ff" stopOpacity=".18" /><stop offset="100%" stopColor="#8ba4ff" stopOpacity="0" /></linearGradient>
          </defs>
          {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={padX} x2={width - padX} y1={padY + usableH * ratio} y2={padY + usableH * ratio} stroke="rgba(255,255,255,.045)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {series.map((line, lineIndex) => {
            const coords = points.map((point, index) => [x(index), y(Number(point[line.key] || 0))] as const);
            const polyline = coords.map(([px, py]) => `${px},${py}`).join(" ");
            const area = lineIndex === 0 && coords.length > 1 ? `M ${coords[0][0]} ${padY + usableH} L ${coords.map(([px, py]) => `${px} ${py}`).join(" L ")} L ${coords[coords.length - 1][0]} ${padY + usableH} Z` : null;
            return <g key={line.key}>{area ? <path d={area} fill={`url(#fade-${gradientId})`} /> : null}<polyline points={polyline} fill="none" stroke={line.color || palette[lineIndex % palette.length]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></g>;
          })}
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-[8px] text-white/25"><span>{points[0]?.date || ""}</span><span>{points.at(-1)?.date || ""}</span></div>
    </section>
  );
}
