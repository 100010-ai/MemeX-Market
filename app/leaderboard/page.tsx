"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Coins, Crown, Gift, LineChart, Trophy, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { LeaderboardPlayer } from "@/lib/types";

type Board = "overall" | "pnl" | "giftPnl" | "coinPnl" | "gifts" | "coins";
const tabs: { key: Board; label: string; icon: typeof Trophy }[] = [
  { key: "overall", label: "Общий", icon: Crown },
  { key: "pnl", label: "PnL", icon: TrendingUp },
  { key: "giftPnl", label: "PnL подарков", icon: Gift },
  { key: "coinPnl", label: "PnL коинов", icon: Coins },
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
  if (board === "pnl") return "реализованный PnL";
  if (board === "giftPnl") return "PnL подарков";
  if (board === "coinPnl") return "PnL коинов";
  if (board === "gifts") return "стоимость коллекции";
  return "капитализация созданных коинов";
}

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Board>("overall");
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [meRank, setMeRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ players: LeaderboardPlayer[]; meRank: number }>(`/api/leaderboard?board=${board}`)
      .then((result) => { setPlayers(result.players); setMeRank(result.meRank); })
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить рейтинг"))
      .finally(() => setLoading(false));
  }, [board]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div><h1 className="text-base font-semibold">Рейтинг</h1><p className="mt-0.5 text-[11px] text-[var(--muted)]">Глобальный рейтинг рынка MXM</p></div>
        {meRank ? <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-right"><p className="text-[9px] uppercase tracking-wide text-[var(--muted)]">Вы</p><p className="text-sm font-semibold text-[var(--accent)]">#{meRank}</p></div> : null}
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.key} onClick={() => setBoard(tab.key)} className={`flex shrink-0 items-center gap-1.5 rounded-2xl border px-3 py-2 text-[11px] ${board === tab.key ? "border-[#55585e] bg-[var(--panel-3)] text-white" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"}`}><Icon size={13} />{tab.label}</button>;
        })}
      </div>

      {error ? <div className="mb-3 rounded-2xl border border-[#5a3035] bg-[#25191b] px-3 py-2 text-xs text-[#ff9aa4]">{error}</div> : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
        {loading ? <div className="p-3"><div className="mxm-skeleton h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /></div> : players.length ? (
          <div className="divide-y divide-[var(--border-soft)]">
            {players.map((player) => {
              const value = boardValue(player, board);
              const pnlBoard = board === "pnl" || board === "giftPnl" || board === "coinPnl";
              return <Link href={`/u/${player.id}`} key={player.id} className={`grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 active:bg-[var(--panel-2)] ${player.isMe ? "bg-[rgba(255,214,0,.035)]" : ""}`}>
                <div className={`text-center text-xs font-semibold ${player.rank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>{player.rank}</div>
                <div className="flex min-w-0 items-center gap-2.5">
                  {player.photoUrl ? <img src={player.photoUrl} alt="" className="h-9 w-9 rounded-2xl object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--panel-2)] text-xs">{player.name.replace("@", "").slice(0, 1).toUpperCase()}</span>}
                  <div className="min-w-0"><p className="truncate text-xs font-medium">{player.name}{player.isMe ? <span className="ml-1.5 text-[9px] text-[var(--accent)]">ВЫ</span> : null}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{player.giftCount} подарков · {player.coinTrades + player.giftTrades} сделок</p></div>
                </div>
                <div className="text-right"><p className={`text-xs font-semibold ${pnlBoard ? value >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]" : ""}`}>{value > 0 && pnlBoard ? "+" : ""}{money(value)}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{boardCaption(board)}</p></div>
              </Link>;
            })}
          </div>
        ) : <div className="p-10 text-center text-sm text-[var(--muted)]">В рейтинге пока никого нет.</div>}
      </div>
    </div>
  );
}
