"use client";

import { useEffect, useMemo, useState } from "react";
import { Crown, Gift, LineChart, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money, percent } from "@/lib/format";

type Player = { rank: number; id: string; isMe: boolean; name: string; photoUrl: string | null; balance: number; coinValue: number; giftValue: number; netWorth: number; pnl: number; coinTrades: number; giftTrades: number };

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [metric, setMetric] = useState<"overall" | "gifts" | "coins">("overall");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ players: Player[] }>("/api/leaderboard").then((r) => setPlayers(r.players)).catch((e) => setError(e instanceof Error ? e.message : "Could not load leaderboard")); }, []);
  const sorted = useMemo(() => [...players].sort((a, b) => metric === "gifts" ? b.giftValue - a.giftValue : metric === "coins" ? b.coinValue - a.coinValue : b.netWorth - a.netWorth).map((p, i) => ({ ...p, shownRank: i + 1 })), [players, metric]);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between"><div><h1 className="text-lg font-semibold">Leaderboard</h1><p className="text-xs text-[var(--muted)]">Shared multiplayer economy ranking.</p></div><Trophy size={20} className="text-[var(--accent)]" /></div>
      <div className="mb-3 grid grid-cols-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1"><Tab active={metric === "overall"} onClick={() => setMetric("overall")} icon={<Crown size={13} />} label="Overall" /><Tab active={metric === "gifts"} onClick={() => setMetric("gifts")} icon={<Gift size={13} />} label="Gifts" /><Tab active={metric === "coins"} onClick={() => setMetric("coins")} icon={<LineChart size={13} />} label="Coins" /></div>
      {error ? <div className="rounded-lg bg-[rgba(255,91,104,.08)] p-3 text-xs text-[var(--negative)]">{error}</div> : null}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{sorted.map((p) => {
        const value = metric === "gifts" ? p.giftValue : metric === "coins" ? p.coinValue : p.netWorth;
        return <div key={p.id} className={`grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 ${p.isMe ? "bg-[rgba(255,216,61,.05)]" : ""}`}><div className={`text-center text-xs font-semibold ${p.shownRank <= 3 ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>#{p.shownRank}</div><div className="flex min-w-0 items-center gap-2.5">{p.photoUrl ? <img src={p.photoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--panel-2)] text-xs">{p.name.replace("@", "").slice(0,1).toUpperCase()}</span>}<div className="min-w-0"><p className="truncate text-sm font-medium">{p.name}{p.isMe ? <span className="ml-1.5 text-[10px] text-[var(--accent)]">YOU</span> : null}</p><p className="text-[10px] text-[var(--muted)]">{p.giftTrades} gift · {p.coinTrades} coin trades</p></div></div><div className="text-right"><p className="text-sm font-semibold">{money(value)}</p><p className={`text-[10px] ${p.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(p.pnl)}</p></div></div>;
      })}{!sorted.length && !error ? <p className="p-8 text-center text-sm text-[var(--muted)]">No players yet.</p> : null}</div></div>
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-xs ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{icon}{label}</button>; }
