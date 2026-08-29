"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Flame, Gauge, Rocket, ShieldCheck, TrendingUp, UsersRound } from "lucide-react";
import { CoinAvatar } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { apiFetch } from "@/lib/api";
import { compact, money, percent, price } from "@/lib/format";
import type { Coin } from "@/lib/types";

type Board = "hot" | "gainers" | "new" | "verified";
type PulseCoin = Coin & { uniqueTraders24h: number; uniqueTradersAll: number; lastTradeAt: string | null; topTraderShareBps: number; heatScore: number; heatTier: string; level: number; levelKey: string; verified: boolean; verificationTier: string | null };
type Payload = { board: Board; coins: PulseCoin[]; totals: { coins: number; volume24h: number; traders24h: number; verified: number } };
const boards: { key: Board; label: string; icon: typeof Flame }[] = [
  { key: "hot", label: "Hot", icon: Flame },
  { key: "gainers", label: "Растут", icon: TrendingUp },
  { key: "new", label: "Новые", icon: Rocket },
  { key: "verified", label: "Verified", icon: BadgeCheck },
];
const realtimeTables = ["coins", "trades", "coin_verifications_v071", "coin_boosts"];

function heatLabel(value: string) { return ({ quiet: "Тихо", moving: "Движение", trending: "Тренд", hot: "Hot", viral: "Viral" } as Record<string,string>)[value] || value; }

export default function MemecoinsPage() {
  const [board, setBoard] = useState<Board>("hot");
  const [data, setData] = useState<Payload>({ board: "hot", coins: [], totals: { coins: 0, volume24h: 0, traders24h: 0, verified: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setData(await apiFetch<Payload>(`/api/memecoins/pulse?board=${board}&limit=48`, { cacheMs: 5_000 })); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить мемкоины"); }
    finally { if (!silent) setLoading(false); }
  }, [board]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const realtimeReload = useCallback(() => { void load(true); }, [load]);

  return <div className="mx-auto max-w-6xl">
    <RealtimeRefresh channelName="mxm-memecoin-pulse-v200" tables={realtimeTables} onChange={realtimeReload} debounceMs={1200} />
    <header className="mb-4"><p className="text-[10px] uppercase tracking-[.13em] text-[var(--muted-2)]">MEMEX Discovery</p><div className="mt-1 flex items-end justify-between gap-3"><div><h1 className="text-lg font-semibold">Memecoin Pulse</h1><p className="mt-1 text-[11px] text-[var(--muted)]">Heat, реальные трейдеры, ликвидность и концентрация вместо одного зелёного процента.</p></div><Link href="/create" className="mxm-primary-action shrink-0"><Rocket size={13} />Создать</Link></div></header>

    <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><TopMetric label="Монет в выборке" value={String(data.totals.coins)} /><TopMetric label="Volume 24h" value={money(data.totals.volume24h)} /><TopMetric label="Trader signals" value={compact(data.totals.traders24h)} /><TopMetric label="Verified" value={String(data.totals.verified)} /></section>
    <div className="mxm-hscroll mb-4 flex gap-2 pb-1">{boards.map((item) => { const Icon=item.icon; return <button key={item.key} onClick={() => setBoard(item.key)} className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[14px] px-3 text-[11px] ${board===item.key?"bg-white text-black":"bg-[var(--panel-2)] text-[var(--muted)]"}`}><Icon size={13} />{item.label}</button>; })}</div>
    {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}

    {loading && !data.coins.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Array.from({length:9},(_,i)=><div key={i} className="mxm-skeleton h-44 rounded-[18px]" />)}</div> : data.coins.length ? <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{data.coins.map((coin) => <Link href={`/coin/${coin.id}`} key={coin.id} className="rounded-[19px] border border-[var(--border)] bg-[var(--panel)] p-3.5 transition hover:border-[var(--border-strong)]">
      <div className="flex items-center gap-2.5"><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} /><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><p className="truncate text-xs font-semibold">{coin.name}</p>{coin.verified ? <BadgeCheck size={12} className="shrink-0 text-[var(--accent)]" /> : null}</div><p className="mt-0.5 text-[9px] text-[var(--muted)]">${coin.symbol} · LVL {coin.level} · {heatLabel(coin.heatTier)}</p></div><div className="text-right"><p className="text-xs font-semibold">{price(coin.currentPrice)}</p><p className={`mt-0.5 text-[9px] ${coin.change24h>=0?"text-[var(--positive)]":"text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></div></div>
      <div className="mt-3 grid grid-cols-3 gap-1.5"><Metric icon={<Flame size={10} />} label="Heat" value={`${coin.heatScore}/100`} /><Metric icon={<UsersRound size={10} />} label="Traders" value={String(coin.uniqueTraders24h)} /><Metric icon={<Gauge size={10} />} label="Liquidity" value={money(coin.liquidity)} /></div>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border-soft)] pt-2.5 text-[9px] text-[var(--muted)]"><span>Cap {money(coin.marketCap)}</span><span>Vol {money(coin.volume24h)}</span><span className={coin.topTraderShareBps>5000?"text-[var(--negative)]":""}>Top trader {(coin.topTraderShareBps/100).toFixed(0)}%</span></div>
      {coin.verified ? <div className="mt-2 flex items-center gap-1 text-[8px] text-[var(--positive)]"><ShieldCheck size={9} />{coin.verificationTier || "verified"}</div> : null}
    </Link>)}</div> : <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-10 text-center text-[11px] text-[var(--muted)]">По этому фильтру пока пусто.</div>}
  </div>;
}
function TopMetric({label,value}:{label:string;value:string}) { return <div className="rounded-[16px] bg-[var(--panel-2)] p-3"><p className="text-[8px] uppercase tracking-[.08em] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function Metric({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) { return <div className="rounded-[13px] bg-[var(--panel-2)] p-2"><p className="flex items-center gap-1 text-[7px] text-[var(--muted)]">{icon}{label}</p><p className="mt-1 truncate text-[10px] font-semibold">{value}</p></div>; }
