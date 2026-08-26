"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Award, BarChart3, CalendarDays, Crown, Gift, Sparkles, Trophy } from "lucide-react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { LeagueSnapshot } from "@/lib/types";

const empty: LeagueSnapshot = { season: { id: "", title: "MemeX League", startsAt: "", endsAt: "", daysLeft: 0 }, me: { rank: null, score: 0, tradeVolume: 0, tradeCount: 0, profit: 0, giftCount: 0, activeDays: 0, gapToNext: null }, leaders: [], rewards: [] };

export default function LeaguePage() {
  const [data, setData] = useState<LeagueSnapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void apiFetch<LeagueSnapshot>("/api/league", { cacheMs: 12_000, signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setData(next); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить League"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  const top = useMemo(() => data.leaders.slice(0, 3), [data.leaders]);
  const other = useMemo(() => data.leaders.slice(3), [data.leaders]);
  const nextProgress = data.me.rank && data.me.rank > 1 && data.me.gapToNext != null
    ? Math.max(6, Math.min(94, 100 - Math.min(100, (data.me.gapToNext / Math.max(1, data.me.score + data.me.gapToNext)) * 100))) : 100;

  return <div className="mxm-league-page mx-auto max-w-6xl">
    <header className="mxm-league-hero">
      <div className="min-w-0"><p className="mxm-league-kicker">Сезонный рейтинг</p><h1>MemeX League</h1><p>{data.season.title} · ещё {data.season.daysLeft} дн.</p></div>
      <div className="mxm-league-hero-icon"><Crown size={25} /></div>
    </header>
    {error ? <div className="mxm-alert mxm-alert-error mb-3 flex items-center justify-between gap-3"><span>{error}</span><button onClick={() => setRetry((value) => value + 1)} className="underline">Повторить</button></div> : null}
    <section className="mxm-league-command">
      <div><small>Ваше место</small><strong>{data.me.rank ? `#${data.me.rank}` : "—"}</strong></div>
      <div><small>League Score</small><strong>{Math.round(data.me.score).toLocaleString("ru-RU")}</strong></div>
      <div><small>До следующего</small><strong>{data.me.gapToNext == null ? "—" : `${Math.ceil(data.me.gapToNext)} очк.`}</strong></div>
      <Link href="/missions" className="mxm-league-command-action"><Sparkles size={15} /><span>Задания</span><ArrowUpRight size={13} /></Link>
    </section>
    <section className="mxm-league-progress" aria-label="Прогресс до следующего места"><div className="flex justify-between gap-3 text-[10px]"><span>Прогресс к следующей позиции</span><b>{data.me.rank && data.me.rank > 1 ? `#${data.me.rank - 1}` : "Лидер"}</b></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${nextProgress}%` }} /></div></section>
    <section className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
      <div className="mxm-league-board">
        <div className="mxm-section-head"><span className="flex items-center gap-2"><Trophy size={14} />Топ сезона</span><Link href="/hall-of-fame">Зал славы</Link></div>
        {loading ? <div className="space-y-2 p-3"><div className="mxm-skeleton h-20 rounded-2xl" /><div className="mxm-skeleton h-14 rounded-2xl" /><div className="mxm-skeleton h-14 rounded-2xl" /></div> : top.length ? <><div className="mxm-league-podium">{top.map((player) => <Link key={player.id} href={`/u/${player.id}`} className={`mxm-league-podium-item is-${player.rank}`}><span>#{player.rank}</span><ProfileAvatar photoUrl={player.photoUrl} name={player.name} equippedFrame={player.frame} /><b className="truncate">{player.name}</b><small>{player.profit >= 0 ? "+" : ""}{money(player.profit)}</small></Link>)}</div><div className="divide-y divide-[var(--border-soft)] px-3">{other.map((player) => <Link key={player.id} href={`/u/${player.id}`} className="mxm-league-row"><b>#{player.rank}</b><ProfileAvatar photoUrl={player.photoUrl} name={player.name} equippedFrame={player.frame} size="small" /><span className="min-w-0 flex-1"><strong>{player.name}</strong><small>{player.tradeCount} сделок · {player.giftCount} Gifts</small></span><span className="text-right"><strong>{Math.round(player.score).toLocaleString("ru-RU")}</strong><small className={player.profit >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>{player.profit >= 0 ? "+" : ""}{money(player.profit)}</small></span></Link>)}</div></> : <Empty text="Первый сезон только набирает обороты." />}
      </div>
      <aside className="space-y-3">
        <section className="mxm-league-insight"><div className="mxm-section-head"><span className="flex items-center gap-2"><BarChart3 size={14} />Ваш вклад</span></div><div className="mxm-league-stats"><span><b>{money(data.me.tradeVolume)}</b><small>объём</small></span><span><b>{data.me.tradeCount}</b><small>сделок</small></span><span><b>{data.me.giftCount}</b><small>Gifts</small></span><span><b>{data.me.activeDays}</b><small>дней</small></span></div><p>Рейтинг учитывает торговлю, прибыль, коллекцию и активность. Баланс сам по себе тут не корона.</p></section>
        <section className="mxm-league-insight"><div className="mxm-section-head"><span className="flex items-center gap-2"><Award size={14} />Награды</span></div><div className="space-y-2">{data.rewards.map((reward) => <div className="mxm-league-reward" key={reward.itemKey}><span><Gift size={13} /></span><div><b>Топ {reward.rank}</b><p>{reward.title}</p></div></div>)}</div><p>Только косметика и сезонные кейсы. Рыночный баланс TON не меняется.</p></section>
        <Link href="/missions" className="mxm-league-missions-link"><CalendarDays size={15} /><span><b>Ускорить прогресс</b><small>Рыночные миссии дают MXM и XP</small></span><ArrowUpRight size={14} /></Link>
      </aside>
    </section>
  </div>;
}

function Empty({ text }: { text: string }) { return <div className="p-8 text-center text-xs text-[var(--muted)]">{text}</div>; }
