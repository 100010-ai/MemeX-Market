"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Crown, LockKeyhole, Sparkles, Star, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useTelegramProfile } from "@/components/telegram-provider";

type Reward = { label: string; kind: string; amount?: number } | null;
type Level = { level: number; requiredXp: number; freeReward: Reward; premiumReward: Reward; freeClaimed: boolean; premiumClaimed: boolean };
type Payload = { season: { id: string; title: string; startsAt: string; endsAt: string; daysLeft: number }; xp: number; level: number; premium: boolean; levels: Level[] };

export default function SeasonPage() {
  const { haptic } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setData(await apiFetch<Payload>("/api/season", { cacheMs: 0 })), []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить сезон"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const next = useMemo(() => data?.levels.find((item) => item.level > data.level) || null, [data]);
  const currentFloor = data?.levels.filter((item) => item.level <= (data?.level || 0)).at(-1)?.requiredXp || 0;
  const progress = next && data ? Math.max(0, Math.min(100, ((data.xp - currentFloor) / Math.max(1, next.requiredXp - currentFloor)) * 100)) : data ? 100 : 0;

  async function claim(level: number, track: "free" | "premium") {
    const key = `${level}:${track}`;
    if (busy) return;
    setBusy(key); setError(null);
    try {
      const result = await apiFetch<{ status: string; reward?: Reward }>("/api/season", { method: "POST", body: JSON.stringify({ level, track }) });
      if (result.status !== "claimed") throw new Error("Награда пока недоступна");
      haptic("heavy"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось забрать награду"); }
    finally { setBusy(null); }
  }

  return <div className="mx-auto max-w-5xl">
    <header className="mb-4 border-b border-[var(--border-soft)] pb-4"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Сезон · 30 дней</p><h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">{data?.season.title || "Сезон MEMEX"}</h1><p className="mt-1.5 text-[10px] text-[var(--muted)]">Торгуй, собирай подарки и создавай мемкоины, чтобы продвигаться по сезонной дорожке.</p></div><div className="shrink-0 text-right"><p className="flex items-center justify-end gap-1 text-[9px] text-[var(--muted)]"><Clock3 size={11} />Осталось</p><p className="mt-1 text-sm font-semibold">{data?.season.daysLeft ?? 30} дн.</p></div></div>
      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] text-[12px] font-black text-black">{data?.level || 1}</span><div><div className="flex justify-between text-[8px] text-[var(--muted)]"><span>{data?.xp || 0} опыта</span><span>{next ? `${next.requiredXp} опыта` : "МАКС."}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${progress}%` }} /></div></div>{data?.premium ? <span className="inline-flex items-center gap-1 text-[9px] text-[#f3d789]"><Crown size={10} />Премиум-ветка открыта</span> : <Link href="/store?category=season" className="inline-flex items-center gap-1 text-[9px] text-[#f3d789]"><Star size={10} fill="currentColor" />Открыть премиум-ветку</Link>}</div>
    </header>
    {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}
    <div className="grid grid-cols-[42px_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 text-[9px]"><div /><div className="mb-2 flex items-center gap-1.5 text-[var(--muted)]"><Trophy size={12} />Бесплатная ветка</div><div className="mb-2 flex items-center gap-1.5 text-[#f3d789]"><Crown size={12} />Премиум-ветка</div>
      {data?.levels.map((item) => <LevelRow key={item.level} item={item} currentLevel={data.level} premium={data.premium} busy={busy} claim={claim} />)}
    </div>
  </div>;
}

function LevelRow({ item, currentLevel, premium, busy, claim }: { item: Level; currentLevel: number; premium: boolean; busy: string | null; claim: (level: number, track: "free" | "premium") => Promise<void> }) {
  const unlocked = currentLevel >= item.level;
  return <>
    <div className="grid min-h-[82px] place-items-center border-t border-[var(--border-soft)]"><span className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold ${unlocked ? "bg-[var(--accent)] text-black" : "bg-white/[.05] text-[var(--muted)]"}`}>{item.level}</span></div>
    <RewardCell reward={item.freeReward} locked={!unlocked} claimed={item.freeClaimed} busy={busy === `${item.level}:free`} onClaim={() => claim(item.level, "free")} />
    <RewardCell reward={item.premiumReward} locked={!unlocked || !premium} claimed={item.premiumClaimed} busy={busy === `${item.level}:premium`} onClaim={() => claim(item.level, "premium")} premium />
  </>;
}

function RewardCell({ reward, locked, claimed, busy, onClaim, premium = false }: { reward: Reward; locked: boolean; claimed: boolean; busy: boolean; onClaim: () => Promise<void>; premium?: boolean }) {
  return <div className={`flex min-h-[82px] items-center gap-2 border-t border-[var(--border-soft)] px-2 ${premium ? "bg-[#f5c451]/[.025]" : ""}`}><div className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${premium ? "bg-[#f5c451]/10 text-[#f3d789]" : "bg-white/[.045] text-[var(--accent)]"}`}>{locked ? <LockKeyhole size={13} /> : claimed ? <Check size={14} /> : <Sparkles size={13} />}</div><div className="min-w-0 flex-1"><p className="truncate text-[9px] font-medium">{reward?.label || "Секретная награда"}</p>{!locked && !claimed ? <button type="button" disabled={busy} onClick={() => void onClaim()} className="mt-1 text-[8px] text-[var(--accent)] underline decoration-white/20 underline-offset-2">{busy ? "…" : "Забрать"}</button> : <p className="mt-1 text-[8px] text-[var(--muted-2)]">{claimed ? "Получено" : "Закрыто"}</p>}</div></div>;
}
