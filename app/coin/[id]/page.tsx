"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Candle, Coin, Trade } from "@/lib/types";
import { compact, money, percent, price } from "@/lib/format";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { CoinChart } from "@/components/coin-chart";
import { useTelegramProfile } from "@/components/telegram-provider";

type Payload = { coin: Coin; candles: Candle[]; trades: Trade[]; holding: { quantity: number; costBasis: number }; balance: number };

export default function CoinPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  async function load() { setData(await apiFetch<Payload>(`/api/coins/${id}`)); }
  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load coin"));
    const timer = setInterval(() => load().catch(() => undefined), 7000);
    return () => clearInterval(timer);
  }, [id]);

  const holdingValue = useMemo(() => data ? data.holding.quantity * data.coin.currentPrice : 0, [data]);

  async function trade() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true); setError(null); haptic("medium");
    try {
      await apiFetch("/api/trade", { method: "POST", body: JSON.stringify({ coinId: id, side, amount: value }) });
      setAmount("");
      await Promise.all([load(), refreshProfile()]);
      haptic("heavy");
    } catch (e) { setError(e instanceof Error ? e.message : "Trade failed"); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="mx-auto max-w-5xl rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-sm text-[var(--muted)]">{error || "Loading market…"}</div>;
  const { coin } = data;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex min-w-0 items-center gap-3"><CoinAvatar symbol={coin.symbol} size="lg" /><div className="min-w-0"><h1 className="truncate text-lg font-semibold">{coin.name} <span className="text-[var(--muted)]">${coin.symbol}</span></h1><p className="mt-0.5 text-xs text-[var(--muted)]">{coin.description}</p></div></div>
        <div className="shrink-0 text-right"><p className="text-base font-semibold">{price(coin.currentPrice)}</p><p className={`text-xs ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <div className="mb-2 grid grid-cols-3 gap-2">
            <Mini label="Market cap" value={money(coin.marketCap)} />
            <Mini label="24h volume" value={money(coin.volume24h)} />
            <Mini label="Holders" value={compact(coin.holderCount)} />
          </div>
          <CoinChart candles={data.candles} />
        </section>

        <section className="h-fit rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 lg:sticky lg:top-20">
          <div className="mb-3 grid grid-cols-2 rounded-lg bg-[var(--surface)] p-1"><button onClick={() => setSide("buy")} className={`rounded-md py-2 text-xs font-medium ${side === "buy" ? "bg-[var(--positive)] text-black" : "text-[var(--muted)]"}`}>Buy</button><button onClick={() => setSide("sell")} className={`rounded-md py-2 text-xs font-medium ${side === "sell" ? "bg-[var(--negative)] text-white" : "text-[var(--muted)]"}`}>Sell</button></div>
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)]"><span>{side === "buy" ? "Virtual cash" : "Token balance"}</span><span>{side === "buy" ? money(data.balance) : compact(data.holding.quantity)}</span></div>
          <div className="mt-2 flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={side === "buy" ? "0.00 USD" : "0 tokens"} className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none" /><span className="text-xs text-[var(--muted)]">{side === "buy" ? "USD" : coin.symbol}</span></div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">{side === "buy" ? [5,10,25,50].map((v) => <button key={v} onClick={() => setAmount(String(Math.min(v, data.balance)))} className="rounded-md bg-[var(--panel-2)] py-1.5 text-[10px] text-[var(--muted)]">${v}</button>) : [25,50,75,100].map((v) => <button key={v} onClick={() => setAmount(String(data.holding.quantity * v / 100))} className="rounded-md bg-[var(--panel-2)] py-1.5 text-[10px] text-[var(--muted)]">{v}%</button>)}</div>
          {error ? <p className="mt-2 text-xs text-[var(--negative)]">{error}</p> : null}
          <PrimaryButton onClick={trade} disabled={busy || !Number(amount)} className={`mt-3 w-full py-3 ${side === "sell" ? "!bg-[var(--negative)] !text-white" : "!bg-[var(--positive)]"}`}>{busy ? "Executing…" : `${side === "buy" ? "Buy" : "Sell"} $${coin.symbol}`}</PrimaryButton>
          <div className="mt-3 border-t border-[var(--border-soft)] pt-3 text-[11px] text-[var(--muted)]"><div className="flex justify-between"><span>Your position</span><span>{money(holdingValue)}</span></div><div className="mt-1 flex justify-between"><span>Cost basis</span><span>{money(data.holding.costBasis)}</span></div><div className="mt-1 flex justify-between"><span>Virtual fee</span><span>0.5%</span></div></div>
        </section>
      </div>

      <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-sm font-medium"><Activity size={15} /> Trade feed</div>
        <div className="divide-y divide-[var(--border-soft)]">{data.trades.length ? data.trades.map((t) => <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 text-xs"><span className="truncate text-[var(--muted)]">{t.traderName}</span><span className={t.side === "buy" ? "text-[var(--positive)]" : "text-[var(--negative)]"}>{t.side.toUpperCase()}</span><span>{money(t.quoteAmount)}</span></div>) : <p className="px-3 py-5 text-xs text-[var(--muted)]">No player trades yet.</p>}</div>
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-xs font-medium">{value}</p></div>;
}
