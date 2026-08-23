"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, Check, Flame, Gift, LockKeyhole, PackageOpen, Sparkles, Trophy, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useTelegramProfile } from "@/components/telegram-provider";
import { rarityLabel } from "@/lib/ui-copy";

type LevelReward = { level: number; kind: string; label: string; amount: number; unlocked: boolean; claimed: boolean };
type StreakReward = { day?: number; label: string; kind: string; amount: number };
type Achievement = {
  key: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  category: string;
  rarity: string;
  progress: number;
  target: number;
  unlocked: boolean;
  unlockedAt: string | null;
};
type Payload = {
  account: {
    xp: number;
    level: number;
    levelProgress: number;
    levelStartXp: number;
    nextLevelXp: number;
    xpForNext: number;
    prestigeLevel: number;
    rewards: LevelReward[];
  };
  streak: {
    currentStreak: number;
    bestStreak: number;
    totalClaims: number;
    claimedToday: boolean;
    canClaim: boolean;
    nextDay: number;
    nextReward: StreakReward;
    calendar: Array<StreakReward & { day: number }>;
    resetTimezone: string;
  };
  achievements: Achievement[];
  newlyUnlocked: number;
};

const CATEGORY_LABEL: Record<string, string> = {
  account: "Аккаунт",
  trading: "Торговля",
  collection: "Коллекции",
  cases: "Кейсы",
  creator: "Автор",
  streak: "Серия",
  season: "Сезон",
  legacy: "Особые",
};
const RARITY_TEXT: Record<string, string> = {
  common: "text-[var(--muted)]",
  rare: "text-[#73c7ff]",
  epic: "text-[#b79cff]",
  legendary: "text-[#f5c451]",
};

function rewardIcon(kind: string) {
  if (kind === "case") return <PackageOpen size={13} />;
  if (kind === "energy") return <Zap size={13} />;
  if (kind === "profile_item") return <Award size={13} />;
  return <Sparkles size={13} />;
}

export default function ProgressionPage() {
  const { haptic, refreshProfile } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [achievementFilter, setAchievementFilter] = useState("all");

  const load = useCallback(async () => {
    const payload = await apiFetch<Payload>("/api/progression", { cacheMs: 0, dedupe: false });
    setData(payload);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить прогресс"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || busy) return;
      void load().catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [busy, load]);

  const categories = useMemo(() => {
    const result = new Map<string, Achievement[]>();
    for (const achievement of data?.achievements || []) {
      result.set(achievement.category, [...(result.get(achievement.category) || []), achievement]);
    }
    return [...result.entries()].map(([category, items]) => [category, [...items].sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || (b.progress / Math.max(1, b.target)) - (a.progress / Math.max(1, a.target)))] as const);
  }, [data?.achievements]);
  const visibleCategories = useMemo(() => achievementFilter === "all" ? categories : categories.filter(([category]) => category === achievementFilter), [achievementFilter, categories]);

  const unlockedCount = data?.achievements.filter((item) => item.unlocked).length || 0;
  const pendingLevelRewards = data?.account.rewards.filter((item) => item.unlocked && !item.claimed) || [];

  async function claim(action: "claim_streak" | "claim_level", level?: number) {
    const key = action === "claim_streak" ? "streak" : `level:${level}`;
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ status?: string; alreadyClaimed?: boolean; reward?: { label?: string } }>("/api/progression", {
        method: "POST",
        body: JSON.stringify(action === "claim_level" ? { action, level } : { action }),
      });
      haptic("heavy");
      await Promise.all([load(), refreshProfile()]);
      setNotice(result.alreadyClaimed ? "Эта награда уже была получена" : result.reward?.label ? `Получено: ${result.reward.label}` : "Награда зачислена");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось получить награду");
    } finally {
      setBusy(null);
    }
  }

  return <div className="mx-auto max-w-5xl">
    <header className="mb-3 border-b border-[var(--border-soft)] pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold tracking-[-.035em]">Прогресс</h1>
        </div>
        <div className="shrink-0 text-right"><p className="text-[8px] text-[var(--muted)]">Достижения</p><p className="mt-0.5 text-[12px] font-semibold">{unlockedCount}/{data?.achievements.length || 0}</p></div>
      </div>
    </header>

    {error ? <div className="mxm-alert mxm-alert-error mb-2.5">{error}</div> : null}
    {notice ? <div className="mxm-alert mb-2.5">{notice}</div> : null}
    {data?.newlyUnlocked ? <div className="mxm-alert mb-2.5">Открыто новых достижений: {data.newlyUnlocked}. XP уже начислен.</div> : null}

    <section className="mxm-summary-card p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[var(--accent)] text-sm font-black text-[#0b0f15]">{data?.account.level || 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0"><p className="truncate text-[11px] font-semibold">Уровень аккаунта {data?.account.level || 1}</p><p className="mt-0.5 text-[8px] text-[var(--muted)]">{(data?.account.xp || 0).toLocaleString("ru-RU")} XP{data?.account.prestigeLevel ? ` · Prestige ${data.account.prestigeLevel}` : ""}</p></div>
            <span className="shrink-0 text-[8px] text-[var(--muted)]">{(data?.account.xpForNext || 0).toLocaleString("ru-RU")} до этапа</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round((data?.account.levelProgress || 0) * 100)}%` }} /></div>
        </div>
      </div>

      {pendingLevelRewards.length ? <div className="mt-3 border-t border-[var(--border-soft)] pt-2.5">
        <p className="mb-2 text-[8px] uppercase tracking-[.12em] text-[var(--muted-2)]">Доступные награды уровня</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {pendingLevelRewards.map((item) => <button key={item.level} type="button" disabled={Boolean(busy)} onClick={() => void claim("claim_level", item.level)} className="flex items-center gap-2 rounded-[12px] bg-white/[.035] px-2.5 py-2 text-left ring-1 ring-white/[.055] disabled:opacity-40">
            <span className="text-[var(--accent)]">{rewardIcon(item.kind)}</span>
            <span className="min-w-0 flex-1"><b className="block truncate text-[9px] font-medium">Ур. {item.level} · {item.label}</b><small className="text-[7px] text-[var(--muted)]">{busy === `level:${item.level}` ? "Получаем…" : "Забрать"}</small></span>
          </button>)}
        </div>
      </div> : null}

      <div className="mxm-hscroll mt-3 gap-1.5 pb-1">
        {data?.account.rewards.map((item) => <div key={item.level} className={`min-w-[118px] rounded-[11px] border px-2.5 py-2 ${item.claimed ? "border-[var(--positive)]/20 bg-[var(--positive)]/[.03]" : item.unlocked ? "border-[var(--accent)]/20 bg-[var(--accent)]/[.03]" : "border-[var(--border)] bg-white/[.012]"}`}>
          <div className="flex items-center justify-between"><span className="text-[8px] font-semibold">Ур. {item.level}</span>{item.claimed ? <Check size={10} className="text-[var(--positive)]" /> : item.unlocked ? <Gift size={10} className="text-[var(--accent)]" /> : <LockKeyhole size={9} className="text-[var(--muted)]" />}</div>
          <p className="mt-1 text-[7px] leading-3.5 text-[var(--muted)]">{item.label}</p>
        </div>)}
      </div>
    </section>

    <section className="mt-3 border-y border-[var(--border-soft)] py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="flex items-center gap-1.5 text-[11px] font-medium"><Flame size={14} />Серия · {data?.streak.currentStreak || 0}</h2><p className="mt-0.5 text-[8px] text-[var(--muted)]">Рекорд {data?.streak.bestStreak || 0}</p></div>
        <button type="button" disabled={!data?.streak.canClaim || Boolean(busy)} onClick={() => void claim("claim_streak")} className="mxm-primary-action shrink-0">{busy === "streak" ? "Получаем…" : data?.streak.claimedToday ? "Сегодня получено" : `Забрать Д${data?.streak.nextDay || 1}`}</button>
      </div>
      <div className="mt-2.5 grid grid-cols-7 gap-1">
        {data?.streak.calendar.map((item) => {
          const active = item.day === data.streak.nextDay && !data.streak.claimedToday;
          return <div key={item.day} className={`min-w-0 rounded-[10px] px-1 py-1.5 text-center ring-1 ${active ? "bg-[var(--accent)]/[.09] text-[var(--accent)] ring-[var(--accent)]/20" : "bg-white/[.018] ring-white/[.045]"}`}>
            <span className="text-[6.5px] text-[var(--muted)]">Д{item.day}</span>
            <span className="mx-auto mt-0.5 grid h-4 place-items-center">{rewardIcon(item.kind)}</span>
            <span className="mt-0.5 block truncate text-[6.5px]">{item.kind === "mxm_coins" ? `${item.amount}` : item.kind === "energy" ? `${item.amount}⚡` : item.kind === "case" ? "Кейс" : item.label}</span>
          </div>;
        })}
      </div>
    </section>

    <section className="mt-3">
      <div className="mb-2 flex items-end justify-between gap-3"><div><h2 className="flex items-center gap-1.5 text-[11px] font-medium"><Trophy size={14} />Достижения</h2></div><span className="text-[8px] text-[var(--muted)]">{unlockedCount} открыто</span></div>
      <div className="mxm-hscroll mb-3 gap-1.5 pb-1">
        <button type="button" onClick={() => setAchievementFilter("all")} className={`mxm-filter-chip ${achievementFilter === "all" ? "is-active" : ""}`}>Все <span>{data?.achievements.length || 0}</span></button>
        {categories.map(([category, items]) => <button key={category} type="button" onClick={() => setAchievementFilter(category)} className={`mxm-filter-chip ${achievementFilter === category ? "is-active" : ""}`}>{CATEGORY_LABEL[category] || category}<span>{items.filter((item) => item.unlocked).length}/{items.length}</span></button>)}
      </div>
      <div className="space-y-3.5">
        {visibleCategories.map(([category, items]) => <div key={category}>
          <div className="mb-1.5 flex items-center justify-between"><p className="text-[8px] uppercase tracking-[.11em] text-[var(--muted-2)]">{CATEGORY_LABEL[category] || category}</p><span className="text-[7px] text-[var(--muted)]">{items.filter((item) => item.unlocked).length}/{items.length}</span></div>
          <div className="grid gap-1.5 md:grid-cols-2">
            {items.map((item) => {
              const percent = Math.max(0, Math.min(100, (item.progress / Math.max(1, item.target)) * 100));
              return <article key={item.key} className="border-t border-[var(--border-soft)] py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[11px] bg-white/[.03] ${RARITY_TEXT[item.rarity] || RARITY_TEXT.common}`}>{item.unlocked ? <Award size={13} /> : <LockKeyhole size={12} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2"><p className="text-[9px] font-medium">{item.title}</p><span className={`shrink-0 text-[6.5px] uppercase ${RARITY_TEXT[item.rarity] || RARITY_TEXT.common}`}>{rarityLabel(item.rarity)}</span></div>
                    <p className="mt-0.5 line-clamp-1 text-[7.5px] leading-3.5 text-[var(--muted)]">{item.description}</p>
                    <div className="mt-1.5 flex items-center justify-between text-[6.5px] text-[var(--muted)]"><span>{Math.floor(item.progress).toLocaleString("ru-RU")} / {Math.floor(item.target).toLocaleString("ru-RU")}</span><span>+{item.xpReward} XP</span></div>
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[.045]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${item.unlocked ? 100 : percent}%` }} /></div>
                  </div>
                </div>
              </article>;
            })}
          </div>
        </div>)}
      </div>
    </section>
  </div>;
}
