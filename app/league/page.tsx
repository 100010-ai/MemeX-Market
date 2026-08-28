"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Clock3, Crown, Shield, Trophy, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";

type Division = { key: string; label: string; floor: number; nextScore: number | null };
type Leader = { id: string; rank: number; name: string; photoUrl: string | null; frame: string | null; score: number; profit: number; tradeVolume: number; tradeCount: number; giftCount: number; activeDays: number; division: Division; isMe: boolean };
type Payload = {
  season: { id: string; title: string; startsAt: string; endsAt: string; daysLeft: number };
  me: { rank: number | null; score: number; tradeVolume: number; tradeCount: number; profit: number; giftCount: number; activeDays: number; gapToNext: number | null; division: Division; nextDivisionScore: number | null; divisionProgress: number };
  leaders: Leader[];
  rewards: Array<Record<string, unknown>>;
  scoring: Record<string, unknown>;
};

const DIVISION_HINT: Record<string, string> = {
  bronze: "Стартовый дивизион",
  silver: "Стабильная активность",
  gold: "Сильный участник рынка",
  diamond: "Верхушка сезона",
  apex: "Максимальный дивизион",
};

export default function LeaguePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiFetch<Payload>("/api/league", { cacheMs: 5_000, dedupe: false }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить лигу");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const nextDivisionText = useMemo(() => {
    if (!data) return "";
    if (data.me.nextDivisionScore == null) return "Максимальный дивизион";
    return `${Math.max(0, Math.ceil(data.me.nextDivisionScore - data.me.score)).toLocaleString("ru-RU")} очков до следующего дивизиона`;
  }, [data]);

  return <div className="mx-auto max-w-5xl">
    <header className="mxm-compact-page-head">
      <div className="min-w-0">
        <p className="text-[8px] uppercase tracking-[.13em] text-[var(--muted-2)]">Соревновательный рынок</p>
        <h1 className="mxm-page-title mt-1">MemeX League</h1>
      </div>
      <div className="shrink-0 text-right"><p className="flex items-center justify-end gap-1 text-[8px] text-[var(--muted)]"><Clock3 size={10} />Осталось</p><p className="mt-0.5 text-[12px] font-semibold">{data?.season.daysLeft ?? "—"} дн.</p></div>
    </header>

    {error ? <div className="mxm-alert mxm-alert-error mb-3 flex items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={() => void load()} className="text-[9px] underline">Повторить</button></div> : null}

    <section className="mxm-summary-card p-4">
      {loading || !data ? <div className="mxm-skeleton h-28 rounded-[14px]" /> : <>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[.12em] text-[var(--muted-2)]"><Shield size={11} />Дивизион</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-.04em]">{data.me.division.label}</h2>
            <p className="mt-1 text-[8px] text-[var(--muted)]">{DIVISION_HINT[data.me.division.key] || "Сезонный дивизион"}</p>
          </div>
          <div className="text-right"><p className="text-[8px] text-[var(--muted)]">Место</p><p className="mt-1 text-[22px] font-semibold">{data.me.rank ? `#${data.me.rank}` : "—"}</p><p className="text-[8px] text-[var(--muted-2)]">{Math.round(data.me.score).toLocaleString("ru-RU")} очков</p></div>
        </div>
        <div className="mt-4"><div className="flex items-center justify-between gap-3 text-[8px] text-[var(--muted)]"><span>{nextDivisionText}</span><span>{Math.round(data.me.divisionProgress)}%</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${data.me.divisionProgress}%` }} /></div></div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-[12px] bg-white/[.025] px-2 py-2"><b className="block text-[11px]">{data.me.activeDays}</b><small className="text-[7px] text-[var(--muted)]">активных дней</small></div><div className="rounded-[12px] bg-white/[.025] px-2 py-2"><b className="block text-[11px]">{data.me.tradeCount}</b><small className="text-[7px] text-[var(--muted)]">сделок</small></div><div className="rounded-[12px] bg-white/[.025] px-2 py-2"><b className="block text-[11px]">{money(data.me.tradeVolume)}</b><small className="text-[7px] text-[var(--muted)]">объём</small></div></div>
      </>}
    </section>

    <section className="mt-3 mxm-card overflow-hidden">
      <div className="mxm-section-head"><div className="flex items-center gap-2"><Trophy size={14} className="text-[var(--accent)]" /><span>Таблица сезона</span></div><span className="text-[8px] text-[var(--muted)]">Top 100</span></div>
      {loading ? <div className="space-y-1.5 p-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="mxm-skeleton h-12 rounded-[12px]" />)}</div> : data?.leaders.length ? <div className="divide-y divide-[var(--border-soft)] px-3">{data.leaders.map((player) => <Link href={`/u/${player.id}`} key={player.id} className={`grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 py-3 ${player.isMe ? "bg-white/[.018]" : ""}`}>
        <span className={`text-center text-[9px] font-semibold ${player.rank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>#{player.rank}</span>
        <div className="min-w-0"><p className="truncate text-[10px] font-medium">{player.name}{player.isMe ? " · вы" : ""}</p><p className="mt-0.5 flex items-center gap-1.5 text-[7px] text-[var(--muted)]"><span>{player.division.label}</span><span>·</span><span>{player.activeDays} дн.</span><span>·</span><span>{player.tradeCount} сделок</span></p></div>
        <div className="text-right"><p className="text-[10px] font-semibold">{Math.round(player.score).toLocaleString("ru-RU")}</p><p className={`mt-0.5 text-[7px] ${player.profit >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{player.profit >= 0 ? "+" : ""}{money(player.profit)}</p></div>
      </Link>)}</div> : <div className="px-3 py-8 text-center text-[9px] text-[var(--muted)]">В этом сезоне ещё нет участников.</div>}
    </section>

    <section className="mt-3 grid gap-2 sm:grid-cols-2">
      <div className="mxm-card p-3"><div className="flex items-center gap-2"><Activity size={13} className="text-[var(--accent)]" /><h2 className="text-[10px] font-medium">Как начисляются очки</h2></div><p className="mt-2 text-[8px] leading-4 text-[var(--muted)]">Система учитывает объём, сделки, прибыль, разные активы и активные дни. Дневные лимиты режут бессмысленную накрутку одной и той же операции.</p></div>
      <Link href="/market" className="mxm-card flex items-center gap-3 p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-white/[.035]"><Users size={14} /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-medium">Поднять дивизион</p><p className="mt-0.5 text-[8px] text-[var(--muted)]">Торгуйте разными активами и возвращайтесь в разные дни.</p></div><ArrowUpRight size={13} className="text-[var(--muted)]" /></Link>
    </section>

    {data?.me.division.key === "apex" ? <div className="mt-3 mxm-alert mxm-success-pop"><Crown size={13} />Apex достигнут. Дальше идёт борьба только за место в сезоне.</div> : null}
  </div>;
}
