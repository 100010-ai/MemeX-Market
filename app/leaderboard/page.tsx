"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crown, Gift, LineChart, Trophy, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { LeaderboardPlayer } from "@/lib/types";

type Board = "overall" | "pnl" | "gifts" | "coins";
const tabs: { key: Board; label: string; icon: typeof Trophy }[] = [
  { key: "overall", label: "Overall", icon: Crown },
  { key: "pnl", label: "PnL", icon: TrendingUp },
  { key: "gifts", label: "Gifts", icon: Gift },
  { key: "coins", label: "Creators", icon: LineChart },
];

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Board>("overall");
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [meRank, setMeRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    apiFetch<{ players: LeaderboardPlayer[]; meRank: number }>(`/api/leaderboard?board=${board}`)
      .then((result) => { setPlayers(result.players); setMeRank(result.meRank); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load leaderboard"))
      .finally(() => setLoading(false));
  }, [board]);

  function value(player: LeaderboardPlayer) {
    if (board === "pnl") return player.realizedPnl;
    if (board === "gifts") return player.giftValue;
    if (board === "coins") return player.createdCoinMarketCap;
    return player.netWorth;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-3"><div><h1 className="text-lg font-semibold">Leaderboard</h1><p className="mt-0.5 text-xs text-[var(--muted)]">Global MXM rankings.</p></div>{meRank ? <div className="rounded-lg bg-[var(--panel-2)] px-3 py-2 text-right"><p className="text-[10px] text-[var(--muted)]">Your rank</p><p className="text-sm font-semibold text-[var(--accent)]">#{meRank}</p></div> : null}</div>
      <div className="mb-3 grid grid-cols-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1">{tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.key} onClick={() => setBoard(tab.key)} className={`flex items-center justify-center gap-1 rounded-lg py-2 text-[11px] ${board === tab.key ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><Icon size={13} /><span className="hidden sm:inline">{tab.label}</span></button>; })}</div>
      {error ? <div className="mb-3 rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-2 text-xs text-[#ff9aa4]">{error}</div> : null}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        {loading ? <div className="p-3"><div className="mxm-skeleton h-14 rounded-lg" /><div className="mxm-skeleton mt-2 h-14 rounded-lg" /><div className="mxm-skeleton mt-2 h-14 rounded-lg" /></div> : players.length ? <div className="divide-y divide-[var(--border-soft)]">{players.map((player) => <Link href={`/u/${player.id}`} key={player.id} className={`grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 hover:bg-[var(--panel-2)] ${player.isMe ? "bg-[rgba(255,214,0,.04)]" : ""}`}><div className={`text-center text-xs font-semibold ${player.rank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>#{player.rank}</div><div className="flex min-w-0 items-center gap-2.5">{player.photoUrl ? <img src={player.photoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--panel-2)] text-xs">{player.name.replace("@", "").slice(0, 1).toUpperCase()}</span>}<div className="min-w-0"><p className="truncate text-sm font-medium">{player.name}{player.isMe ? <span className="ml-1.5 text-[9px] text-[var(--accent)]">YOU</span> : null}</p><p className="text-[10px] text-[var(--muted)]">{player.giftCount} Gifts · {player.coinTrades + player.giftTrades} trades</p></div></div><div className="text-right"><p className={`text-sm font-semibold ${board === "pnl" ? player.realizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]" : ""}`}>{money(value(player))}</p><p className="text-[10px] text-[var(--muted)]">{board === "coins" ? "created cap" : board}</p></div></Link>)}</div> : <div className="p-10 text-center text-sm text-[var(--muted)]">No players yet.</div>}
      </div>
    </div>
  );
}
