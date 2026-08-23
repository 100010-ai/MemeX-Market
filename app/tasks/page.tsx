"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleCheckBig, Clock3, ExternalLink, Flame, Gem, Gift, RadioTower, RefreshCw, Sparkles, TicketCheck, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Mission, MissionPeriod } from "@/lib/types";
import { money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";

const sectionMeta: Record<MissionPeriod, { title: string; icon: typeof Gift }> = {
  onboarding: { title: "Старт", icon: Gift },
  daily: { title: "Сегодня", icon: Flame },
  weekly: { title: "Неделя", icon: Trophy },
};

export default function TasksPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [promoCode, setPromoCode] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [channelBusy, setChannelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { profile, refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async () => {
    const result = await apiFetch<{ missions: Mission[] }>("/api/tasks", { cacheMs: 8_000 });
    setMissions(result.missions);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ missions: Mission[] }>("/api/tasks", { cacheMs: 8_000 })
      .then((result) => { if (!cancelled) setMissions(result.missions); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить задания"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load().catch(() => undefined); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  async function claim(id: string) {
    setBusy(id);
    setError(null);
    haptic("medium");
    try {
      await apiFetch("/api/tasks/claim", { method: "POST", body: JSON.stringify({ missionId: id }) });
      await Promise.all([load(), refreshProfile()]);
      haptic("heavy");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось забрать награду");
    } finally {
      setBusy(null);
    }
  }

  async function claimAll() {
    const ready = missions.filter((mission) => mission.progress >= mission.target && !mission.claimed && !mission.rewardRevoked);
    if (!ready.length || busy) return;
    setBusy("all");
    setError(null);
    setNotice(null);
    haptic("medium");
    try {
      const result = await apiFetch<{ claimedCount: number; failedCount: number }>("/api/tasks/claim", { method: "POST", body: JSON.stringify({ action: "claim_all" }) });
      await Promise.all([load(), refreshProfile()]);
      if (result.claimedCount > 0) setNotice(`Получено: ${result.claimedCount}`);
      if (result.failedCount > 0) setError(`${result.failedCount} наград пока недоступно`);
      haptic(result.claimedCount > 0 ? "heavy" : "light");
    } catch (cause) {
      await Promise.allSettled([load(), refreshProfile()]);
      setError(cause instanceof Error ? cause.message : "Не удалось забрать награды");
    } finally {
      setBusy(null);
    }
  }

  function openChannel(url: string) {
    if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  async function verifyChannel() {
    if (channelBusy) return;
    setChannelBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ member: boolean; revokedAt?: string | null; clawbackDue?: number }>("/api/tasks/channel", { method: "POST" });
      if (result.member) {
        setNotice(result.revokedAt ? "Подписка подтверждена, но ранее полученная награда уже была отозвана." : "Подписка подтверждена. Теперь можно забрать награду.");
        haptic("medium");
      } else {
        setError(result.revokedAt ? "Вы отписались после получения награды — бонус отозван." : "Подписка пока не найдена. Подпишитесь на канал и повторите проверку.");
      }
      await Promise.all([load(), refreshProfile()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось проверить подписку");
    } finally {
      setChannelBusy(false);
    }
  }

  async function redeemPromo() {
    const code = promoCode.trim().toUpperCase();
    if (!code || promoBusy) return;
    setPromoBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ result?: { reward?: number } }>("/api/promo", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      const reward = Number(result.result?.reward || 0);
      setPromoCode("");
      setNotice(reward > 0 ? `Промокод активирован: +${money(reward)} TON` : "Промокод активирован");
      await refreshProfile();
      haptic("heavy");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось активировать промокод");
    } finally {
      setPromoBusy(false);
    }
  }

  const claimable = useMemo(() => missions.filter((mission) => mission.progress >= mission.target && !mission.claimed), [missions]);
  const available = useMemo(() => missions.filter((mission) => !mission.claimed).reduce((sum, mission) => sum + mission.reward, 0), [missions]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-4 border-b border-[var(--border-soft)] pb-3">
        <h1 className="text-[20px] font-semibold tracking-[-.035em]">Задания</h1>
        <div className="text-right"><p className="flex items-center justify-end gap-1 text-[13px] font-semibold"><Gem size={12} className="text-[var(--accent)]" fill="currentColor" />{money(available)}</p>{claimable.length ? <button type="button" disabled={busy !== null || channelBusy} onClick={() => void claimAll()} className="mt-1 text-[8px] font-semibold text-[var(--accent)] disabled:opacity-40">{busy === "all" ? "Получаем…" : `Забрать · ${claimable.length}`}</button> : null}</div>
      </div>

      {profile ? <div className="mb-5 flex items-center gap-2.5"><Sparkles size={12} className="text-[var(--accent)]" /><span className="text-[10px] text-[var(--muted)]">Уровень {profile.level}</span><div className="h-[2px] min-w-0 flex-1 overflow-hidden bg-white/[.06]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div><span className="text-[9px] text-[var(--muted)]">{profile.xp} опыта</span></div> : null}
      {error ? <div className="mxm-alert mxm-alert-error mb-4">{error}</div> : null}
      {notice ? <div className="mxm-alert mb-4">{notice}</div> : null}

      <section className="mb-7 flex items-center gap-2 border-y border-[var(--border-soft)] py-3">
        <TicketCheck size={14} className="shrink-0 text-[var(--muted)]" />
        <input value={promoCode} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") void redeemPromo(); }} placeholder="Промокод" maxLength={32} className="min-w-0 flex-1 bg-transparent text-[11px] uppercase outline-none placeholder:normal-case placeholder:text-[var(--muted-2)]" />
        <button disabled={!promoCode.trim() || promoBusy} onClick={() => void redeemPromo()} className="text-[9px] font-semibold text-[var(--accent)] disabled:opacity-40">{promoBusy ? "…" : "Активировать"}</button>
      </section>

      {(["daily", "onboarding", "weekly"] as MissionPeriod[]).map((period) => {
        const items = missions.filter((mission) => mission.period === period);
        if (!items.length) return null;
        const Icon = sectionMeta[period].icon;
        return (
          <section key={period} className="mb-7">
            <div className="mb-2 flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2 text-[12px] font-semibold"><Icon size={14} className={period === "daily" ? "text-[#ff855d]" : "text-[var(--muted)]"} />{sectionMeta[period].title}<span className="text-[9px] font-normal text-[var(--muted-2)]">{items.length}</span></div>
              {period !== "onboarding" ? <Clock3 size={11} className="text-[var(--muted-2)]" aria-label="Автосброс" /> : null}
            </div>
            <div className="mxm-task-list">{items.map((mission) => {
              const done = mission.progress >= mission.target;
              const progress = Math.min(100, mission.progress / mission.target * 100);
              const channelTask = mission.actionType === "telegram_channel_subscription";
              const displayTitle = channelTask ? "Подписка на официальный канал" : mission.title;
              const displayDescription = channelTask
                ? "Подпишитесь и подтвердите подписку."
                : mission.description;
              const StateIcon = channelTask ? RadioTower : mission.claimed ? CircleCheckBig : Gift;
              return (
                <article key={mission.id} className={`mxm-task-card ${mission.claimed ? "is-claimed" : done ? "is-ready" : ""}`}>
                  <div className="mxm-task-card-main">
                    <div className={`mxm-task-card-icon ${mission.claimed ? "is-done" : done ? "is-ready" : ""}`}><StateIcon size={16} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 flex-1"><h3 className="text-[12px] font-semibold leading-[1.35] tracking-[-.015em] text-white">{displayTitle}</h3><p className="mt-1 line-clamp-1 text-[9px] leading-[1.5] text-[var(--muted)]">{displayDescription}</p></div>
                        <span className="mxm-task-reward"><Gem size={10} fill="currentColor" />{money(mission.reward)}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-2.5">
                        <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[.055]"><div className={`h-full rounded-full ${mission.claimed || done ? "bg-[var(--positive)]" : "bg-[var(--accent)]"}`} style={{ width: `${progress}%` }} /></div>
                        <span className="shrink-0 text-[9px] tabular-nums text-[var(--muted)]">{mission.progress}/{mission.target}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mxm-task-card-footer">
                    {mission.rewardRevoked ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-[9px] text-[var(--negative)]"><RefreshCw size={11} className="shrink-0" /><span>Награда отозвана{Number(mission.clawbackDue || 0) > 0 ? ` · к удержанию ${money(Number(mission.clawbackDue || 0))}` : ""}</span></div>
                    ) : mission.claimed ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-[9px] text-[var(--positive)]"><Check size={12} /><span>Награда получена</span></div>
                    ) : done ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-[9px] text-[var(--positive)]"><CircleCheckBig size={12} /><span>Задание выполнено</span></div>
                    ) : (
                      <div className="min-w-0 flex-1 text-[9px] text-[var(--muted-2)]">В процессе</div>
                    )}

                    <div className="mxm-task-actions">
                      {channelTask && !mission.claimed ? <button type="button" onClick={() => openChannel(mission.actionUrl || "https://t.me/Meme_X_Market")} className="mxm-task-action-secondary"><ExternalLink size={12} />Открыть канал</button> : null}
                      {channelTask && !mission.claimed ? <button type="button" onClick={() => void verifyChannel()} disabled={channelBusy} className="mxm-task-action-secondary"><RefreshCw size={12} className={channelBusy ? "animate-spin" : ""} />{channelBusy ? "Проверяем…" : "Проверить"}</button> : null}
                      {done && !mission.claimed && !mission.rewardRevoked ? <button type="button" onClick={() => void claim(mission.id)} disabled={busy !== null || channelBusy} className="mxm-task-action-primary">{busy === mission.id ? <RefreshCw size={12} className="animate-spin" /> : <Gift size={12} />}{busy === "all" ? "Получаем…" : "Забрать награду"}</button> : null}
                    </div>
                  </div>
                </article>
              );
            })}</div>
          </section>
        );
      })}

      {claimable.length ? <p className="pb-3 text-[9px] text-[var(--muted-2)]">Готово · {claimable.length}</p> : null}
    </div>
  );
}
