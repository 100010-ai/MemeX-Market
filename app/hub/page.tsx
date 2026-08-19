"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowUpRight, Dices, Gift, LineChart, ListChecks, Trophy } from "lucide-react";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { apiFetch } from "@/lib/api";
import { ago, money } from "@/lib/format";
import type { ActivityItem, LeaderboardPlayer } from "@/lib/types";

const realtimeTables = ["coins", "trades", "virtual_gifts", "gift_trades", "market_events"];

type FeedPayload = { activity: ActivityItem[] };
type LeaderboardPayload = { players: LeaderboardPlayer[]; meRank: number };

export default function HubPage() {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [leaders, setLeaders] = useState<LeaderboardPlayer[]>([]);
  const [meRank, setMeRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<"feed" | "leaders">("feed");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [feed, leaderboard] = await Promise.all([
        apiFetch<FeedPayload>("/api/feed?limit=30"),
        apiFetch<LeaderboardPayload>("/api/leaderboard?board=overall"),
      ]);
      setActivity(feed.activity);
      setLeaders(leaderboard.players.slice(0, 8));
      setMeRank(leaderboard.meRank);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить хаб рынка");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const realtimeReload = useCallback(() => { void load(true); }, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <RealtimeRefresh channelName="mxm-hub" tables={realtimeTables} onChange={realtimeReload} />

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">Хаб рынка</h1>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Живая активность MXM и глобальный рейтинг.</p>
        </div>
        {meRank !== null ? <Link href="/leaderboard" className="border-l border-[var(--border-soft)] pl-3 text-right"><p className="text-[10px] text-[var(--muted)]">Ваше место</p><p className="text-sm font-semibold text-[var(--accent)]">#{meRank}</p></Link> : null}
      </div>

      <div className="mxm-hscroll mb-3 gap-1.5 pb-1">
        <QuickLink href="/market" icon={<LineChart size={15} />} label="Торговать" detail="Мемкоины и подарки" />
        <QuickLink href="/tasks" icon={<ListChecks size={15} />} label="Задания" detail="Получать награды" />
        <QuickLink href="/vault" icon={<Gift size={15} />} label="Хранилище" detail="Ваши активы" />
        <QuickLink href="/games" icon={<Dices size={15} />} label="Игры" detail="Только виртуальный TON" />
      </div>

      <div className="mxm-hscroll mb-3 gap-4 border-b border-[var(--border-soft)] lg:hidden">
        <button onClick={() => setSection("feed")} className={`shrink-0 border-b px-1 py-2 text-[10px] ${section === "feed" ? "border-white text-white" : "border-transparent text-[var(--muted)]"}`}>Лента рынка</button>
        <button onClick={() => setSection("leaders")} className={`shrink-0 border-b px-1 py-2 text-[10px] ${section === "leaders" ? "border-white text-white" : "border-transparent text-[var(--muted)]"}`}>Топ трейдеров</button>
      </div>

      {error ? <div className="mb-3 rounded-2xl border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${section === "feed" ? "block" : "hidden"} lg:block`}>
          <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Activity size={15} className="text-[var(--accent)]" />Рынок онлайн</div>
            <span className="text-[10px] text-[var(--muted)]">В реальном времени</span>
          </div>
          {loading ? <RowsSkeleton count={8} /> : activity.length ? (
            <div className="divide-y divide-[var(--border-soft)]">
              {activity.map((item) => (
                <Link key={item.id} href={item.href} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs"><span className="text-[#c8cbd0]">{item.label}</span> <span className="font-medium text-white">{item.detail}</span></p>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">{ago(item.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-right text-xs font-medium">{item.amount == null ? activityKind(item.kind) : money(item.amount)}</span>
                    <ArrowUpRight size={13} className="text-[var(--muted)]" />
                  </div>
                </Link>
              ))}
            </div>
          ) : <Empty text="Активности на рынке пока нет." />}
        </section>

        <section className={`${section === "leaders" ? "block" : "hidden"} lg:block`}>
          <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Trophy size={15} className="text-[var(--accent)]" />Топ трейдеров</div>
            <Link href="/leaderboard" className="text-[10px] text-[var(--muted)] hover:text-white">Смотреть все</Link>
          </div>
          {loading ? <RowsSkeleton count={6} /> : leaders.length ? (
            <div className="divide-y divide-[var(--border-soft)]">
              {leaders.map((player) => (
                <Link href={`/u/${player.id}`} key={player.id} className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 py-3">
                  <span className={`text-center text-[11px] font-semibold ${player.rank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>#{player.rank}</span>
                  <div className="min-w-0"><p className="truncate text-xs font-medium">{player.name}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{player.giftCount} подарков · {player.coinTrades + player.giftTrades} сделок</p></div>
                  <span className="text-xs font-semibold">{money(player.netWorth)}</span>
                </Link>
              ))}
            </div>
          ) : <Empty text="В рейтинге пока никого нет." />}
        </section>
      </div>
    </div>
  );
}

function QuickLink({ href, icon, label, detail }: { href: string; icon: React.ReactNode; label: string; detail: string }) {
  return <Link href={href} className="w-[148px] shrink-0 border-b border-[var(--border-soft)] py-2.5 hover:border-[#444b52]"><div className="flex items-center gap-1.5 text-xs font-medium">{icon}{label}</div><p className="mt-1 text-[10px] text-[var(--muted)]">{detail}</p></Link>;
}
function Empty({ text }: { text: string }) { return <div className="grid min-h-40 place-items-center px-4 text-center text-xs text-[var(--muted)]">{text}</div>; }
function RowsSkeleton({ count }: { count: number }) { return <div className="space-y-2 p-3">{Array.from({ length: count }, (_, i) => <div key={i} className="mxm-skeleton h-12 rounded-2xl" />)}</div>; }

function activityKind(kind: ActivityItem["kind"]) {
  return kind === "coin" ? "КОИН" : kind === "gift" ? "ПОДАРОК" : kind === "launch" ? "ЗАПУСК" : kind === "listing" ? "ЛОТ" : "ОФФЕР";
}
