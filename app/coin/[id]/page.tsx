"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Users } from "lucide-react";
import { CoinChart } from "@/components/coin-chart";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { ago, compact, money, percent, price } from "@/lib/format";
import type { Candle, Coin, Trade } from "@/lib/types";

const realtimeTables = ["coins", "trades"];
type Payload = { coin: Coin; candles: Candle[]; trades: Trade[]; holding: { quantity: number; costBasis: number }; balance: number; availableBalance: number; reservedBalance: number; topHolders: { id: string; name: string; quantity: number }[] };

export default function CoinPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async () => {
    try { setData(await apiFetch<Payload>(`/api/coins/${id}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load coin"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const realtimeReload = useCallback(() => { void load(); }, [load]);

  const max = useMemo(() => side === "buy" ? data?.availableBalance || 0 : data?.holding.quantity || 0, [data, side]);

  async function trade() {
    const numeric = Number(amount);
    if (!data || !Number.isFinite(numeric) || numeric <= 0) return;
    setBusy(true); setError(null); haptic("medium");
    try {
      await apiFetch("/api/trade", { method: "POST", body: JSON.stringify({ coinId: id, side, amount: numeric }) });
      setAmount("");
      await Promise.all([load(), refreshProfile()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Trade failed"); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="mx-auto max-w-6xl"><div className="mxm-skeleton h-[520px] rounded-xl" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  const { coin } = data;
  const holdingValue = data.holding.quantity * coin.currentPrice;
  const holdingPnl = holdingValue - data.holding.costBasis;

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName={`mxm-coin-${id}`} tables={realtimeTables} onChange={realtimeReload} />
      <Link href="/market" className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-white"><ArrowLeft size={15} />Market</Link>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-3">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="flex items-center gap-3"><CoinAvatar symbol={coin.symbol} size="lg" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="truncate text-lg font-semibold">{coin.name}</h1><span className="text-xs text-[var(--muted)]">${coin.symbol}</span></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-base font-semibold">{price(coin.currentPrice)}</span><span className={`text-xs ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</span>{coin.creatorId ? <Link href={`/u/${coin.creatorId}`} className="text-[11px] text-[var(--muted)] hover:text-white">by {coin.creatorName}</Link> : null}</div></div></div>
            {coin.description ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{coin.description}</p> : null}
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"><CoinChart candles={data.candles} height={360} /></section>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Market cap" value={money(coin.marketCap)} /><Stat label="24h volume" value={money(coin.volume24h)} /><Stat label="Holders" value={String(coin.holderCount)} /><Stat label="24h trades" value={String(coin.tradeCount24h)} /></div>

          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-3 text-xs font-medium">Recent trades</div>{data.trades.length ? <div className="divide-y divide-[var(--border-soft)]">{data.trades.map((trade) => <div key={trade.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5"><div className="flex min-w-0 items-center gap-2">{trade.side === "buy" ? <ArrowDownLeft size={14} className="text-[var(--positive)]" /> : <ArrowUpRight size={14} className="text-[var(--negative)]" />}<Link href={`/u/${trade.traderId}`} className="truncate text-xs hover:underline">{trade.traderName}</Link></div><div className="text-right"><p className="text-xs">{money(trade.quoteAmount)}</p><p className="text-[10px] text-[var(--muted)]">{ago(trade.createdAt)}</p></div></div>)}</div> : <Empty text="No completed trades" />}</section>
        </div>

        <aside className="space-y-3">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 lg:sticky lg:top-[78px]">
            <div className="grid grid-cols-2 rounded-lg bg-[var(--surface)] p-1"><button onClick={() => { setSide("buy"); setAmount(""); }} className={`rounded-md py-2 text-xs font-medium ${side === "buy" ? "bg-[var(--positive)] text-black" : "text-[var(--muted)]"}`}>BUY</button><button onClick={() => { setSide("sell"); setAmount(""); }} className={`rounded-md py-2 text-xs font-medium ${side === "sell" ? "bg-[var(--negative)] text-white" : "text-[var(--muted)]"}`}>SELL</button></div>
            <div className="mt-3 flex items-center justify-between text-[11px]"><span className="text-[var(--muted)]">Available</span><span>{side === "buy" ? money(data.availableBalance) : `${compact(data.holding.quantity)} ${coin.symbol}`}</span></div>
            {side === "buy" && data.reservedBalance > 0 ? <p className="mt-1 text-right text-[9px] text-[var(--muted-2)]">{money(data.reservedBalance)} reserved by open Gift offers</p> : null}
            <div className="mt-2 flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none" /><span className="text-xs text-[var(--muted)]">{side === "buy" ? "USD" : coin.symbol}</span></div>
            <div className="mt-2 grid grid-cols-4 gap-1">{[0.1, 0.25, 0.5, 1].map((fraction) => <button key={fraction} onClick={() => setAmount(String(max * fraction))} className="rounded-md bg-[var(--panel-2)] py-2 text-[10px] text-[var(--muted)] hover:text-white">{fraction === 1 ? "MAX" : `${fraction * 100}%`}</button>)}</div>
            {error ? <div className="mt-3 rounded-lg bg-[#25191b] px-3 py-2 text-xs text-[#ff9aa4]">{error}</div> : null}
            <PrimaryButton onClick={trade} disabled={busy || !Number(amount) || Number(amount) > max} className={`mt-3 w-full py-3 ${side === "sell" ? "!bg-[var(--negative)] !text-white" : "!bg-[var(--positive)]"}`}>{busy ? "Processing…" : `${side === "buy" ? "Buy" : "Sell"} $${coin.symbol}`}</PrimaryButton>
            <div className="mt-3 grid grid-cols-2 gap-2"><MiniStat label="Position" value={money(holdingValue)} /><MiniStat label="Unrealized" value={money(holdingPnl)} tone={holdingPnl} /></div>
          </section>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)]"><div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-xs font-medium"><Users size={14} />Top holders</div>{data.topHolders.length ? <div className="divide-y divide-[var(--border-soft)]">{data.topHolders.map((holder, index) => <Link href={`/u/${holder.id}`} key={holder.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs hover:bg-[var(--panel-2)]"><span className="truncate"><span className="mr-2 text-[var(--muted)]">{index + 1}</span>{holder.name}</span><span>{compact(holder.quantity)}</span></Link>)}</div> : <Empty text="No holders" />}</section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="rounded-lg bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-xs font-medium ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function Empty({ text }: { text: string }) { return <div className="grid min-h-28 place-items-center text-xs text-[var(--muted)]">{text}</div>; }
