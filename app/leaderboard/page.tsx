"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Coins, Crown, Gift, LineChart, Trophy, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { LeaderboardPlayer } from "@/lib/types";
import { telegramAvatarProxyUrl } from "@/lib/avatar";

type Board = "overall" | "pnl" | "giftPnl" | "coinPnl" | "gifts" | "coins";
const tabs: { key: Board; label: string; icon: typeof Trophy }[] = [
  { key: "overall", label: "Общий", icon: Crown },
  { key: "pnl", label: "PnL", icon: TrendingUp },
  { key: "giftPnl", label: "Gifts PnL", icon: Gift },
  { key: "coinPnl", label: "Coins PnL", icon: Coins },
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
  const [retryKey, setRetryKey] = useState(0);

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

      <div>
        {loading ? <div className="p-3"><div className="mxm-skeleton h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /></div> : players.length ? (
          <div className="divide-y divide-[var(--border-soft)]">
            {players.map((player) => {
              const value = boardValue(player, board);
              const pnlBoard = board === "pnl" || board === "giftPnl" || board === "coinPnl";
              return <Link href={`/u/${player.id}`} key={player.id} className={`grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 py-3 ${player.isMe ? "border-l-2 border-[var(--accent)] pl-2" : ""}`}>
                <div className={`text-center text-xs font-semibold ${player.rank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>{player.rank}</div>
                <div className="flex min-w-0 items-center gap-2.5">
                  {telegramAvatarProxyUrl(player.photoUrl) ? <Image src={telegramAvatarProxyUrl(player.photoUrl)!} alt="" width={36} height={36} unoptimized className="h-9 w-9 rounded-2xl object-cover" /> : <span className="inline-flex h-9 w-7 items-center justify-center text-xs font-semibold text-[#c8cdd3]">{player.name.replace("@", "").slice(0, 1).toUpperCase()}</span>}
                  <div className="min-w-0"><p className="truncate text-xs font-medium">{player.name}{player.isMe ? <span className="ml-1.5 text-[9px] text-[var(--accent)]">ВЫ</span> : null}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{player.giftCount} подарков · {player.coinTrades + player.giftTrades} сделок</p></div>
                </div>
                <div className="text-right"><p className={`text-xs font-semibold ${pnlBoard ? value >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]" : ""}`}>{value > 0 && pnlBoard ? "+" : ""}{money(value)}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{boardCaption(board)}</p></div>
              </Link>;
            })}
          </div>
        ) : <div className="p-8 text-center text-xs text-[var(--muted)]">Пока пусто.</div>}
      </div>
    </div>
  );
}
