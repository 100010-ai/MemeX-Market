"use client";

import { useEffect, useState } from "react";
import { Activity, BarChart3, Gem, Gauge, Layers3, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { MXMScore, MXMScoreComponentKey } from "@/lib/mxm-score";

const componentMeta: Record<MXMScoreComponentKey, { label: string; icon: typeof Gem }> = {
  rarity: { label: "Редкость", icon: Gem },
  liquidity: { label: "Ликвидность", icon: Activity },
  demand: { label: "Спрос", icon: BarChart3 },
  momentum: { label: "Импульс", icon: TrendingUp },
  scarcity: { label: "Дефицит", icon: Layers3 },
};

export function MXMScoreCard({ giftId }: { giftId: string }) {
  const [score, setScore] = useState<MXMScore | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ score: MXMScore }>(`/api/gifts/${encodeURIComponent(giftId)}/score`, { cacheMs: 20_000, signal: controller.signal })
      .then((result) => setScore(result.score)).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [giftId]);
  if (error) return null;
  if (!score) return <div className="mb-3 mxm-skeleton h-24 rounded-[18px]" />;
  return <section className="mb-3 rounded-[20px] border border-[rgba(139,164,255,.16)] bg-[linear-gradient(145deg,rgba(139,164,255,.08),rgba(255,255,255,.015))] p-3.5">
    <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.11em] text-[var(--accent)]"><Gauge size={13} />MXM Score</p><p className="mt-1 text-[10px] text-[var(--muted)]">Аналитический индекс рынка, не прогноз цены.</p></div><div className="text-right"><p className="text-2xl font-semibold leading-none">{score.score}</p><p className="mt-1 text-[9px] text-[var(--muted)]">{score.label} · confidence {score.confidence}%</p></div></div>
    <div className="mt-3 grid grid-cols-5 gap-1.5">{(Object.keys(componentMeta) as MXMScoreComponentKey[]).map((key) => { const meta = componentMeta[key]; const Icon = meta.icon; return <div key={key} className="min-w-0 rounded-[13px] bg-black/15 p-2 text-center"><Icon size={11} className="mx-auto text-[var(--muted)]" /><b className="mt-1 block text-[10px]">{score.components[key]}</b><span className="mt-0.5 block truncate text-[7px] text-[var(--muted)]">{meta.label}</span></div>; })}</div>
  </section>;
}
