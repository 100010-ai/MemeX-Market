"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Clock3, Crown, Gift, LockKeyhole, PackageOpen, Sparkles, Star, Trophy, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useTelegramProfile } from "@/components/telegram-provider";

type Reward = { label: string; kind: string; amount?: number } | null;
type Level = { level: number; requiredXp: number; freeReward: Reward; premiumReward: Reward; freeClaimed: boolean; premiumClaimed: boolean };
type Prestige = { unlocked: boolean; level: number; claimed: number; claimable: number; stepXp: number; baseXp: number; nextRequiredXp: number; nextClaimLevel: number; nextReward: Reward };
type Payload = { season: { id: string; title: string; startsAt: string; endsAt: string; daysLeft: number }; xp: number; level: number; premium: boolean; levels: Level[]; prestige: Prestige };
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
  const centeredLevelRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const load = useCallback(async () => setData(await apiFetch<Payload>("/api/season", { cacheMs: 20_000 })), []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить сезон"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);


  useEffect(() => {
    if (!data || centeredLevelRef.current === data.level) return;
    centeredLevelRef.current = data.level;
    const timer = window.setTimeout(() => {
      trackRef.current?.querySelector(`[data-season-level="${data.level}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [data]);

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

  async function claimPrestige() {
    if (busy || !data?.prestige || data.prestige.claimable < 1) return;
    const prestigeLevel = data.prestige.nextClaimLevel;
    setBusy("prestige"); setError(null); setNotice(null);
    try {
      const result = await apiFetch<{ status: string; reward?: Reward }>("/api/season", { method: "POST", body: JSON.stringify({ action: "claim_prestige", prestigeLevel }) });
      haptic("heavy");
      await load();
      setNotice(result.reward?.label ? `Prestige ${prestigeLevel}: ${result.reward.label}` : `Prestige ${prestigeLevel} получен`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить Prestige-награду"); }
    finally { setBusy(null); }
  }

  return <div className="mx-auto max-w-5xl">
    <header className="mb-3 border-b border-[var(--border-soft)] pb-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Боевой пропуск · 30 дней</p>
          <h1 className="mt-1 text-[18px] font-semibold tracking-[-.035em]">{data?.season.title || "Сезон MXM"}</h1>
          <p className="mt-1 max-w-2xl text-[9px] leading-4 text-[var(--muted)]">Получай XP за реальные действия внутри MXM: сделки, подарки, задания и запуск мемкоинов. Бесплатная ветка доступна всем, премиальная открывается до конца текущего сезона.</p>
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

    <section className="mb-3 border-y border-[var(--border-soft)] py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[11px] font-semibold">Как получать XP</p><p className="mt-1 text-[8px] text-[var(--muted)]">Прогресс считается сервером из подтверждённых действий, вручную накрутить XP нельзя.</p></div>
        {claimableCount > 0
          ? <button type="button" disabled={Boolean(busy)} onClick={() => void claimAll()} className="mxm-primary-action min-h-9"><CheckCheck size={13} />{busy === "all" ? "Получаем…" : `Забрать всё · ${claimableCount}`}</button>
          : <span className="inline-flex items-center gap-1 text-[9px] text-[var(--muted)]"><Check size={11} />Доступные награды получены</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {XP_SOURCES.map((source) => <div key={source.label} className="flex items-center justify-between border-t border-[var(--border-soft)] pt-2 text-[8px]"><span className="text-[var(--muted)]">{source.label}</span><b className="font-medium text-[var(--accent)]">{source.xp}</b></div>)}
      </div>
    </section>

    {data?.prestige ? <section className="mb-4 overflow-hidden rounded-[18px] border border-[#8f79e8]/20 bg-[linear-gradient(145deg,rgba(115,91,203,.08),rgba(245,196,81,.025),transparent)] p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[.12em] text-[#b9a7ff]"><Trophy size={12} />Prestige</p><h2 className="mt-1 text-sm font-semibold">Прогресс после {maxLevel} уровня</h2><p className="mt-1 max-w-2xl text-[8px] leading-4 text-[var(--muted)]">После основной дорожки каждые {data.prestige.stepXp} сезонного XP открывают новый Prestige-этап. Награды забираются последовательно, поэтому прогресс нельзя перескочить или выдать дважды.</p></div><div className="shrink-0 text-right"><p className="text-[8px] text-[var(--muted)]">Достигнуто</p><p className="mt-1 text-base font-semibold">P{data.prestige.level}</p><p className="text-[7px] text-[var(--muted-2)]">получено {data.prestige.claimed}</p></div></div>
      {data.prestige.unlocked ? <><div className="mt-3"><div className="flex items-center justify-between text-[8px] text-[var(--muted)]"><span>{data.xp.toLocaleString("ru-RU")} XP</span><span>след. {data.prestige.nextRequiredXp.toLocaleString("ru-RU")} XP</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[#9c86ef]" style={{ width: `${Math.min(100, Math.max(0, ((data.xp - (data.prestige.nextRequiredXp - data.prestige.stepXp)) / Math.max(1, data.prestige.stepXp)) * 100))}%` }} /></div></div><div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[.06] pt-3"><div className="min-w-0"><p className="text-[9px] text-[var(--muted)]">Следующая награда · P{data.prestige.nextClaimLevel}</p><p className="mt-0.5 truncate text-[10px] font-medium">{data.prestige.nextReward?.label || "Prestige-награда"}</p></div><button type="button" disabled={data.prestige.claimable < 1 || Boolean(busy)} onClick={() => void claimPrestige()} className="mxm-primary-action shrink-0">{busy === "prestige" ? "Получаем…" : data.prestige.claimable > 0 ? `Забрать P${data.prestige.nextClaimLevel}` : `Нужно ${Math.max(0, data.prestige.nextRequiredXp - data.xp)} XP`}</button></div></> : <div className="mt-3 flex items-center gap-2 border-t border-white/[.06] pt-3 text-[9px] text-[var(--muted)]"><LockKeyhole size={12} />Prestige откроется после завершения основной дорожки.</div>}
    </section> : null}

    <div className="mb-2 flex flex-wrap items-center gap-3 text-[8px] text-[var(--muted)]"><span className="mxm-season-state is-ready">Доступно</span><span className="mxm-season-state is-claimed">Получено</span><span className="mxm-season-state">Закрыто</span><span className="ml-auto">Дорожка центрируется на текущем уровне</span></div>
    <div ref={trackRef} className="mxm-season-track mxm-hscroll pb-2">
      {data?.levels.map((item) => <SeasonLevelCard key={item.level} item={item} currentLevel={data.level} premium={data.premium} busy={busy} claim={claim} />)}
    </div>
  </div>;

}

function SeasonLevelCard({ item, currentLevel, premium, busy, claim }: { item: Level; currentLevel: number; premium: boolean; busy: string | null; claim: (level: number, track: "free" | "premium") => Promise<void> }) {
  const unlocked = currentLevel >= item.level;
  const milestone = item.level % 5 === 0;
  const current = currentLevel === item.level;
  return <article data-season-level={item.level} className={`mxm-season-level-card ${milestone ? "is-milestone" : ""} ${current ? "is-current" : ""}`}>
    <header><span className={`mxm-season-level-number ${unlocked ? "is-unlocked" : ""}`}>{item.level}</span><span>{current ? "Текущий" : milestone ? "Этап" : `${item.requiredXp} XP`}</span></header>
    <SeasonReward label="FREE" reward={item.freeReward} locked={!unlocked} claimed={item.freeClaimed} busy={busy === `${item.level}:free`} onClaim={() => claim(item.level, "free")} />
    <SeasonReward label="PREMIUM" reward={item.premiumReward} locked={!unlocked || !premium} claimed={item.premiumClaimed} busy={busy === `${item.level}:premium`} onClaim={() => claim(item.level, "premium")} premium />
  </article>;
}

function SeasonReward({ label, reward, locked, claimed, busy, onClaim, premium = false }: { label: string; reward: Reward; locked: boolean; claimed: boolean; busy: boolean; onClaim: () => Promise<void>; premium?: boolean }) {
  const status = claimed ? "Получено" : locked ? "Закрыто" : "Забрать";
  return <div className={`mxm-season-reward ${premium ? "is-premium" : ""}`}>
    <span className="mxm-season-reward-icon">{locked ? <LockKeyhole size={12} /> : claimed ? <Check size={12} /> : rewardIcon(reward?.kind)}</span>
    <div className="min-w-0 flex-1"><small>{label}</small><p>{reward?.label || "Секретная награда"}</p></div>
    {!locked && !claimed ? <button type="button" disabled={busy} onClick={() => void onClaim()}>{busy ? "…" : status}</button> : <span className={claimed ? "is-claimed" : ""}>{status}</span>}
  </div>;
}
