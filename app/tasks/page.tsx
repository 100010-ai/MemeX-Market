"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Flame, Gem, Gift, Sparkles, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Mission, MissionPeriod } from "@/lib/types";
import { money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";

const sectionMeta: Record<MissionPeriod, { title: string; icon: typeof Gift }> = {
  onboarding: { title: "Старт", icon: Gift },
  daily: { title: "Горячие", icon: Flame },
  weekly: { title: "Недельные", icon: Trophy },
};

export default function TasksPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { profile, refreshProfile, haptic } = useTelegramProfile();

  async function load() { const result = await apiFetch<{ missions: Mission[] }>("/api/tasks", { cacheMs: 8_000 }); setMissions(result.missions); }
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить задания")); }, []);

  async function claim(id: string) {
    setBusy(id); setError(null); haptic("medium");
    try { await apiFetch("/api/tasks/claim", { method: "POST", body: JSON.stringify({ missionId: id }) }); await Promise.all([load(), refreshProfile()]); haptic("heavy"); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось забрать награду"); }
    finally { setBusy(null); }
  }

  const claimable = useMemo(() => missions.filter((m) => m.progress >= m.target && !m.claimed), [missions]);
  const available = useMemo(() => missions.filter((m) => !m.claimed).reduce((sum, m) => sum + m.reward, 0), [missions]);

  return (
    <div className="mx-auto max-w-3xl">
      <section className="mxm-summary-card mb-3 p-3.5"><div className="flex items-center justify-between gap-3"><p className="text-[11px] font-medium">Награды</p><div className="flex items-center gap-2"><span className="text-[9px] text-[var(--muted)]">{claimable.length} готово</span><p className="flex items-center gap-1 text-xs font-semibold"><Gem size={11} className="text-[var(--accent)]" fill="currentColor" />{money(available)}</p></div></div>{profile ? <div className="mt-2 flex items-center gap-2"><Sparkles size={11} className="text-[var(--accent)]" /><span className="text-[9px] text-[var(--muted)]">Lv.{profile.level}</span><div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div><span className="text-[9px]">{profile.xp} XP</span></div> : null}</section>

      {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}

      {(["daily", "onboarding", "weekly"] as MissionPeriod[]).map((period) => {
        const items = missions.filter((mission) => mission.period === period);
        if (!items.length) return null;
        const Icon = sectionMeta[period].icon;
        return (
          <section key={period} className="mxm-card mb-3 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-2.5"><div className={`flex items-center gap-2 text-sm font-medium ${period === "daily" ? "text-[#ff7648]" : ""}`}><Icon size={15} />{sectionMeta[period].title} <span className="text-xs">({items.length})</span></div>{period !== "onboarding" ? <span className="flex items-center gap-1 text-[10px] text-[var(--muted)]"><Clock3 size={11} />сброс</span> : null}</div>
            <div className="divide-y divide-[var(--border-soft)]">{items.map((mission) => {
              const done = mission.progress >= mission.target;
              const pct = Math.min(100, mission.progress / mission.target * 100);
              return (
                <div key={mission.id} className="p-2.5">
                  <div className="flex items-center gap-3"><div className={`grid h-8 w-8 shrink-0 place-items-center rounded-[13px] ${mission.claimed ? "bg-[rgba(54,201,137,.12)] text-[var(--positive)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>{mission.claimed ? <Check size={14} /> : <Gift size={14} />}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{mission.title}</p><div className="mt-2 flex items-center gap-2"><div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} /></div><span className="shrink-0 text-[10px] text-[var(--muted)]">{mission.progress}/{mission.target}</span></div></div><div className="shrink-0 text-right"><p className="flex items-center justify-end gap-1 text-xs font-semibold text-[var(--accent)]"><Gem size={10} fill="currentColor" />{money(mission.reward)}</p>{done && !mission.claimed ? <button onClick={() => claim(mission.id)} disabled={busy !== null} className="mt-1.5 rounded-[11px] bg-[var(--accent)] px-3 py-1.5 text-[9px] font-semibold text-[#0b0d10]">{busy === mission.id ? "…" : "Забрать"}</button> : mission.claimed ? <span className="mt-1.5 block text-[10px] text-[var(--positive)]">Получено</span> : null}</div></div>
                </div>
              );
            })}</div>
          </section>
        );
      })}
    </div>
  );
}
