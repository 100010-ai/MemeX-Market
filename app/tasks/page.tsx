"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Flame, Gift, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Mission, MissionPeriod } from "@/lib/types";
import { money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";

const sectionMeta: Record<MissionPeriod, { title: string; icon: typeof Gift }> = {
  onboarding: { title: "Starter", icon: Gift },
  daily: { title: "Daily", icon: Flame },
  weekly: { title: "Weekly", icon: Trophy },
};

export default function TasksPage() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  async function load() { const r = await apiFetch<{ missions: Mission[] }>("/api/tasks"); setMissions(r.missions); }
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : "Could not load tasks")); }, []);

  async function claim(id: string) {
    setBusy(id); setError(null); haptic("medium");
    try { await apiFetch("/api/tasks/claim", { method: "POST", body: JSON.stringify({ missionId: id }) }); await Promise.all([load(), refreshProfile()]); haptic("heavy"); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not claim reward"); }
    finally { setBusy(null); }
  }

  const completed = useMemo(() => missions.filter((m) => m.claimed).length, [missions]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex items-center justify-between gap-3"><div><h1 className="text-lg font-semibold">Tasks</h1><p className="mt-0.5 text-xs text-[var(--muted)]">Small rewards keep a broke trader from getting permanently soft-locked.</p></div><div className="rounded-lg bg-[var(--panel-2)] px-3 py-2 text-right"><p className="text-[10px] text-[var(--muted)]">Completed</p><p className="text-sm font-semibold">{completed}/{missions.length}</p></div></div>
      </div>
      {error ? <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--negative)]">{error}</div> : null}
      {(["onboarding", "daily", "weekly"] as MissionPeriod[]).map((period) => {
        const items = missions.filter((m) => m.period === period);
        if (!items.length) return null;
        const Icon = sectionMeta[period].icon;
        return <section key={period} className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--panel)]"><div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-3"><div className="flex items-center gap-2 text-sm font-medium"><Icon size={15} className={period === "daily" ? "text-[#ff754b]" : "text-[var(--accent)]"} />{sectionMeta[period].title}</div>{period !== "onboarding" ? <span className="flex items-center gap-1 text-[10px] text-[var(--muted)]"><Clock3 size={11} /> auto resets</span> : null}</div><div className="divide-y divide-[var(--border-soft)]">{items.map((m) => {
          const done = m.progress >= m.target;
          const pct = Math.min(100, (m.progress / m.target) * 100);
          return <div key={m.id} className="p-3"><div className="flex items-center gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${m.claimed ? "bg-[rgba(40,207,131,.12)] text-[var(--positive)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>{m.claimed ? <Check size={17} /> : <Gift size={17} />}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{m.title}</p><span className="shrink-0 text-[11px] text-[var(--accent)]">◆ {money(m.reward).replace("$", "")}</span></div><p className="mt-0.5 text-[11px] text-[var(--muted)]">{m.description}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} /></div><div className="mt-1 flex items-center justify-between text-[10px] text-[var(--muted)]"><span>{m.progress}/{m.target}</span>{done && !m.claimed ? <button onClick={() => claim(m.id)} disabled={busy !== null} className="rounded-md bg-[var(--accent)] px-2.5 py-1 font-semibold text-black">{busy === m.id ? "Claiming…" : "Claim"}</button> : <span>{m.claimed ? "Claimed" : "In progress"}</span>}</div></div></div></div>;
        })}</div></section>;
      })}
    </div>
  );
}
