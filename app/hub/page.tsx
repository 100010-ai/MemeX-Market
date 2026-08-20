"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowUpRight, Boxes, LineChart, ListChecks, Trophy } from "lucide-react";
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
        apiFetch<FeedPayload>("/api/feed?limit=20", { cacheMs: 6_000 }),
        apiFetch<LeaderboardPayload>("/api/leaderboard?board=overall&limit=8", { cacheMs: 8_000 }),
      ]);
      setActivity(feed.activity);
      setLeaders(leaderboard.players.slice(0, 8));
      setMeRank(leaderboard.meRank);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить ленту рынка");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const realtimeReload = useCallback(() => { void load(true); }, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <RealtimeRefresh channelName="mxm-hub" tables={realtimeTables} onChange={realtimeReload} />

      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h1 className="text-[15px] font-semibold tracking-[-.02em]">Лента рынка</h1><p className="mt-1 text-[10px] text-[var(--muted)]">Сделки, листинги и лидеры MXM</p></div>
        {meRank !== null ? <Link href="/leaderboard" className="rounded-[15px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-right"><p className="text-[9px] text-[var(--muted)]">Ваше место</p><p className="mt-0.5 text-sm font-semibold text-[var(--accent)]">#{meRank}</p></Link> : null}
      </div>

      <div className="mxm-hscroll mb-4 gap-2 pb-1">
        <QuickLink href="/market" icon={<LineChart size={15} />} label="Маркет" />
        <QuickLink href="/orders" icon={<Activity size={15} />} label="Ордера" />
        <QuickLink href="/tasks" icon={<ListChecks size={15} />} label="Задания" />
        <QuickLink href="/vault" icon={<Boxes size={15} />} label="Портфель" />
        <QuickLink href="/leaderboard" icon={<Trophy size={15} />} label="Рейтинг" />
      </div>

      <div className="mxm-segment mb-3 lg:hidden">
        <button onClick={() => setSection("feed")} className={`mxm-segment-button ${section === "feed" ? "is-active" : ""}`}>Лента</button>
        <button onClick={() => setSection("leaders")} className={`mxm-segment-button ${section === "leaders" ? "is-active" : ""}`}>Рейтинг</button>
      </div>

      {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${section === "feed" ? "block" : "hidden"} mxm-card overflow-hidden lg:block`}>
          <div className="mxm-section-head"><div className="flex items-center gap-2"><Activity size={15} className="text-[var(--accent)]" /><span>Сейчас на рынке</span></div><span>{activity.length ? `${activity.length} событий` : ""}</span></div>
          {loading ? <RowsSkeleton count={8} /> : activity.length ? (
            <div className="divide-y divide-[var(--border-soft)] px-3">
              {activity.map((item) => (
                <Link key={item.id} href={item.href} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3.5 transition hover:opacity-90">
                  <div className="min-w-0"><p className="truncate text-[11px]"><span className="text-[var(--muted)]">{item.label}</span> <span className="font-medium text-white">{item.detail}</span></p><p className="mt-1 text-[9px] text-[var(--muted-2)]">{ago(item.createdAt)}</p></div>
                  <div className="flex items-center gap-2"><span className="text-right text-[11px] font-medium">{item.amount == null ? activityKind(item.kind) : money(item.amount)}</span><ArrowUpRight size={13} className="text-[var(--muted-2)]" /></div>
                </Link>
              ))}
            </div>
          ) : <Empty text="Событий пока нет" />}
        </section>

        <section className={`${section === "leaders" ? "block" : "hidden"} mxm-card overflow-hidden lg:block`}>
          <div className="mxm-section-head"><div className="flex items-center gap-2"><Trophy size={15} className="text-[var(--accent)]" /><span>Рейтинг</span></div><Link href="/leaderboard" className="hover:text-white">Все</Link></div>
          {loading ? <RowsSkeleton count={6} /> : leaders.length ? (
            <div className="divide-y divide-[var(--border-soft)] px-3">
              {leaders.map((player) => (
                <Link href={`/u/${player.id}`} key={player.id} className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 py-3.5">
                  <span className={`text-center text-[10px] font-semibold ${player.rank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>#{player.rank}</span>
                  <div className="min-w-0"><p className="truncate text-[11px] font-medium">{player.name}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{player.giftCount} подарков · {player.coinTrades + player.giftTrades} сделок</p></div>
                  <span className="text-[11px] font-semibold">{money(player.netWorth)}</span>
                </Link>
              ))}
            </div>
          ) : <Empty text="Рейтинг пока пуст" />}
        </section>
      </div>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return <Link href={href} className="mxm-quick-link">{icon}<span>{label}</span></Link>;
}
function Empty({ text }: { text: string }) { return <div className="grid min-h-44 place-items-center px-4 text-center text-[11px] text-[var(--muted)]">{text}</div>; }
function RowsSkeleton({ count }: { count: number }) { return <div className="space-y-2 p-3">{Array.from({ length: count }, (_, i) => <div key={i} className="mxm-skeleton h-12 rounded-[14px]" />)}</div>; }
function activityKind(kind: ActivityItem["kind"]) { return kind === "coin" ? "коин" : kind === "gift" ? "подарок" : kind === "launch" ? "запуск" : kind === "listing" ? "лот" : "оффер"; }
