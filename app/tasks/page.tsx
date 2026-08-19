"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Eye, Flame, Gem, Gift, Play, Sparkles, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Mission, MissionPeriod } from "@/lib/types";
import { money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";

const sectionMeta: Record<MissionPeriod, { title: string; icon: typeof Gift }> = {
  onboarding: { title: "Старт", icon: Gift },
  daily: { title: "Сегодня", icon: Flame },
  weekly: { title: "Неделя", icon: Trophy },
};

type RewardedAdStatus = {
  configured: boolean;
  migrationRequired: boolean;
  reward: number;
  dailyLimit: number;
  claimedToday: number;
  remainingToday: number;
  cooldownMinutes: number;
  nextAvailableAt: string | null;
  canStart: boolean;
  activeSessionId: string | null;
  verificationMode: "server" | "client" | "disabled";
};

type AdsgramResult = { done: boolean; description: string; state: string; error: boolean };
type AdsgramController = { show: () => Promise<AdsgramResult> };

declare global {
  interface Window {
    Adsgram?: { init: (config: { blockId: string; debug?: boolean }) => AdsgramController };
  }
}

export default function TasksPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [adStatus, setAdStatus] = useState<RewardedAdStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adBusy, setAdBusy] = useState(false);
  const [adReady, setAdReady] = useState(() => typeof window !== "undefined" && Boolean(window.Adsgram));
  const [error, setError] = useState<string | null>(null);
  const [adNotice, setAdNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { profile, refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async () => {
    const [missionResult, rewardResult] = await Promise.all([
      apiFetch<{ missions: Mission[] }>("/api/tasks", { cacheMs: 8_000 }),
      apiFetch<RewardedAdStatus>("/api/rewards/ads/status", { cacheMs: 0 }).catch(() => null),
    ]);
    setMissions(missionResult.missions);
    if (rewardResult) setAdStatus(rewardResult);
  }, []);

  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить задания")); }, [load]);
  useEffect(() => {
    if (!adStatus?.nextAvailableAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [adStatus?.nextAvailableAt]);

  async function claim(id: string) {
    setBusy(id); setError(null); haptic("medium");
    try { await apiFetch("/api/tasks/claim", { method: "POST", body: JSON.stringify({ missionId: id }) }); await Promise.all([load(), refreshProfile()]); haptic("heavy"); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось забрать награду"); }
    finally { setBusy(null); }
  }

  async function watchRewardedAd() {
    if (adBusy || !adStatus?.configured) return;
    if (!window.Adsgram) {
      setAdNotice("Рекламная сеть ещё загружается. Попробуй через пару секунд.");
      return;
    }
    setAdBusy(true); setError(null); setAdNotice(null); haptic("light");
    let sessionId: string | null = null;
    let completed = false;
    try {
      const session = await apiFetch<{ sessionId: string; reward: number; expiresAt: string; blockId: string; verificationMode: "server" | "client" }>("/api/rewards/ads/session", { method: "POST" });
      sessionId = session.sessionId;
      const controller = window.Adsgram.init({ blockId: session.blockId });
      const shown = await controller.show();
      if (!shown.done || shown.error) throw new Error("Реклама не была просмотрена до конца");
      completed = true;

      if (session.verificationMode === "server") {
        setAdNotice("Реклама просмотрена. Подтверждаем начисление…");
        let claimedReward: number | null = null;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const claimResult = await apiFetch<{ claimed: boolean; pending: boolean; result?: { reward?: number } }>("/api/rewards/ads/claim", {
            method: "POST",
            body: JSON.stringify({ sessionId: session.sessionId }),
          });
          if (claimResult.claimed) { claimedReward = Number(claimResult.result?.reward ?? session.reward); break; }
          await new Promise((resolve) => window.setTimeout(resolve, 850));
        }
        if (claimedReward == null) {
          setAdNotice("Просмотр принят. Сервер рекламы ещё подтверждает награду — баланс обновится после подтверждения.");
        } else {
          setAdNotice(`Начислено ${money(claimedReward)} на виртуальный баланс MXM`);
          haptic("heavy");
        }
      } else {
        const claimResult = await apiFetch<{ claimed: boolean; result?: { reward?: number } }>("/api/rewards/ads/claim", {
          method: "POST",
          body: JSON.stringify({ sessionId: session.sessionId }),
        });
        if (!claimResult.claimed) throw new Error("Награда пока не подтверждена");
        setAdNotice(`Начислено ${money(Number(claimResult.result?.reward ?? session.reward))} на виртуальный баланс MXM`);
        haptic("heavy");
      }
      await Promise.all([load(), refreshProfile()]);
    } catch (cause) {
      if (sessionId && !completed) {
        void apiFetch("/api/rewards/ads/session", { method: "DELETE", body: JSON.stringify({ sessionId }) }).catch(() => undefined);
      }
      const message = cause instanceof Error ? cause.message : typeof cause === "object" && cause && "description" in cause ? String((cause as { description: unknown }).description) : "Реклама не завершена";
      setAdNotice(message);
    } finally {
      setAdBusy(false);
    }
  }

  const claimable = useMemo(() => missions.filter((m) => m.progress >= m.target && !m.claimed), [missions]);
  const available = useMemo(() => missions.filter((m) => !m.claimed).reduce((sum, m) => sum + m.reward, 0), [missions]);
  const nextAt = adStatus?.nextAvailableAt ? new Date(adStatus.nextAvailableAt).getTime() : 0;
  const cooldownLeft = Math.max(0, nextAt - now);
  const cooldownText = cooldownLeft > 0 ? `${Math.ceil(cooldownLeft / 60_000)} мин` : null;
  const adCanStart = Boolean(adStatus?.configured && adStatus.canStart && cooldownLeft <= 0 && adReady && !adBusy);

  return (
    <div className="mx-auto max-w-3xl">
      {adStatus?.configured ? <Script src="https://sad.adsgram.ai/js/sad.min.js" strategy="afterInteractive" onLoad={() => setAdReady(true)} onError={() => setAdNotice("Не удалось загрузить рекламную сеть")} /> : null}

      <div className="mb-5 flex items-end justify-between gap-4 border-b border-[var(--border-soft)] pb-4">
        <div><p className="text-[10px] uppercase tracking-[.16em] text-[var(--muted-2)]">Прогресс</p><h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">Задания и награды</h1></div>
        <div className="text-right"><p className="text-[9px] text-[var(--muted)]">доступно в заданиях</p><p className="mt-1 flex items-center justify-end gap-1 text-[13px] font-semibold"><Gem size={12} className="text-[var(--accent)]" fill="currentColor" />{money(available)}</p></div>
      </div>

      {profile ? <div className="mb-5 flex items-center gap-2.5"><Sparkles size={12} className="text-[var(--accent)]" /><span className="text-[10px] text-[var(--muted)]">Уровень {profile.level}</span><div className="h-[2px] min-w-0 flex-1 overflow-hidden bg-white/[.06]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div><span className="text-[9px] text-[var(--muted)]">{profile.xp} XP</span></div> : null}

      <section className="mxm-reward-ad mb-6">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="mxm-reward-ad-icon"><Eye size={17} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h2 className="text-[13px] font-semibold">Реклама за виртуальные TON</h2><span className="text-[9px] text-[var(--muted-2)]">добровольно</span></div>
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Посмотри рекламу до конца и получи награду после подтверждения рекламной сетью. Это виртуальный баланс MXM, не реальный TON.</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-[var(--muted)]">
              <span className="font-semibold text-[var(--accent)]">+{money(Number(adStatus?.reward || 50))}</span>
              <span>{adStatus ? `${adStatus.remainingToday}/${adStatus.dailyLimit} осталось сегодня` : "проверяем лимит"}</span>
              {cooldownText ? <span>через {cooldownText}</span> : null}
            </div>
          </div>
        </div>
        <button type="button" disabled={!adCanStart} onClick={() => void watchRewardedAd()} className="mxm-reward-ad-button">
          {adBusy ? <span className="animate-pulse">Проверяем…</span> : !adStatus?.configured ? (adStatus?.verificationMode === "disabled" ? "Нужна настройка" : "Не подключено") : adStatus.migrationRequired ? "Нужна миграция" : adStatus.remainingToday <= 0 ? "На сегодня всё" : cooldownText ? `Через ${cooldownText}` : !adReady ? "Загрузка…" : <><Play size={12} fill="currentColor" />Смотреть</>}
        </button>
      </section>
      {adNotice ? <div className="mb-4 border-l-2 border-[var(--accent)] pl-3 text-[10px] leading-4 text-[var(--muted)]">{adNotice}</div> : null}
      {error ? <div className="mxm-alert mxm-alert-error mb-4">{error}</div> : null}

      {(["daily", "onboarding", "weekly"] as MissionPeriod[]).map((period) => {
        const items = missions.filter((mission) => mission.period === period);
        if (!items.length) return null;
        const Icon = sectionMeta[period].icon;
        return (
          <section key={period} className="mb-7">
            <div className="mb-1 flex items-center justify-between border-b border-[var(--border-soft)] py-2.5"><div className="flex items-center gap-2 text-[12px] font-semibold"><Icon size={14} className={period === "daily" ? "text-[#ff855d]" : "text-[var(--muted)]"} />{sectionMeta[period].title}<span className="text-[9px] font-normal text-[var(--muted-2)]">{items.length}</span></div>{period !== "onboarding" ? <span className="flex items-center gap-1 text-[9px] text-[var(--muted-2)]"><Clock3 size={10} />автосброс</span> : null}</div>
            <div>{items.map((mission) => {
              const done = mission.progress >= mission.target;
              const pct = Math.min(100, mission.progress / mission.target * 100);
              return (
                <div key={mission.id} className="mxm-task-row">
                  <div className={`mxm-task-state ${mission.claimed ? "is-done" : done ? "is-ready" : ""}`}>{mission.claimed ? <Check size={13} /> : <Gift size={13} />}</div>
                  <div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-3"><p className="truncate text-[11px] font-medium">{mission.title}</p><span className="shrink-0 text-[9px] text-[var(--muted)]">{mission.progress}/{mission.target}</span></div><p className="mt-1 truncate text-[9px] text-[var(--muted-2)]">{mission.description}</p><div className="mt-2 h-[2px] overflow-hidden bg-white/[.055]"><div className={`h-full ${done ? "bg-[var(--positive)]" : "bg-[var(--accent)]"}`} style={{ width: `${pct}%` }} /></div></div>
                  <div className="shrink-0 text-right"><p className="flex items-center justify-end gap-1 text-[10px] font-semibold text-[var(--accent)]"><Gem size={9} fill="currentColor" />{money(mission.reward)}</p>{done && !mission.claimed ? <button onClick={() => claim(mission.id)} disabled={busy !== null} className="mt-1.5 border-b border-white pb-0.5 text-[9px] font-semibold text-white">{busy === mission.id ? "…" : "Забрать"}</button> : mission.claimed ? <span className="mt-1.5 block text-[9px] text-[var(--positive)]">Получено</span> : null}</div>
                </div>
              );
            })}</div>
          </section>
        );
      })}

      {claimable.length ? <p className="pb-3 text-[9px] text-[var(--muted-2)]">Готово к получению: {claimable.length}</p> : null}
    </div>
  );
}
