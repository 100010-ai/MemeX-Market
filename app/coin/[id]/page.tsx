"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Droplets, Gauge, Star, Users } from "lucide-react";
import { CoinChart } from "@/components/coin-chart";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { ago, compact, money, percent, price } from "@/lib/format";
import type { Candle, Coin, CoinQuote, Trade } from "@/lib/types";

const realtimeTables = ["coins", "trades"];
type Payload = { coin: Coin; candles: Candle[]; trades: Trade[]; holding: { quantity: number; costBasis: number }; balance: number; availableBalance: number; reservedBalance: number; watched: boolean; topHolders: { id: string; name: string; quantity: number }[] };

export default function CoinPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<CoinQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async () => {
    try { setData(await apiFetch<Payload>(`/api/coins/${id}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить коин"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const realtimeReload = useCallback(() => { void load(); }, [load]);

  const max = useMemo(() => side === "buy" ? data?.availableBalance || 0 : data?.holding.quantity || 0, [data, side]);
  const numericAmount = Number(amount);

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!data || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > max) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await apiFetch<{ quote: CoinQuote }>(`/api/coins/${id}/quote`, { method: "POST", body: JSON.stringify({ side, amount: numericAmount }) });
        if (!cancelled) { setQuote(result.quote); setQuoteError(null); }
      } catch (cause) {
        if (!cancelled) setQuoteError(cause instanceof Error ? cause.message : "Не удалось рассчитать сделку");
      }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [data, id, side, numericAmount, max]);

  async function trade() {
    if (!data || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > max || !quote) return;
    setBusy(true); setError(null); haptic("medium");
    try {
      await apiFetch("/api/trade", { method: "POST", body: JSON.stringify({ coinId: id, side, amount: numericAmount }) });
      setAmount("");
      setQuote(null);
      await Promise.all([load(), refreshProfile()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Сделка не выполнена"); }
    finally { setBusy(false); }
  }

  async function toggleWatch() {
    if (!data || watchBusy) return;
    const enabled = !data.watched;
    setWatchBusy(true);
    try {
      await apiFetch("/api/watchlist", { method: "POST", body: JSON.stringify({ kind: "coin", coinId: id, enabled }) });
      setData((current) => current ? { ...current, watched: enabled } : current);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить избранное");
    } finally { setWatchBusy(false); }
  }

  if (!data) return <div className="mx-auto max-w-6xl"><div className="mxm-skeleton h-[520px] rounded-2xl" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  const { coin } = data;
  const holdingValue = data.holding.quantity * coin.currentPrice;
  const holdingPnl = holdingValue - data.holding.costBasis;
  const flow = coin.buyVolume24h + coin.sellVolume24h;
  const buyShare = flow > 0 ? (coin.buyVolume24h / flow) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName={`mxm-coin-${id}`} tables={realtimeTables} onChange={realtimeReload} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/market" className="inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-white"><ArrowLeft size={15} />Маркет</Link>
        <button onClick={toggleWatch} disabled={watchBusy} aria-label={data.watched ? "Убрать коин из избранного" : "Добавить коин в избранное"} className={`grid h-9 w-9 place-items-center rounded-2xl border ${data.watched ? "border-[var(--accent)] bg-[rgba(198,170,88,.09)] text-[var(--accent)]" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"}`}><Star size={16} fill={data.watched ? "currentColor" : "none"} /></button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="flex items-center gap-3"><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} size="lg" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="truncate text-base font-semibold">{coin.name}</h1><span className="text-xs text-[var(--muted)]">${coin.symbol}</span></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-sm font-semibold">{price(coin.currentPrice)}</span><span className={`text-xs ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</span>{coin.creatorId ? <Link href={`/u/${coin.creatorId}`} className="text-[11px] text-[var(--muted)] hover:text-white">создатель {coin.creatorName}</Link> : null}</div></div></div>
            {coin.description ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{coin.description}</p> : null}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3"><CoinChart candles={data.candles} height={360} /></section>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"><Stat label="Капитализация" value={money(coin.marketCap)} /><Stat label="Объём 24ч" value={money(coin.volume24h)} /><Stat label="Ликвидность" value={money(coin.liquidity)} /><Stat label="ATH" value={price(coin.athPrice)} /><Stat label="Холдеры" value={String(coin.holderCount)} /><Stat label="Сделки" value={String(coin.tradeCount24h)} /></div>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-xs font-medium">Поток сделок 24ч</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">Только завершённые сделки MXM</p></div><span className="text-[10px] text-[var(--muted)]">{flow > 0 ? `${buyShare.toFixed(0)}% покупок` : "Нет объёма"}</span></div>
            <div className="flex h-2 overflow-hidden rounded-full bg-[var(--panel-2)]"><span className="bg-[var(--positive)]" style={{ width: `${buyShare}%` }} /><span className="bg-[var(--negative)]" style={{ width: `${100 - buyShare}%` }} /></div>
            <div className="mt-2 flex justify-between text-[10px]"><span className="text-[var(--positive)]">Покупки {money(coin.buyVolume24h)}</span><span className="text-[var(--negative)]">Продажи {money(coin.sellVolume24h)}</span></div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-3 text-xs font-medium">Последние сделки</div>{data.trades.length ? <div className="divide-y divide-[var(--border-soft)]">{data.trades.map((trade) => <div key={trade.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5"><div className="flex min-w-0 items-center gap-2">{trade.side === "buy" ? <ArrowDownLeft size={14} className="text-[var(--positive)]" /> : <ArrowUpRight size={14} className="text-[var(--negative)]" />}<Link href={`/u/${trade.traderId}`} className="truncate text-xs hover:underline">{trade.traderName}</Link></div><div className="text-right"><p className="text-xs">{money(trade.quoteAmount)}</p><p className="text-[10px] text-[var(--muted)]">{ago(trade.createdAt)}</p></div></div>)}</div> : <Empty text="Завершённых сделок пока нет" />}</section>
        </div>

        <aside className="space-y-3">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 lg:sticky lg:top-[68px]">
            <div className="grid grid-cols-2 rounded-2xl bg-[var(--surface)] p-1"><button onClick={() => { setSide("buy"); setAmount(""); setQuote(null); }} className={`rounded-2xl py-2 text-xs font-medium ${side === "buy" ? "bg-[var(--positive)] text-black" : "text-[var(--muted)]"}`}>КУПИТЬ</button><button onClick={() => { setSide("sell"); setAmount(""); setQuote(null); }} className={`rounded-2xl py-2 text-xs font-medium ${side === "sell" ? "bg-[var(--negative)] text-white" : "text-[var(--muted)]"}`}>ПРОДАТЬ</button></div>
            <div className="mt-3 flex items-center justify-between text-[11px]"><span className="text-[var(--muted)]">Доступно</span><span>{side === "buy" ? money(data.availableBalance) : `${compact(data.holding.quantity)} ${coin.symbol}`}</span></div>
            {side === "buy" && data.reservedBalance > 0 ? <p className="mt-1 text-right text-[9px] text-[var(--muted-2)]">{money(data.reservedBalance)} в резерве по офферам подарков</p> : null}
            <div className="mt-2 flex items-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none" /><span className="text-xs text-[var(--muted)]">{side === "buy" ? "MXM" : coin.symbol}</span></div>
            <div className="mt-2 grid grid-cols-4 gap-1">{[0.1, 0.25, 0.5, 1].map((fraction) => <button key={fraction} onClick={() => setAmount(String(Number((max * fraction).toFixed(8))))} className="rounded-2xl bg-[var(--panel-2)] py-2 text-[10px] text-[var(--muted)] hover:text-white">{fraction === 1 ? "МАКС" : `${fraction * 100}%`}</button>)}</div>

            {quote ? <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] p-2.5"><QuoteRow label="Вы получите" value={side === "buy" ? `${compact(quote.outputAmount)} ${coin.symbol}` : money(quote.outputAmount)} strong /><QuoteRow label="Цена исполнения" value={price(quote.executionPrice)} /><QuoteRow label="Комиссия · 0.5%" value={money(quote.feeAmount)} /><QuoteRow label="Влияние на цену" value={`${quote.priceImpact.toFixed(2)}%`} warning={quote.priceImpact >= 10} /><QuoteRow label="Цена после сделки" value={price(quote.projectedPrice)} /></div> : null}
            {quoteError ? <p className="mt-2 text-[10px] text-[var(--negative)]">{quoteError}</p> : null}
            {Number.isFinite(numericAmount) && numericAmount > max ? <p className="mt-2 text-[10px] text-[var(--negative)]">Сумма превышает доступный баланс.</p> : null}
            {error ? <div className="mt-3 rounded-2xl bg-[#25191b] px-3 py-2 text-xs text-[#ff9aa4]">{error}</div> : null}
            <PrimaryButton onClick={trade} disabled={busy || !quote || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > max} className={`mt-3 w-full py-3 ${side === "sell" ? "!bg-[var(--negative)] !text-white" : "!bg-[var(--positive)]"}`}>{busy ? "Обработка…" : `${side === "buy" ? "Купить" : "Продать"} $${coin.symbol}`}</PrimaryButton>
            <div className="mt-3 grid grid-cols-2 gap-2"><MiniStat label="Позиция" value={money(holdingValue)} /><MiniStat label="Нереализованный PnL" value={money(holdingPnl)} tone={holdingPnl} /></div>
          </section>
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)]"><div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-xs font-medium"><Users size={14} />Топ холдеров</div>{data.topHolders.length ? <div className="divide-y divide-[var(--border-soft)]">{data.topHolders.map((holder, index) => <Link href={`/u/${holder.id}`} key={holder.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs hover:bg-[var(--panel-2)]"><span className="truncate"><span className="mr-2 text-[var(--muted)]">{index + 1}</span>{holder.name}</span><span>{compact(holder.quantity)}</span></Link>)}</div> : <Empty text="Холдеров пока нет" />}</section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="rounded-2xl bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-xs font-medium ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function QuoteRow({ label, value, strong, warning }: { label: string; value: string; strong?: boolean; warning?: boolean }) { return <div className="flex items-center justify-between gap-3 text-[10px]"><span className="text-[var(--muted)]">{label}</span><span className={`${strong ? "text-xs font-semibold" : ""} ${warning ? "text-[var(--negative)]" : ""}`}>{value}</span></div>; }
function Empty({ text }: { text: string }) { return <div className="grid min-h-28 place-items-center text-xs text-[var(--muted)]">{text}</div>; }
