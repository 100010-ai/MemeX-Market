"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Clock3, Crown, Gift, LockKeyhole, PackageOpen, ShieldCheck, Sparkles, Star, Trophy, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { getProfileFrameDefinition } from "@/lib/profile-frames";
import { useTelegramProfile } from "@/components/telegram-provider";

type RewardMetadata = { assetKey?: string; rarity?: string; exclusive?: boolean };
type Reward = { label: string; kind: string; amount?: number; metadata?: RewardMetadata } | null;
type Level = { level: number; requiredXp: number; freeReward: Reward; premiumReward: Reward; freeClaimed: boolean; premiumClaimed: boolean };
type Prestige = { unlocked: boolean; level: number; claimed: number; claimable: number; stepXp: number; baseXp: number; nextRequiredXp: number; nextClaimLevel: number; nextReward: Reward };
type SeasonSummary = { id: string; title: string; startsAt: string; endsAt: string; daysLeft: number; weekNumber: number; theme: string; exclusiveFrameKeys: string[] };
type Payload = { season: SeasonSummary; nextSeason: (Omit<SeasonSummary, "endsAt" | "daysLeft"> & { startsAt: string }) | null; xp: number; level: number; premium: boolean; levels: Level[]; prestige: Prestige };
type ClaimAllResult = { status: string; claimedCount?: number; rewards?: unknown[] };

const XP_SOURCES = [
  { label: "Сделка", xp: "+2", icon: Zap },
  { label: "Подарок", xp: "+5", icon: Gift },
  { label: "Запуск", xp: "+10", icon: Sparkles },
  { label: "Задание", xp: "+8", icon: ShieldCheck },
];

function rewardIcon(kind: string | undefined) {
  if (kind === "case") return <PackageOpen size={18} />;
  if (kind === "energy") return <Zap size={18} />;
  if (kind === "profile_item") return <Gift size={18} />;
  return <Sparkles size={18} />;
}

function daysUntil(value: string | undefined) {
  if (!value) return null;
  const distance = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(distance)) return null;
  return Math.max(0, Math.ceil(distance / 86_400_000));
}

export default function SeasonPage() {
  const { haptic, refreshProfile } = useTelegramProfile();
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
    return data.levels.reduce((count, item) => count + (item.level <= data.level && !item.freeClaimed ? 1 : 0) + (item.level <= data.level && data.premium && !item.premiumClaimed ? 1 : 0), 0);
  }, [data]);
  const maxLevel = data?.levels.at(-1)?.level || 12;
  const exclusiveFrames = (data?.season.exclusiveFrameKeys || []).flatMap((key) => {
    const frame = getProfileFrameDefinition(key);
    return frame?.assetSrc ? [frame] : [];
  });

  async function claim(level: number, track: "free" | "premium") {
    const key = `${level}:${track}`;
    if (busy) return;
    setBusy(key); setError(null); setNotice(null);
    try {
      const result = await apiFetch<{ status: string; reward?: Reward }>("/api/season", { method: "POST", body: JSON.stringify({ level, track }) });
      if (result.status !== "claimed") throw new Error("Награда пока недоступна");
      haptic("heavy");
      await Promise.all([load(), refreshProfile()]);
      setNotice("Награда зачислена");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось забрать награду"); }
    finally { setBusy(null); }
  }

  async function claimAll() {
    if (busy || claimableCount < 1) return;
    setBusy("all"); setError(null); setNotice(null);
    try {
      const result = await apiFetch<ClaimAllResult>("/api/season", { method: "POST", body: JSON.stringify({ action: "claim_all" }) });
      haptic("heavy");
      await Promise.all([load(), refreshProfile()]);
      setNotice(`Получено: ${Number(result.claimedCount || 0)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось забрать награды"); }
    finally { setBusy(null); }
  }

  async function claimPrestige() {
    if (busy || !data?.prestige || data.prestige.claimable < 1) return;
    const prestigeLevel = data.prestige.nextClaimLevel;
    setBusy("prestige"); setError(null); setNotice(null);
    try {
      await apiFetch("/api/season", { method: "POST", body: JSON.stringify({ action: "claim_prestige", prestigeLevel }) });
      haptic("heavy");
      await Promise.all([load(), refreshProfile()]);
      setNotice(`Prestige ${prestigeLevel} получен`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить Prestige-награду"); }
    finally { setBusy(null); }
  }

  if (!data && !error) return <SeasonSkeleton />;

  return <div className="mxm-season-vault mx-auto max-w-[1240px]">
    <div className="mxm-season-vault-top">
      <section className="mxm-season-vault-hero">
        <Image src="/assets/season/weekly-vault-hero.webp" alt="" fill priority sizes="(min-width: 1024px) 820px, 100vw" className="mxm-season-vault-hero-art" />
        <div className="mxm-season-vault-hero-shade" />
        <div className="mxm-season-vault-copy">
          <span className="mxm-season-kicker"><Crown size={12} /> Неделя {data?.season.weekNumber || 1}</span>
          <h1>{data?.season.title || "Хранилище MXM"}</h1>
          <p>Новый пропуск каждую неделю. Эксклюзивные рамки не возвращаются в магазин.</p>
          <div className="mxm-season-vault-actions">
            {data?.premium
              ? <span className="mxm-season-premium-open"><Check size={13} /> Premium открыт</span>
              : <Link href="/store?category=season" className="mxm-season-buy"><Star size={14} fill="currentColor" />149 Stars</Link>}
            <span><Clock3 size={12} />{data?.season.daysLeft ?? 7} дн.</span>
          </div>
        </div>
      </section>

      <aside className="mxm-season-next-card">
        <div className="mxm-season-next-head"><span>Следующая неделя</span><b>#{data?.nextSeason?.weekNumber || (data?.season.weekNumber || 1) + 1}</b></div>
        <div className="mxm-season-next-visual"><Image src="/assets/season/weekly-vault-hero.webp" alt="" fill sizes="320px" /></div>
        <div className="mxm-season-next-copy">
          <h2>{data?.nextSeason?.title || "Новое хранилище"}</h2>
          <p>Старт через {daysUntil(data?.nextSeason?.startsAt) ?? 7} дн.</p>
        </div>
      </aside>
    </div>

    <section className="mxm-season-commandbar">
      <div className="mxm-season-level-orb"><b>{data?.level || 1}</b><span>/ {maxLevel}</span></div>
      <div className="mxm-season-progress-copy"><div><b>{data?.xp.toLocaleString("ru-RU") || 0} XP</b><span>{next && data ? `ещё ${Math.max(0, next.requiredXp - data.xp)} XP` : "максимум"}</span></div><div className="mxm-season-progress"><i style={{ width: `${progress}%` }} /></div></div>
      <div className="mxm-season-xp-sources">{XP_SOURCES.map(({ label, xp, icon: Icon }) => <span key={label}><Icon size={11} /><b>{xp}</b>{label}</span>)}</div>
      {claimableCount > 0 ? <button type="button" disabled={Boolean(busy)} onClick={() => void claimAll()} className="mxm-season-claim-all"><CheckCheck size={14} />{busy === "all" ? "Получаем" : `Забрать ${claimableCount}`}</button> : <span className="mxm-season-done"><Check size={13} />Всё получено</span>}
    </section>

    {error ? <div className="mxm-alert mxm-alert-error mt-3">{error}</div> : null}
    {notice ? <div role="status" aria-live="polite" className="mxm-alert mxm-success-pop mt-3">{notice}</div> : null}

    <section className="mxm-season-exclusive">
      <div><span>Только в этом пропуске</span><h2>Эксклюзивная коллекция</h2></div>
      <div className="mxm-season-exclusive-list">
        {exclusiveFrames.length ? exclusiveFrames.map((frame) => <div key={frame.key} className="mxm-season-frame-card"><div className="mxm-season-frame-preview"><Image src={frame.assetSrc!} alt="" fill sizes="64px" /></div><span>{frame.title}</span><small>не продаётся</small></div>) : <><FramePlaceholder /><FramePlaceholder /><FramePlaceholder /></>}
      </div>
    </section>

    <section className="mxm-season-board">
      <header className="mxm-season-board-head"><div><span>Награды недели</span><h2>12 уровней</h2></div><div className="mxm-season-legend"><span><i className="is-ready" />Доступно</span><span><i className="is-premium" />Premium</span><span><i />Закрыто</span></div></header>
      <div ref={trackRef} className="mxm-season-grid-scroll">
        <div className="mxm-season-grid">
          <div className="mxm-season-grid-label"><span>Уровень</span></div>
          {data?.levels.map((item) => <div key={`level-${item.level}`} data-season-level={item.level} className={`mxm-season-grid-level ${data.level === item.level ? "is-current" : ""} ${data.level >= item.level ? "is-open" : ""}`}><b>{item.level}</b><span>{item.requiredXp} XP</span></div>)}
          <div className="mxm-season-grid-label is-free"><span>Free</span></div>
          {data?.levels.map((item) => <SeasonRewardCell key={`free-${item.level}`} item={item} reward={item.freeReward} track="free" unlocked={data.level >= item.level} claimed={item.freeClaimed} busy={busy === `${item.level}:free`} claim={claim} />)}
          <div className="mxm-season-grid-label is-premium"><Crown size={12} /><span>Premium</span></div>
          {data?.levels.map((item) => <SeasonRewardCell key={`premium-${item.level}`} item={item} reward={item.premiumReward} track="premium" unlocked={data.level >= item.level && data.premium} claimed={item.premiumClaimed} busy={busy === `${item.level}:premium`} claim={claim} premium />)}
        </div>
      </div>
    </section>

    {data?.prestige ? <section className="mxm-season-prestige">
      <div className="mxm-season-prestige-icon"><Trophy size={18} /></div>
      <div><span>После 12 уровня</span><h2>Prestige · P{data.prestige.level}</h2></div>
      <p>Новая награда каждые {data.prestige.stepXp} XP</p>
      <button type="button" disabled={!data.prestige.unlocked || data.prestige.claimable < 1 || Boolean(busy)} onClick={() => void claimPrestige()}>{busy === "prestige" ? "Получаем" : data.prestige.claimable > 0 ? `Забрать P${data.prestige.nextClaimLevel}` : `${Math.max(0, data.prestige.nextRequiredXp - data.xp)} XP до награды`}</button>
    </section> : null}
  </div>;
}

function SeasonRewardCell({ item, reward, track, unlocked, claimed, busy, claim, premium = false }: { item: Level; reward: Reward; track: "free" | "premium"; unlocked: boolean; claimed: boolean; busy: boolean; claim: (level: number, track: "free" | "premium") => Promise<void>; premium?: boolean }) {
  const frame = reward?.metadata?.assetKey ? getProfileFrameDefinition(reward.metadata.assetKey) : null;
  const canClaim = unlocked && !claimed;
  return <button type="button" className={`mxm-season-reward-cell ${premium ? "is-premium" : ""} ${unlocked ? "is-open" : ""} ${claimed ? "is-claimed" : ""}`} disabled={!canClaim || busy} onClick={() => void claim(item.level, track)} title={reward?.label || "Секретная награда"}>
    <span className="mxm-season-reward-art">{frame?.assetSrc ? <Image src={frame.assetSrc} alt="" fill sizes="54px" /> : claimed ? <Check size={18} /> : !unlocked ? <LockKeyhole size={15} /> : rewardIcon(reward?.kind)}</span>
    <span>{reward?.label || "Секрет"}</span>
    {reward?.metadata?.exclusive ? <small>EXCLUSIVE</small> : null}
  </button>;
}

function FramePlaceholder() {
  return <div className="mxm-season-frame-card is-loading"><div className="mxm-season-frame-preview" /><span>Секретная рамка</span><small>не продаётся</small></div>;
}

function SeasonSkeleton() {
  return <div className="mx-auto max-w-[1240px]"><div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]"><div className="mxm-skeleton h-64 rounded-[22px]" /><div className="mxm-skeleton h-64 rounded-[22px]" /></div><div className="mxm-skeleton mt-3 h-72 rounded-[22px]" /></div>;
}
