"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { ArrowLeft, Share2, Star, Users } from "lucide-react";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { calculateCoinQuote, COIN_FEE_RATE } from "@/lib/amm";
import { compact, money, percent, price } from "@/lib/format";
import type { Candle, Coin, Trade } from "@/lib/types";

const CoinChart = dynamic(() => import("@/components/coin-chart").then((module) => module.CoinChart), {
  ssr: false,
  loading: () => <div className="mxm-skeleton h-[260px] rounded-[16px]" />,
});
const CoinConditionalOrders = dynamic(() => import("@/components/coin-conditional-orders").then((module) => module.CoinConditionalOrders), {
  ssr: false,
  loading: () => <div className="mxm-skeleton h-32 rounded-[16px]" />,
});

const realtimeTables = ["coins", "trades"];
type CoinEconomy = {
  startPrice: number; floorPrice: number | null; floorActive: boolean; floorExpiresAt: string | null;
  initialBuy: number; initialTokens: number; totalFeeBps: number; creatorFeeBps: number; platformFeeBps: number;
  availableQuantity: number;
  lock: { total: number; remaining: number; startsAt: string; endsAt: string; availableQuantity: number } | null;
  genesisBadge: { ordinal: number; label: string } | null;
};
type Payload = { coin: Coin; candles: Candle[]; trades: Trade[]; economy: CoinEconomy; holding: { quantity: number; availableQuantity: number; costBasis: number }; balance: number; availableBalance: number; reservedBalance: number; watched: boolean; topHolders: { id: string; name: string; quantity: number; genesisOrdinal: number | null }[] };

function amountText(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(8).replace(/\.?0+$/, "");
}

function makeTradeRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function CoinPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const realtimeFilters = useMemo(() => ({ coins: `id=eq.${id}`, trades: `coin_id=eq.${id}` }), [id]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [marketTab, setMarketTab] = useState<"overview" | "orders" | "holders" | "activity">("overview");
  const [amount, setAmount] = useState("");
  const [sellAll, setSellAll] = useState(false);
  const [slippage, setSlippage] = useState(2);
  const [busy, setBusy] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const tradeInFlight = useRef(false);
  const tradeRequestId = useRef<string | null>(null);
  const { refreshProfile, patchProfile, haptic } = useTelegramProfile();

  const load = useCallback(async (silent = false) => {
    const seq = ++loadSeq.current;
    try {
      const payload = await apiFetch<Payload>(`/api/coins/${id}`);
      if (seq !== loadSeq.current || tradeInFlight.current) return;
      setData(payload);
      setError(null);
    } catch (e) {
      if (!silent && seq === loadSeq.current) setError(e instanceof Error ? e.message : "Не удалось загрузить мемкоин");
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const realtimeReload = useCallback(() => { if (!tradeInFlight.current) void load(true); }, [load]);

  const max = useMemo(() => side === "buy" ? data?.availableBalance || 0 : data?.holding.availableQuantity || 0, [data, side]);
  const numericAmount = Number(amount);
  const validAmount = Boolean(data && Number.isFinite(numericAmount) && numericAmount > 0 && (sellAll && side === "sell" ? max > 0 : numericAmount <= max));
  const quote = useMemo(() => {
    if (!data || !validAmount) return null;
    const input = sellAll && side === "sell" ? data.holding.availableQuantity : numericAmount;
    return calculateCoinQuote({
      side,
      amount: input,
      tokenReserve: data.coin.tokenReserve,
      quoteReserve: data.coin.quoteReserve,
      currentPrice: data.coin.currentPrice,
    });
  }, [data, numericAmount, sellAll, side, validAmount]);

  function switchSide(next: "buy" | "sell") {
    setSide(next);
    setAmount("");
    setSellAll(false);
    tradeRequestId.current = null;
    setError(null);
  }

  function applyFraction(fraction: number) {
    if (!data) return;
    tradeRequestId.current = null;
    if (side === "sell" && fraction === 1) {
      setSellAll(true);
      setAmount(amountText(data.holding.availableQuantity));
      return;
    }
    setSellAll(false);
    setAmount(amountText(max * fraction));
  }

  async function trade() {
    if (!data || busy || !quote || !validAmount) return;
    const previous = data;
    const inputAmount = sellAll && side === "sell" ? data.holding.availableQuantity : numericAmount;
    const oldQuantity = data.holding.quantity;
    const oldAvailableQuantity = data.holding.availableQuantity;
    const oldCost = data.holding.costBasis;
    const nextTokenReserve = side === "buy" ? data.coin.tokenReserve - quote.outputAmount : data.coin.tokenReserve + inputAmount;
    const nextQuoteReserve = (data.coin.tokenReserve * data.coin.quoteReserve) / nextTokenReserve;
    const nextMarketCap = quote.projectedPrice * data.coin.totalSupply;
    const costReduction = side === "sell" && oldQuantity > 0 ? oldCost * Math.min(1, inputAmount / oldQuantity) : 0;

    const optimistic: Payload = {
      ...data,
      coin: {
        ...data.coin,
        currentPrice: quote.projectedPrice,
        marketCap: nextMarketCap,
        tokenReserve: nextTokenReserve,
        quoteReserve: nextQuoteReserve,
      },
      holding: side === "buy"
        ? { quantity: oldQuantity + quote.outputAmount, availableQuantity: oldAvailableQuantity + quote.outputAmount, costBasis: oldCost + inputAmount }
        : { quantity: Math.max(0, oldQuantity - inputAmount), availableQuantity: Math.max(0, oldAvailableQuantity - inputAmount), costBasis: Math.max(0, oldCost - costReduction) },
      balance: side === "buy" ? data.balance - inputAmount : data.balance + quote.outputAmount,
      availableBalance: side === "buy" ? data.availableBalance - inputAmount : data.availableBalance + quote.outputAmount,
    };

    tradeInFlight.current = true;
    setBusy(true);
    setError(null);
    setData(optimistic);
    patchProfile({ balance: optimistic.balance, availableBalance: optimistic.availableBalance });
    setAmount("");
    setSellAll(false);
    haptic("medium");

    try {
      const minOutput = Math.max(0, quote.outputAmount * (1 - slippage / 100));
      const requestId = tradeRequestId.current || makeTradeRequestId();
      tradeRequestId.current = requestId;
      await apiFetch("/api/trade", {
        method: "POST",
        body: JSON.stringify({ requestId, coinId: id, side, amount: inputAmount, sellAll: side === "sell" && sellAll, minOutput }),
      });
      haptic("light");
      tradeRequestId.current = null;
      tradeInFlight.current = false;
      setBusy(false);
      void refreshProfile();
      void load(true);
    } catch (e) {
      tradeInFlight.current = false;
      setBusy(false);
      setData(previous);
      patchProfile({ balance: previous.balance, availableBalance: previous.availableBalance });
      setAmount(amountText(inputAmount));
      setSellAll(side === "sell" && Math.abs(inputAmount - previous.holding.availableQuantity) <= Math.max(1e-8, previous.holding.availableQuantity * 1e-12));
      const message = e instanceof Error ? e.message : "Сделка не выполнена";
      setError((message.includes("Insufficient token balance") || message.includes("Недостаточно токенов")) ? "Количество токенов изменилось. Нажми МАКС ещё раз." : message);
      void load(true);
    }
  }

  function shareCoin() {
    if (!data) return;
    const target = typeof window !== "undefined" ? `${window.location.origin}/coin/${id}` : "";
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(target)}&text=${encodeURIComponent(`${data.coin.name} ($${data.coin.symbol}) на MXM`)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(shareUrl);
    else window.open(shareUrl, "_blank", "noopener,noreferrer");
    haptic("light");
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

  if (!data) return <div className="mx-auto max-w-6xl"><div className="mxm-skeleton h-[520px] rounded-xl" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  const { coin } = data;
  const holdingValue = data.holding.quantity * coin.currentPrice;
  const holdingPnl = holdingValue - data.holding.costBasis;
  const flow = coin.buyVolume24h + coin.sellVolume24h;
  const buyShare = flow > 0 ? (coin.buyVolume24h / flow) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl mxm-page-enter">
      <RealtimeRefresh channelName={`mxm-coin-${id}`} tables={realtimeTables} filters={realtimeFilters} onChange={realtimeReload} debounceMs={900} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/market" className="inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-white"><ArrowLeft size={15} />Рынок</Link>
        <div className="flex items-center gap-1"><button onClick={shareCoin} aria-label="Поделиться мемкоином" className="grid h-8 w-8 place-items-center text-[var(--muted)] transition hover:text-white"><Share2 size={15} /></button><button onClick={toggleWatch} disabled={watchBusy} aria-label={data.watched ? "Убрать мемкоин из избранного" : "Добавить мемкоин в избранное"} className={`grid h-8 w-8 place-items-center text-[var(--muted)] transition hover:text-white ${data.watched ? "text-[var(--accent)]" : ""}`}><Star size={16} fill={data.watched ? "currentColor" : "none"} /></button></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-4">
          <section className="border-b border-[var(--border-soft)] pb-4">
            <div className="flex items-center gap-3"><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} size="lg" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="truncate text-base font-semibold">{coin.name}</h1><span className="text-xs text-[var(--muted)]">${coin.symbol}</span>{data.economy.genesisBadge ? <span className="rounded-full border border-[#f5c451]/40 px-2 py-0.5 text-[8px] text-[#f3d789]">{data.economy.genesisBadge.label}</span> : null}</div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-sm font-semibold">{price(coin.currentPrice)}</span><span className={`text-xs ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</span>{coin.creatorId ? <Link href={`/u/${coin.creatorId}`} className="text-[11px] text-[var(--muted)] hover:text-white">создатель {coin.creatorName}</Link> : null}</div></div></div>
            {coin.description ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{coin.description}</p> : null}
          </section>

          <section className="border-b border-[var(--border-soft)] pb-4"><CoinChart candles={data.candles} height={260} /></section>

          <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-b border-[var(--border-soft)] pb-4 sm:grid-cols-3 lg:grid-cols-6"><Stat label="Капитализация" value={money(coin.marketCap)} /><Stat label="Объём 24ч" value={money(coin.volume24h)} /><Stat label="Ликвидность" value={money(coin.liquidity)} /><Stat label="Макс. цена" value={price(coin.athPrice)} /><Stat label="Владельцы" value={String(coin.holderCount)} /><Stat label="Сделки" value={String(coin.tradeCount24h)} /></div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-b border-[var(--border-soft)] py-3 text-[10px] sm:grid-cols-4">
            <Stat label="Стартовая цена" value={price(data.economy.startPrice)} />
            <Stat label="Мин. цена" value={data.economy.floorActive && data.economy.floorPrice ? price(data.economy.floorPrice) : "не активен"} />
            <Stat label="Доля создателя" value={`${data.economy.creatorFeeBps / 100}% из комиссии`} />
            <Stat label="Заблокировано" value={data.economy.lock ? `${compact(data.economy.lock.remaining)} ${coin.symbol}` : "—"} />
          </div>

          <section className="border-b border-[var(--border-soft)] pb-4">
            <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-xs font-medium">Поток сделок 24ч</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">Только завершённые сделки MXM</p></div><span className="text-[10px] text-[var(--muted)]">{flow > 0 ? `${buyShare.toFixed(0)}% покупок` : "Нет объёма"}</span></div>
            <div className="flex h-1 overflow-hidden rounded-full bg-[#15191d]"><span className="bg-[var(--positive)]" style={{ width: `${buyShare}%` }} /><span className="bg-[var(--negative)]" style={{ width: `${100 - buyShare}%` }} /></div>
            <div className="mt-2 flex justify-between text-[10px]"><span className="text-[var(--positive)]">Покупки {money(coin.buyVolume24h)}</span><span className="text-[var(--negative)]">Продажи {money(coin.sellVolume24h)}</span></div>
          </section>

          <section><div className="mb-3 flex gap-2 overflow-x-auto border-b border-[var(--border-soft)] pb-2">{[["overview","Обзор"],["orders","Заявки"],["holders","Владельцы"],["activity","Активность"]].map(([key,label])=><button key={key} onClick={()=>setMarketTab(key as typeof marketTab)} className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] ${marketTab===key?"bg-[var(--panel-3)] text-white":"text-[var(--muted)]"}`}>{label}</button>)}</div>{marketTab==="overview" ? <div className="text-xs text-[var(--muted)]">Покупки {money(coin.buyVolume24h)} · Продажи {money(coin.sellVolume24h)}</div> : null}{marketTab==="activity" ? (data.trades.length ? <div className="max-h-72 overflow-auto divide-y divide-[var(--border-soft)]">{data.trades.map((trade) => <div key={trade.id} className="flex justify-between py-2 text-xs"><span>{trade.side === "buy" ? "Покупка" : "Продажа"} {trade.traderName}</span><span>{money(trade.quoteAmount)}</span></div>)}</div> : <Empty text="Сделок пока нет" />) : null}{marketTab==="holders" ? (data.topHolders.length ? <div className="max-h-72 overflow-auto divide-y divide-[var(--border-soft)]">{data.topHolders.map((holder)=><div key={holder.id} className="flex justify-between py-2 text-xs"><span>{holder.name}</span><span>{compact(holder.quantity)}</span></div>)}</div> : <Empty text="Владельцев нет" />) : null}{marketTab==="orders" ? <div className="text-xs text-[var(--muted)]">Заявки управления доступны в торговом блоке.</div> : null}</section>
        </div>

        <aside className="space-y-4">
          <section className="lg:sticky lg:top-[68px]">
            <div className="grid grid-cols-2 border-b border-[var(--border-soft)]"><button onClick={() => switchSide("buy")} className={`py-2.5 text-xs font-semibold transition ${side === "buy" ? "border-b-2 border-[var(--positive)] text-white" : "text-[var(--muted)]"}`}>КУПИТЬ</button><button onClick={() => switchSide("sell")} className={`py-2.5 text-xs font-semibold transition ${side === "sell" ? "border-b-2 border-[var(--negative)] text-white" : "text-[var(--muted)]"}`}>ПРОДАТЬ</button></div>
            <div className="mt-3 flex items-center justify-between text-[11px]"><span className="text-[var(--muted)]">Доступно</span><span>{side === "buy" ? money(data.availableBalance) : `${compact(data.holding.availableQuantity)} ${coin.symbol}`}</span></div>
            {side === "sell" && data.economy.lock?.remaining ? <p className="mt-1 text-right text-[9px] text-[#f3d789]">{compact(data.economy.lock.remaining)} заблокировано до {new Date(data.economy.lock.endsAt).toLocaleDateString("ru-RU")}</p> : null}
            {side === "buy" && data.reservedBalance > 0 ? <p className="mt-1 text-right text-[9px] text-[var(--muted-2)]">{money(data.reservedBalance)} в резерве по предложениям на подарки</p> : null}
            <div className="mt-2 flex items-center border-b border-[var(--border)] px-1"><input value={amount} onChange={(e) => { tradeRequestId.current = null; setAmount(e.target.value); setSellAll(false); }} inputMode="decimal" placeholder="0" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none" /><span className="text-xs text-[var(--muted)]">{side === "buy" ? "TON" : coin.symbol}</span></div>
            <div className="mxm-hscroll mt-2 gap-4 border-b border-[var(--border-soft)] pb-2">{[0.1, 0.25, 0.5, 1].map((fraction) => <button key={fraction} onClick={() => applyFraction(fraction)} className="shrink-0 py-1 text-[10px] text-[var(--muted)] hover:text-white">{fraction === 1 ? "МАКС" : `${fraction * 100}%`}</button>)}</div>

            {quote ? <div className="mt-3 space-y-2 py-1"><QuoteRow label="Вы получите" value={side === "buy" ? `${compact(quote.outputAmount)} ${coin.symbol}` : money(quote.outputAmount)} strong /><QuoteRow label="Цена исполнения" value={price(quote.executionPrice)} /><QuoteRow label={`Комиссия · ${(COIN_FEE_RATE * 100).toFixed(1)}%`} value={money(quote.feeAmount)} /><QuoteRow label="Влияние на цену" value={`${quote.priceImpact.toFixed(2)}%`} warning={quote.priceImpact >= 10} /><QuoteRow label="Цена после сделки" value={price(quote.projectedPrice)} /><QuoteRow label="Минимум к получению" value={side === "buy" ? `${compact(quote.outputAmount * (1 - slippage / 100))} ${coin.symbol}` : money(quote.outputAmount * (1 - slippage / 100))} /></div> : null}
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-2"><span className="text-[10px] text-[var(--muted)]">Проскальзывание</span><div className="mxm-hscroll max-w-[210px] justify-end gap-3">{[0.5, 1, 2, 5].map((value) => <button key={value} type="button" onClick={() => setSlippage(value)} className={`shrink-0 py-1 text-[10px] transition ${slippage === value ? "text-white underline decoration-[var(--accent)] underline-offset-4" : "text-[var(--muted)] hover:text-white"}`}>{value}%</button>)}</div></div>
            {Number.isFinite(numericAmount) && numericAmount > max && !sellAll ? <p className="mt-2 text-[10px] text-[var(--negative)]">Сумма превышает доступный баланс.</p> : null}
            {error ? <div className="mt-3 border-l-2 border-[var(--negative)] px-2 py-1.5 text-xs text-[#ff9aa4]">{error}</div> : null}
            <PrimaryButton onClick={trade} disabled={busy || !quote || !validAmount} className={`mt-3 w-full py-3 ${side === "sell" ? "!bg-[var(--negative)] !text-white" : "!bg-[var(--positive)]"}`}>{busy ? "Подтверждаем…" : `${side === "buy" ? "Купить" : "Продать"} $${coin.symbol}`}</PrimaryButton>
            <p className="mt-2 text-center text-[9px] text-[var(--muted-2)]">Расчёт показывается мгновенно. Сервер подтверждает итоговую сделку атомарно.</p>
            <div className="mt-4 grid grid-cols-2 gap-x-4 border-t border-[var(--border-soft)] pt-3"><MiniStat label="Позиция" value={money(holdingValue)} /><MiniStat label="Нереализованный результат" value={money(holdingPnl)} tone={holdingPnl} /></div>
            <CoinConditionalOrders coin={coin} holdingQuantity={data.holding.availableQuantity} availableBalance={data.availableBalance} onBalanceChange={() => { void refreshProfile(); void load(true); }} />
          </section>

          <section><div className="flex items-center gap-2 border-b border-[var(--border-soft)] pb-2 text-xs font-medium"><Users size={14} />Крупнейшие владельцы</div>{data.topHolders.length ? <div className="divide-y divide-[var(--border-soft)]">{data.topHolders.map((holder, index) => <Link href={`/u/${holder.id}`} key={holder.id} className="flex items-center justify-between gap-3 py-2.5 text-xs"><span className="truncate"><span className="mr-2 text-[var(--muted)]">{index + 1}</span>{holder.name}{holder.genesisOrdinal ? <span className="ml-2 text-[8px] text-[#f3d789]">Ранний #{holder.genesisOrdinal}</span> : null}</span><span>{compact(holder.quantity)}</span></Link>)}</div> : <Empty text="Владельцев пока нет" />}</section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-xs font-semibold">{value}</p></div>; }
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div><p className="text-[9px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-xs font-medium ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function QuoteRow({ label, value, strong, warning }: { label: string; value: string; strong?: boolean; warning?: boolean }) { return <div className="flex items-center justify-between gap-3 text-[10px]"><span className="text-[var(--muted)]">{label}</span><span className={`${strong ? "text-xs font-semibold" : ""} ${warning ? "text-[var(--negative)]" : ""}`}>{value}</span></div>; }
function Empty({ text }: { text: string }) { return <div className="grid min-h-24 place-items-center text-xs text-[var(--muted)]">{text}</div>; }
