"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Coins, Crown, Gift, LineChart, Trophy, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { LeaderboardPlayer } from "@/lib/types";
import { ProfileAvatar } from "@/components/profile-avatar";

type Board = "overall" | "pnl" | "giftPnl" | "coinPnl" | "gifts" | "coins";
const tabs: { key: Board; label: string; icon: typeof Trophy }[] = [
  { key: "overall", label: "Общий", icon: Crown },
  { key: "pnl", label: "Прибыль", icon: TrendingUp },
  { key: "giftPnl", label: "Подарки", icon: Gift },
  { key: "coinPnl", label: "Мемкоины", icon: Coins },
  { key: "gifts", label: "Коллекция", icon: Trophy },
  { key: "coins", label: "Создатели", icon: LineChart },
];

function boardValue(player: LeaderboardPlayer, board: Board) {
  if (board === "pnl") return player.realizedPnl;
  if (board === "giftPnl") return player.giftRealizedPnl;
  if (board === "coinPnl") return player.coinRealizedPnl;
  if (board === "gifts") return player.giftValue;
  if (board === "coins") return player.createdCoinMarketCap;
  return player.netWorth;
}

function boardCaption(board: Board) {
  if (board === "overall") return "капитал";
  if (board === "pnl") return "реализованная прибыль";
  if (board === "giftPnl") return "прибыль по подаркам";
  if (board === "coinPnl") return "прибыль по мемкоинам";
  if (board === "gifts") return "стоимость коллекции";
  return "капитализация созданных мемкоинов";
}

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Board>(() => {
    if (typeof window === "undefined") return "overall";
    const saved = window.sessionStorage.getItem("mxm-leaderboard-board");
    return tabs.some((item) => item.key === saved) ? saved as Board : "overall";
  });
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [meRank, setMeRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    window.sessionStorage.setItem("mxm-leaderboard-board", board);
  }, [board]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void apiFetch<{ players: LeaderboardPlayer[]; meRank: number | null }>(`/api/leaderboard?board=${board}`, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) {
            setPlayers(result.players);
            setMeRank(result.meRank);
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить рейтинг");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [board, retryKey]);

  const podium = useMemo(() => players.slice(0, 3), [players]);
  const meInList = players.some((player) => player.isMe);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-sm font-semibold">Рейтинг</h1>
        {meRank ? <div className="border-l border-[var(--border-soft)] pl-3 text-right"><p className="text-[9px] uppercase tracking-wide text-[var(--muted)]">Вы</p><p className="text-sm font-semibold text-[var(--accent)]">#{meRank}</p></div> : null}
      </div>

      <div className="mxm-hscroll mb-3 flex gap-1.5 pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.key} onClick={() => setBoard(tab.key)} className={`flex shrink-0 items-center gap-1.5 border-b px-1.5 py-2 text-[10px] ${board === tab.key ? "border-white text-white" : "border-transparent text-[var(--muted)]"}`}><Icon size={13} />{tab.label}</button>;
        })}
      </div>

      {error ? <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[#5a3035] bg-[#25191b] px-3 py-2 text-xs text-[#ff9aa4]"><span>{error}</span><button type="button" className="shrink-0 underline" onClick={() => setRetryKey((value) => value + 1)}>Повторить</button></div> : null}

      {!loading && podium.length ? <div className="mxm-leader-podium mb-2">{podium.map((player) => <Link href={`/u/${player.id}`} key={`podium:${player.id}`} className={`mxm-leader-podium-item is-rank-${Math.min(3, player.rank)}`}><span className="mxm-leader-podium-rank">#{player.rank}</span><ProfileAvatar photoUrl={player.photoUrl} name={player.name} equippedFrame={player.equippedFrame} /><span className="min-w-0"><b className="block truncate text-[9px]">{player.name}</b><small>{money(boardValue(player, board))}</small></span></Link>)}</div> : null}

      <div>
        {loading ? <div className="p-3"><div className="mxm-skeleton h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /></div> : players.length ? (
          <div className="divide-y divide-[var(--border-soft)]">
            {players.map((player) => {
              const value = boardValue(player, board);
              const pnlBoard = board === "pnl" || board === "giftPnl" || board === "coinPnl";
              return <Link href={`/u/${player.id}`} key={player.id} className={`grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 py-3 ${player.isMe ? "border-l-2 border-[var(--accent)] pl-2" : ""}`}>
                <div className={`text-center text-xs font-semibold ${player.rank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>{player.rank}</div>
                <div className="flex min-w-0 items-center gap-2.5">
                  <ProfileAvatar photoUrl={player.photoUrl} name={player.name} equippedFrame={player.equippedFrame} />
                  <div className="min-w-0"><p className="truncate text-xs font-medium">{player.name}{player.isMe ? <span className="ml-1.5 text-[9px] text-[var(--accent)]">ВЫ</span> : null}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{player.giftCount} подарков · {player.coinTrades + player.giftTrades} сделок</p></div>
                </div>
                <div className="text-right"><p className={`text-xs font-semibold ${pnlBoard ? value >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]" : ""}`}>{value > 0 && pnlBoard ? "+" : ""}{money(value)}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{boardCaption(board)}</p></div>
              </Link>;
            })}
          </div>
        ) : <div className="p-8 text-center text-xs text-[var(--muted)]">Пока пусто.</div>}
      </div>
      {!loading && meRank && !meInList ? <div className="mxm-leader-me-pin"><span>Ваша позиция</span><b>#{meRank}</b><small>{boardCaption(board)}</small></div> : null}
    </div>
  );
}
