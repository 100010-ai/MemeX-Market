"use client";

import { useMemo, useState } from "react";
import type { PortfolioPoint } from "@/lib/types";
import { money } from "@/lib/format";

type RangeKey = "1d" | "7d" | "30d" | "all";
const ranges: Array<{ key: RangeKey; label: string; ms: number | null }> = [
  { key: "1d", label: "Сегодня", ms: 86400_000 },
  { key: "7d", label: "7 дней", ms: 7 * 86400_000 },
  { key: "30d", label: "30 дней", ms: 30 * 86400_000 },
  { key: "all", label: "Всё", ms: null },
];

export function PortfolioChart({ points }: { points: PortfolioPoint[] }) {
  const [range, setRange] = useState<RangeKey>("30d");
  const visible = useMemo(() => {
    const selected = ranges.find((item) => item.key === range)!;
    if (selected.ms == null) return points;
    const newestTime = points.length ? new Date(points[points.length - 1].time).getTime() : 0;
    const cutoff = newestTime - selected.ms;
    const filtered = points.filter((point) => new Date(point.time).getTime() >= cutoff);
    return filtered.length >= 2 ? filtered : points.slice(-Math.min(points.length, 24));
  }, [points, range]);
  const values = visible.map((p) => p.netWorth).filter(Number.isFinite);
  if (values.length < 2) return <div className="grid h-28 place-items-center rounded-[16px] bg-[var(--panel-2)] text-[10px] text-[var(--muted)]">История накопится после использования приложения</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.000001, max - min);
  const coords = visible.map((p, i) => {
    const x = visible.length <= 1 ? 50 : (i / (visible.length - 1)) * 100;
    const y = 92 - ((p.netWorth - min) / span) * 76;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const latest = visible.at(-1)?.netWorth ?? 0;
  const first = visible[0]?.netWorth ?? latest;
  const delta = latest - first;
  return <div className="rounded-[16px] bg-[var(--panel-2)] p-3">
    <div className="mb-2 flex items-end justify-between gap-3"><div><p className="text-[9px] text-[var(--muted)]">История капитала</p><p className="mt-0.5 text-xs font-semibold">{money(latest)}</p></div><p className={`text-[10px] ${delta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{delta > 0 ? "+" : ""}{money(delta)}</p></div>
    <div className="mb-2 flex gap-1 overflow-x-auto">{ranges.map((item) => <button key={item.key} type="button" onClick={() => setRange(item.key)} className={`shrink-0 rounded-[12px] px-2.5 py-1.5 text-[9px] ${range === item.key ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{item.label}</button>)}</div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-24 w-full overflow-visible"><polyline fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" points={coords} className={delta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"} /></svg>
    <div className="mt-1 flex justify-between text-[8px] text-[var(--muted-2)]"><span>{new Date(visible[0].time).toLocaleDateString("ru-RU")}</span><span>{new Date(visible.at(-1)!.time).toLocaleDateString("ru-RU")}</span></div>
  </div>;
}
