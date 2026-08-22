"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CheckCheck, Clock3, Crown, Gift, LockKeyhole, PackageOpen, Sparkles, Star, Trophy, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useTelegramProfile } from "@/components/telegram-provider";

type Reward = { label: string; kind: string; amount?: number } | null;
type Level = { level: number; requiredXp: number; freeReward: Reward; premiumReward: Reward; freeClaimed: boolean; premiumClaimed: boolean };
type Payload = { season: { id: string; title: string; startsAt: string; endsAt: string; daysLeft: number }; xp: number; level: number; premium: boolean; levels: Level[] };
type ClaimAllResult = { status: string; claimedCount?: number; rewards?: unknown[] };

const XP_SOURCES = [
  { label: "Сделка мемкоина", xp: "+2 XP" },
  { label: "Покупка/продажа подарка", xp: "+5 XP" },
  { label: "Запуск мемкоина", xp: "+10 XP" },
  { label: "Выполненное задание", xp: "+8 XP" },
];

function rewardIcon(kind: string | undefined) {
  if (kind === "case") return <PackageOpen size={13} />;
  if (kind === "energy") return <Zap size={13} />;
  if (kind === "profile_item") return <Gift size={13} />;
  return <Sparkles size={13} />;
}

export default function SeasonPage() {
  const { haptic } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => setData(await apiFetch<Payload>("/api/season", { cacheMs: 20_000 })), []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить сезон"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const next = useMemo(() => data?.levels.find((item) => item.level > data.level) || null, [data]);
  const currentFloor = data?.levels.filter((item) => item.level <= (data?.level || 0)).at(-1)?.requiredXp || 0;
  const progress = next && data ? Math.max(0, Math.min(100, ((data.xp - currentFloor) / Math.max(1, next.requiredXp - currentFloor)) * 100)) : data ? 100 : 0;
  const claimableCount = useMemo(() => {
    if (!data) return 0;
    return data.levels.reduce((count, item) => {
      if (item.level > data.level) return count;
      if (!item.freeClaimed) count += 1;
      if (data.premium && !item.premiumClaimed) count += 1;
      return count;
    }, 0);
  }, [data]);
  const maxLevel = data?.levels.at(-1)?.level || 30;

  async function claim(level: number, track: "free" | "premium") {
    const key = `${level}:${track}`;
    if (busy) return;
    setBusy(key); setError(null); setNotice(null);
    try {
      const result = await apiFetch<{ status: string; reward?: Reward }>("/api/season", { method: "POST", body: JSON.stringify({ level, track }) });
      if (result.status !== "claimed") throw new Error("Награда пока недоступна");
      haptic("heavy");
      await load();
      setNotice("Сезонная награда зачислена");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось забрать награду"); }
    finally { setBusy(null); }
  }

  async function claimAll() {
    if (busy || claimableCount < 1) return;
    setBusy("all"); setError(null); setNotice(null);
    try {
      const result = await apiFetch<ClaimAllResult>("/api/season", { method: "POST", body: JSON.stringify({ action: "claim_all" }) });
      haptic("heavy");
      await load();
      setNotice(`Получено сезонных наград: ${Number(result.claimedCount || 0)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось забрать награды"); }
    finally { setBusy(null); }
  }

  return <div className="mx-auto max-w-5xl">
    <header className="mb-4 border-b border-[var(--border-soft)] pb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Боевой пропуск · 30 дней</p>
          <h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">{data?.season.title || "Сезон MXM"}</h1>
          <p className="mt-1.5 max-w-2xl text-[10px] leading-5 text-[var(--muted)]">Получай XP за реальные действия внутри MXM: сделки, подарки, задания и запуск мемкоинов. Бесплатная ветка доступна всем, премиальная открывается до конца текущего сезона.</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="flex items-center justify-end gap-1 text-[9px] text-[var(--muted)]"><Clock3 size={11} />Осталось</p>
          <p className="mt-1 text-sm font-semibold">{data?.season.daysLeft ?? 30} дн.</p>
          <p className="mt-1 text-[8px] text-[var(--muted-2)]">{maxLevel} уровней</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] text-[12px] font-black text-black">{data?.level || 1}</span>
        <div>
          <div className="flex justify-between text-[8px] text-[var(--muted)]"><span>{data?.xp || 0} XP</span><span>{next ? `${next.requiredXp} XP` : "МАКС."}</span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${progress}%` }} /></div>
        </div>
        {data?.premium
          ? <span className="inline-flex items-center gap-1 text-[9px] text-[#f3d789]"><Crown size={10} />Премиум открыт</span>
          : <Link href="/store?category=season" className="inline-flex items-center gap-1 text-[9px] text-[#f3d789]"><Star size={10} fill="currentColor" />Открыть премиум</Link>}
      </div>
    </header>

    {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}
    {notice ? <div className="mxm-alert mb-3">{notice}</div> : null}

    <section className="mb-4 border-y border-[var(--border-soft)] py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[11px] font-semibold">Как получать XP</p><p className="mt-1 text-[8px] text-[var(--muted)]">Прогресс считается сервером из подтверждённых действий, вручную накрутить XP нельзя.</p></div>
        {claimableCount > 0 && maxLevel >= 30
          ? <button type="button" disabled={Boolean(busy)} onClick={() => void claimAll()} className="inline-flex min-h-9 items-center gap-1.5 rounded-[12px] bg-white px-3 text-[10px] font-semibold text-black disabled:opacity-40"><CheckCheck size={13} />{busy === "all" ? "Получаем…" : `Забрать всё · ${claimableCount}`}</button>
          : claimableCount > 0
            ? <span className="inline-flex items-center gap-1 text-[9px] text-[var(--muted)]"><Gift size={11} />Доступно наград: {claimableCount}</span>
            : <span className="inline-flex items-center gap-1 text-[9px] text-[var(--muted)]"><Check size={11} />Доступные награды получены</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {XP_SOURCES.map((source) => <div key={source.label} className="flex items-center justify-between border-t border-[var(--border-soft)] pt-2 text-[8px]"><span className="text-[var(--muted)]">{source.label}</span><b className="font-medium text-[var(--accent)]">{source.xp}</b></div>)}
      </div>
    </section>

    <div className="grid grid-cols-[42px_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 text-[9px]">
      <div />
      <div className="mb-2 flex items-center gap-1.5 text-[var(--muted)]"><Trophy size={12} />Бесплатная ветка</div>
      <div className="mb-2 flex items-center gap-1.5 text-[#f3d789]"><Crown size={12} />Премиум-ветка</div>
      {data?.levels.map((item) => <LevelRow key={item.level} item={item} currentLevel={data.level} premium={data.premium} busy={busy} claim={claim} />)}
    </div>
  </div>;

}

function LevelRow({ item, currentLevel, premium, busy, claim }: { item: Level; currentLevel: number; premium: boolean; busy: string | null; claim: (level: number, track: "free" | "premium") => Promise<void> }) {
  const unlocked = currentLevel >= item.level;
  const milestone = item.level % 5 === 0;
  return <>
    <div className={`grid min-h-[82px] place-items-center border-t border-[var(--border-soft)] ${milestone ? "bg-white/[.012]" : ""}`}><div className="text-center"><span className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold ${unlocked ? "bg-[var(--accent)] text-black" : "bg-white/[.05] text-[var(--muted)]"}`}>{item.level}</span>{milestone ? <span className="mt-1 block text-[7px] uppercase tracking-[.08em] text-[var(--muted-2)]">этап</span> : null}</div></div>
    <RewardCell reward={item.freeReward} locked={!unlocked} claimed={item.freeClaimed} busy={busy === `${item.level}:free`} onClaim={() => claim(item.level, "free")} milestone={milestone} />
    <RewardCell reward={item.premiumReward} locked={!unlocked || !premium} claimed={item.premiumClaimed} busy={busy === `${item.level}:premium`} onClaim={() => claim(item.level, "premium")} premium milestone={milestone} />
  </>;
}

function RewardCell({ reward, locked, claimed, busy, onClaim, premium = false, milestone = false }: { reward: Reward; locked: boolean; claimed: boolean; busy: boolean; onClaim: () => Promise<void>; premium?: boolean; milestone?: boolean }) {
  return <div className={`flex min-h-[82px] items-center gap-2 border-t border-[var(--border-soft)] px-2 ${premium ? "bg-[#f5c451]/[.025]" : ""} ${milestone ? "font-medium" : ""}`}><div className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${premium ? "bg-[#f5c451]/10 text-[#f3d789]" : "bg-white/[.045] text-[var(--accent)]"}`}>{locked ? <LockKeyhole size={13} /> : claimed ? <Check size={14} /> : rewardIcon(reward?.kind)}</div><div className="min-w-0 flex-1"><p className="text-[9px] font-medium leading-4">{reward?.label || "Секретная награда"}</p>{!locked && !claimed ? <button type="button" disabled={busy} onClick={() => void onClaim()} className="mt-1 text-[8px] text-[var(--accent)] underline decoration-white/20 underline-offset-2">{busy ? "…" : "Забрать"}</button> : <p className="mt-1 text-[8px] text-[var(--muted-2)]">{claimed ? "Получено" : premium && !claimed ? "Закрыто" : "Нужно больше XP"}</p>}</div></div>;
}
