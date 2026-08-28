"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, BarChart3, CheckCircle2, ChevronRight, Flame, Gift, ListChecks, Shield, Trophy } from "lucide-react";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { useTelegramProfile } from "@/components/telegram-provider";
import { CoinAvatar } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { ago, money, percent, price } from "@/lib/format";
import type { ActivityItem, Coin, LeaderboardPlayer, Mission } from "@/lib/types";

const realtimeTables = ["coins", "trades", "virtual_gifts", "gift_trades", "market_events", "activity_events_v074"];
type FeedPayload = { activity: ActivityItem[] };
type LeaderboardPayload = { players: LeaderboardPlayer[]; meRank: number };
type CoinPayload = { coins: Coin[] };
type TasksPayload = { missions: Mission[] };
type SeasonPayload = { level: number; xp: number; season: { daysLeft: number } };
type LeaguePayload = { me: { rank: number | null; score: number; division: { key: string; label: string }; divisionProgress: number }; season: { daysLeft: number } };

type Dashboard = {
  activity: ActivityItem[];
  leaders: LeaderboardPlayer[];
  meRank: number | null;
  coins: Coin[];
  missions: Mission[];
  season: SeasonPayload | null;
  league: LeaguePayload | null;
};

const emptyDashboard: Dashboard = { activity: [], leaders: [], meRank: null, coins: [], missions: [], season: null, league: null };

export default function HubPage() {
  const { profile, appReady } = useTelegramProfile();
  const [data, setData] = useState<Dashboard>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [feed, leaderboard, market, tasks, season, league] = await Promise.all([
        apiFetch<FeedPayload>("/api/feed?limit=12", { cacheMs: 8_000 }),
        apiFetch<LeaderboardPayload>("/api/leaderboard?board=overall&limit=5", { cacheMs: 10_000 }),
        apiFetch<CoinPayload>("/api/market?scope=coins&limit=6&compact=1&t=0", { cacheMs: 12_000 }),
        apiFetch<TasksPayload>("/api/tasks", { cacheMs: 8_000 }),
        apiFetch<SeasonPayload>("/api/season", { cacheMs: 15_000 }).catch(() => null),
        apiFetch<LeaguePayload>("/api/league", { cacheMs: 10_000 }).catch(() => null),
      ]);
      setData({
        activity: feed.activity.slice(0, 8),
        leaders: leaderboard.players.slice(0, 5),
        meRank: Number.isFinite(leaderboard.meRank) ? leaderboard.meRank : null,
        coins: market.coins.slice(0, 6),
        missions: tasks.missions,
        season,
        league,
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить обзор");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!appReady) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [appReady, load]);

  const realtimeReload = useCallback(() => { void load(true); }, [load]);
  const readyMissions = useMemo(() => data.missions.filter((mission) => !mission.claimed && !mission.rewardRevoked && mission.progress >= mission.target), [data.missions]);
  const activeMissions = useMemo(() => data.missions.filter((mission) => !mission.claimed && !mission.rewardRevoked).slice(0, 3), [data.missions]);
  const hotCoins = useMemo(() => [...data.coins].sort((a, b) => (b.volume24h + Math.max(0, b.change24h) * 2) - (a.volume24h + Math.max(0, a.change24h) * 2)).slice(0, 3), [data.coins]);

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName="mxm-hub-v0740" tables={realtimeTables} onChange={realtimeReload} debounceMs={2_000} />

      <header className="mxm-home-hero mb-3">
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-[.13em] text-[var(--muted-2)]">MXM сегодня</p>
          <h1 className="mt-1 truncate text-[18px] font-semibold tracking-[-.035em]">{profile?.firstName || "Рынок"}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data.league ? <Link href="/league" className="mxm-home-status"><Shield size={11} /><span>{data.league.me.division.label}{data.league.me.rank ? ` · #${data.league.me.rank}` : ""}</span></Link> : null}
          {data.season ? <Link href="/season" className="mxm-home-status"><Flame size={11} /><span>BP {data.season.level}</span></Link> : null}
        </div>
      </header>

      {error ? <div className="mxm-alert mxm-alert-error mb-3 flex items-center justify-between gap-3"><span className="truncate">{error}</span><button type="button" onClick={() => void load()} className="shrink-0 text-[9px] underline">Повторить</button></div> : null}

      <section className="mxm-home-grid mb-3">
        <Link href="/market" className="mxm-home-tile is-market">
          <span className="mxm-home-tile-icon"><BarChart3 size={16} /></span>
          <div className="min-w-0"><small>Рынок</small><p>{hotCoins.length ? `${hotCoins.length} в тренде` : "Открыть"}</p></div>
          <ChevronRight size={14} />
        </Link>
        <Link href="/league" className="mxm-home-tile">
          <span className="mxm-home-tile-icon"><Shield size={16} /></span>
          <div className="min-w-0"><small>Лига</small><p>{data.league ? `${data.league.me.division.label}${data.league.me.rank ? ` · #${data.league.me.rank}` : ""}` : "Открыть"}</p></div>
          <ChevronRight size={14} />
        </Link>
        <Link href="/tasks" className="mxm-home-tile">
          <span className="mxm-home-tile-icon"><ListChecks size={16} /></span>
          <div className="min-w-0"><small>Задания</small><p>{readyMissions.length ? `${readyMissions.length} готово` : `${activeMissions.length} активно`}</p></div>
          <ChevronRight size={14} />
        </Link>
        <Link href="/vault" className="mxm-home-tile">
          <span className="mxm-home-tile-icon"><Gift size={16} /></span>
          <div className="min-w-0"><small>Портфель</small><p>{profile ? money(profile.netWorth) : "—"}</p></div>
          <ChevronRight size={14} />
        </Link>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]">
        <div className="space-y-3">
          <section className="mxm-card overflow-hidden">
            <div className="mxm-section-head"><div className="flex items-center gap-2"><Flame size={14} className="text-[var(--accent)]" /><span>В движении</span></div><Link href="/market?tab=coins" className="text-[8px] text-[var(--muted)]">Все</Link></div>
            {loading ? <RowsSkeleton count={3} /> : hotCoins.length ? <div className="divide-y divide-[var(--border-soft)] px-3">{hotCoins.map((coin) => <Link key={coin.id} href={`/coin/${coin.id}`} className="mxm-home-coin-row">
              <CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} />
              <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium">{coin.name} <span className="text-[var(--muted)]">${coin.symbol}</span></p><p className="mt-0.5 text-[8px] text-[var(--muted-2)]">{coin.tradeCount24h} сделок · {coin.holderCount} держ.</p></div>
              <div className="text-right"><p className="text-[10px] font-semibold">{price(coin.currentPrice)}</p><p className={`mt-0.5 text-[8px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></div>
            </Link>)}</div> : <CompactEmpty text="Пока тихо" />}
          </section>

          <section className="mxm-card overflow-hidden">
            <div className="mxm-section-head"><div className="flex items-center gap-2"><Activity size={14} className="text-[var(--accent)]" /><span>Последние события</span></div><Link href="/market?mode=feed" className="text-[8px] text-[var(--muted)]">Лента</Link></div>
            {loading ? <RowsSkeleton count={4} /> : data.activity.length ? <div className="divide-y divide-[var(--border-soft)] px-3">{data.activity.slice(0, 5).map((item) => <Link key={item.id} href={item.href} className="mxm-home-activity-row">
              <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium">{item.detail}</p><p className="mt-0.5 text-[8px] text-[var(--muted-2)]">{item.label} · {ago(item.createdAt)}</p></div>
              {item.amount != null ? <span className="shrink-0 text-[9px] font-medium">{money(item.amount)}</span> : <ArrowUpRight size={12} className="text-[var(--muted-2)]" />}
            </Link>)}</div> : <CompactEmpty text="Событий пока нет" />}
          </section>
        </div>

        <div className="space-y-3">
          <section className="mxm-card overflow-hidden">
            <div className="mxm-section-head"><div className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[var(--accent)]" /><span>На сегодня</span></div>{readyMissions.length ? <span className="text-[8px] text-[var(--positive)]">{readyMissions.length} готово</span> : null}</div>
            {loading ? <RowsSkeleton count={3} /> : activeMissions.length ? <div className="divide-y divide-[var(--border-soft)] px-3">{activeMissions.map((mission) => {
              const progress = mission.target > 0 ? Math.min(100, Math.max(0, (mission.progress / mission.target) * 100)) : 0;
              const ready = mission.progress >= mission.target;
              return <Link href="/tasks" key={mission.id} className="block py-3"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[10px] font-medium">{mission.title}</p><span className={`text-[8px] ${ready ? "text-[var(--positive)]" : "text-[var(--muted)]"}`}>{ready ? "Готово" : `${Math.floor(progress)}%`}</span></div><div className="mt-2 h-[2px] overflow-hidden rounded-full bg-white/[.05]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${progress}%` }} /></div></Link>;
            })}</div> : <CompactEmpty text="Все задания закрыты" />}
          </section>

          <section className="mxm-card overflow-hidden">
            <div className="mxm-section-head"><div className="flex items-center gap-2"><Trophy size={14} className="text-[var(--accent)]" /><span>Топ рынка</span></div><Link href="/leaderboard" className="text-[8px] text-[var(--muted)]">Все</Link></div>
            {loading ? <RowsSkeleton count={4} /> : data.leaders.length ? <div className="divide-y divide-[var(--border-soft)] px-3">{data.leaders.slice(0, 4).map((player) => <Link href={`/u/${player.id}`} key={player.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 py-2.5"><span className={`text-center text-[9px] font-semibold ${player.rank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>#{player.rank}</span><p className="truncate text-[10px] font-medium">{player.name}</p><span className="text-[9px] font-semibold">{money(player.netWorth)}</span></Link>)}</div> : <CompactEmpty text="Рейтинг пуст" />}
          </section>
        </div>
      </div>
    </div>
  );
}

function CompactEmpty({ text }: { text: string }) { return <div className="px-3 py-7 text-center text-[9px] text-[var(--muted)]">{text}</div>; }
function RowsSkeleton({ count }: { count: number }) { return <div className="space-y-1.5 p-3">{Array.from({ length: count }, (_, i) => <div key={i} className="mxm-skeleton h-11 rounded-[12px]" />)}</div>; }
