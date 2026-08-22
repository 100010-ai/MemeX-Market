"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, Share2, Star, Users, X } from "lucide-react";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { calculateCoinQuote, COIN_FEE_RATE } from "@/lib/amm";
import { compact, money, percent, price } from "@/lib/format";
import type { Candle, Coin, Trade } from "@/lib/types";

const CoinChart = dynamic(() => import("@/components/coin-chart").then((module) => module.CoinChart), {
  ssr: false,
  loading: () => <div className="mxm-skeleton h-[172px] rounded-[14px]" />,
});
const CoinConditionalOrders = dynamic(() => import("@/components/coin-conditional-orders").then((module) => module.CoinConditionalOrders), {
  ssr: false,
  loading: () => <div className="mxm-skeleton h-28 rounded-[14px]" />,
});

const realtimeTables = ["coins", "trades"];
type MarketTab = "overview" | "orders" | "holders" | "activity";
type CoinEconomy = {
  startPrice: number;
  floorPrice: number | null;
  floorActive: boolean;
  floorExpiresAt: string | null;
  initialBuy: number;
  initialTokens: number;
  totalFeeBps: number;
  creatorFeeBps: number;
  platformFeeBps: number;
  availableQuantity: number;
  marketOpenPrice?: number;
  publicTradeCount?: number;
  lock: { total: number; remaining: number; startsAt: string; endsAt: string; availableQuantity: number } | null;
  genesisBadge: { ordinal: number; label: string } | null;
};
type Payload = {
  coin: Coin;
  candles: Candle[];
  trades: Trade[];
  economy: CoinEconomy;
  holding: { quantity: number; availableQuantity: number; costBasis: number };
  balance: number;
  availableBalance: number;
  reservedBalance: number;
  watched: boolean;
  topHolders: { id: string; name: string; quantity: number; genesisOrdinal: number | null }[];
};

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
  const [marketTab, setMarketTab] = useState<MarketTab>("overview");
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [sellAll, setSellAll] = useState(false);
  const [slippage, setSlippage] = useState(2);
  const [tradeNotice, setTradeNotice] = useState<string | null>(null);
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
    const savedSlippage = Number(window.sessionStorage.getItem("mxm-coin-slippage"));
    if ([0.5, 1, 2, 5].includes(savedSlippage)) setSlippage(savedSlippage);
    const savedTab = window.sessionStorage.getItem("mxm-coin-market-tab");
    if (savedTab === "overview" || savedTab === "orders" || savedTab === "holders" || savedTab === "activity") setMarketTab(savedTab);
  }, []);
  useEffect(() => { window.sessionStorage.setItem("mxm-coin-slippage", String(slippage)); }, [slippage]);
  useEffect(() => { window.sessionStorage.setItem("mxm-coin-market-tab", marketTab); }, [marketTab]);
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
    return calculateCoinQuote({ side, amount: input, tokenReserve: data.coin.tokenReserve, quoteReserve: data.coin.quoteReserve, currentPrice: data.coin.currentPrice });
  }, [data, numericAmount, sellAll, side, validAmount]);

  function switchSide(next: "buy" | "sell") {
    setSide(next);
    setAmount("");
    setSellAll(false);
    tradeRequestId.current = null;
    setError(null);
    setTradeNotice(null);
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
      coin: { ...data.coin, currentPrice: quote.projectedPrice, marketCap: nextMarketCap, tokenReserve: nextTokenReserve, quoteReserve: nextQuoteReserve },
      holding: side === "buy"
        ? { quantity: oldQuantity + quote.outputAmount, availableQuantity: oldAvailableQuantity + quote.outputAmount, costBasis: oldCost + inputAmount }
        : { quantity: Math.max(0, oldQuantity - inputAmount), availableQuantity: Math.max(0, oldAvailableQuantity - inputAmount), costBasis: Math.max(0, oldCost - costReduction) },
      balance: side === "buy" ? data.balance - inputAmount : data.balance + quote.outputAmount,
      availableBalance: side === "buy" ? data.availableBalance - inputAmount : data.availableBalance + quote.outputAmount,
    };

    tradeInFlight.current = true;
    setBusy(true);
    setError(null);
    setTradeNotice(null);
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
      setTradeNotice(side === "buy" ? `+${compact(quote.outputAmount)} ${data.coin.symbol}` : `+${money(quote.outputAmount)}`);
      void refreshProfile();
      void load(true);
    } catch (e) {
      tradeInFlight.current = false;
      setBusy(false);
      setData(previous);
      setTradeNotice(null);
      patchProfile({ balance: previous.balance, availableBalance: previous.availableBalance });
      setAmount(amountText(inputAmount));
      setSellAll(side === "sell" && Math.abs(inputAmount - previous.holding.availableQuantity) <= Math.max(1e-8, previous.holding.availableQuantity * 1e-12));
      const message = e instanceof Error ? e.message : "Сделка не выполнена";
      setError((message.includes("Insufficient token balance") || message.includes("Недостаточно токенов")) ? "Баланс изменился. Нажми МАКС ещё раз." : message);
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
  const publicTradeCount = Math.max(0, data.economy.publicTradeCount ?? coin.tradeCount24h);
  const pristineMarket = publicTradeCount === 0 && coin.allTimeVolume <= 0;
  const chartCandles = pristineMarket ? [] : data.candles;
  const visibleChange = pristineMarket ? 0 : coin.change24h;

  const tradePanel = (
    <section className="mxm-trade-panel mxm-coin-trade-panel">
      <div className="grid grid-cols-2 border-b border-[var(--border-soft)]">
        <button disabled={busy} onClick={() => switchSide("buy")} className={`py-2 text-[11px] font-semibold transition ${side === "buy" ? "border-b-2 border-[var(--positive)] text-white" : "text-[var(--muted)]"}`}>КУПИТЬ</button>
        <button disabled={busy} onClick={() => switchSide("sell")} className={`py-2 text-[11px] font-semibold transition ${side === "sell" ? "border-b-2 border-[var(--negative)] text-white" : "text-[var(--muted)]"}`}>ПРОДАТЬ</button>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px]"><span className="text-[var(--muted)]">Доступно</span><span className="font-medium">{side === "buy" ? money(data.availableBalance) : `${compact(data.holding.availableQuantity)} ${coin.symbol}`}</span></div>
      <div className="mt-1.5 flex items-center rounded-[11px] bg-white/[.025] px-2.5 ring-1 ring-inset ring-white/[.045]">
        <input value={amount} onChange={(event) => { tradeRequestId.current = null; setAmount(event.target.value); setSellAll(false); }} inputMode="decimal" placeholder="0" className="min-w-0 flex-1 bg-transparent py-2.5 text-base font-medium outline-none" />
        <span className="text-[10px] text-[var(--muted)]">{side === "buy" ? "TON" : coin.symbol}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex gap-3">{[0.1, 0.25, 0.5, 1].map((fraction) => <button key={fraction} type="button" onClick={() => applyFraction(fraction)} className="py-1 text-[9px] text-[var(--muted)] hover:text-white">{fraction === 1 ? "МАКС" : `${fraction * 100}%`}</button>)}</div>
        <div className="flex items-center gap-2 text-[8px] text-[var(--muted)]"><span>Slippage</span>{[0.5, 1, 2, 5].map((value) => <button key={value} type="button" onClick={() => setSlippage(value)} className={slippage === value ? "text-white" : "hover:text-white"}>{value}%</button>)}</div>
      </div>

      {quote ? <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[var(--border-soft)] pt-2">
        <QuoteCompact label="Получишь" value={side === "buy" ? `${compact(quote.outputAmount)} ${coin.symbol}` : money(quote.outputAmount)} />
        <QuoteCompact label="Комиссия" value={money(quote.feeAmount)} />
        <QuoteCompact label="Цена" value={price(quote.executionPrice)} />
        <QuoteCompact label="Влияние" value={`${quote.priceImpact.toFixed(2)}%`} warning={quote.priceImpact >= 10} />
      </div> : null}

      {Number.isFinite(numericAmount) && numericAmount > max && !sellAll ? <p className="mt-1.5 text-[9px] text-[var(--negative)]">Недостаточно доступного баланса.</p> : null}
      {side === "sell" && data.economy.lock?.remaining ? <p className="mt-1.5 truncate text-[8px] text-[#d9c27a]">Заблокировано: {compact(data.economy.lock.remaining)} {coin.symbol}</p> : null}
      {tradeNotice ? <div aria-live="polite" className="mt-1.5 text-[9px] font-medium text-[var(--positive)]">Готово · {tradeNotice}</div> : null}
      {error ? <div className="mt-1.5 line-clamp-2 text-[9px] text-[#ff9aa4]">{error}</div> : null}
      <PrimaryButton onClick={trade} disabled={busy || !quote || !validAmount} className={`mt-2.5 w-full !min-h-9 !py-2 ${side === "sell" ? "!bg-[var(--negative)] !text-white" : "!bg-[var(--positive)]"}`}>{busy ? "Подтверждаем…" : `${side === "buy" ? "Купить" : "Продать"} $${coin.symbol}`}</PrimaryButton>
      {data.holding.quantity > 0 ? <div className="mt-2 grid grid-cols-2 gap-3 border-t border-[var(--border-soft)] pt-2"><MiniStat label="Позиция" value={money(holdingValue)} /><MiniStat label="Результат" value={money(holdingPnl)} tone={holdingPnl} /></div> : null}
    </section>
  );

  return (
    <div className="mxm-coin-screen mx-auto max-w-6xl mxm-page-enter">
      <RealtimeRefresh channelName={`mxm-coin-${id}`} tables={realtimeTables} filters={realtimeFilters} onChange={realtimeReload} debounceMs={900} />

      <div className="mxm-coin-head">
        <Link href="/market" className="inline-flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--muted)] hover:text-white"><ArrowLeft size={14} /><span>Рынок</span></Link>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={() => setMetricsOpen(true)} aria-label="Метрики мемкоина" className="mxm-coin-head-action"><BarChart3 size={14} /></button>
          <button type="button" onClick={shareCoin} aria-label="Поделиться мемкоином" className="mxm-coin-head-action"><Share2 size={14} /></button>
          <button type="button" onClick={toggleWatch} disabled={watchBusy} aria-label={data.watched ? "Убрать мемкоин из избранного" : "Добавить мемкоин в избранное"} className={`mxm-coin-head-action ${data.watched ? "is-active" : ""}`}><Star size={15} fill={data.watched ? "currentColor" : "none"} /></button>
        </div>
      </div>

      <section className="mxm-coin-identity">
        <CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2"><h1 className="truncate text-[15px] font-semibold tracking-[-.02em]">{coin.name}</h1><span className="shrink-0 text-[9px] text-[var(--muted)]">${coin.symbol}</span></div>
          <div className="mt-0.5 flex items-center gap-2"><span className="text-[12px] font-semibold tabular-nums">{price(coin.currentPrice)}</span><span className={`text-[9px] font-medium ${visibleChange >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(visibleChange)}</span>{pristineMarket ? <span className="text-[8px] text-[var(--muted-2)]">торгов пока нет</span> : null}</div>
        </div>
      </section>

      <div className="mxm-coin-layout">
        <section className="mxm-coin-chart-slot">
          <CoinChart candles={chartCandles} height={148} baseFrame="15m" compact emptyLabel={pristineMarket ? "Первая свеча появится после сделки" : undefined} />
        </section>

        <div className="mxm-coin-tabs" role="tablist" aria-label="Разделы мемкоина">
          {([[
            "overview", "Торговать",
          ], ["orders", "Заявки"], ["holders", "Владельцы"], ["activity", "Сделки"]] as Array<[MarketTab, string]>).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={marketTab === key} onClick={() => setMarketTab(key)} className={marketTab === key ? "is-active" : ""}>{label}</button>)}
        </div>

        <div className={`mxm-coin-trade-slot ${marketTab === "overview" ? "" : "is-tab-hidden-mobile"}`}>{tradePanel}</div>

        <section className={`mxm-coin-tab-slot ${marketTab === "overview" ? "is-overview" : ""}`}>
          {marketTab === "orders" ? <CoinConditionalOrders coin={coin} holdingQuantity={data.holding.availableQuantity} availableBalance={data.availableBalance} compact onBalanceChange={() => { void refreshProfile(); void load(true); }} /> : null}
          {marketTab === "holders" ? (data.topHolders.length ? <div className="mxm-coin-list">{data.topHolders.map((holder, index) => <Link href={`/u/${holder.id}`} key={holder.id} className="mxm-coin-list-row"><span className="w-4 text-[var(--muted-2)]">{index + 1}</span><span className="min-w-0 flex-1 truncate">{holder.name}</span>{holder.genesisOrdinal ? <span className="text-[7px] text-[#d9c27a]">#{holder.genesisOrdinal}</span> : null}<strong>{compact(holder.quantity)}</strong></Link>)}</div> : <Empty text="Владельцев пока нет" />) : null}
          {marketTab === "activity" ? (data.trades.length ? <div className="mxm-coin-list">{data.trades.map((trade) => <div key={trade.id} className="mxm-coin-list-row"><span className={trade.side === "buy" ? "text-[var(--positive)]" : "text-[var(--negative)]"}>{trade.side === "buy" ? "Покупка" : "Продажа"}</span><span className="min-w-0 flex-1 truncate text-[var(--muted)]">{trade.traderName}</span><strong>{money(trade.quoteAmount)}</strong></div>)}</div> : <Empty text="Сделок пока нет" />) : null}
          {marketTab === "overview" ? <div className="hidden h-full lg:grid lg:place-items-center"><button type="button" onClick={() => setMetricsOpen(true)} className="inline-flex items-center gap-2 text-[10px] text-[var(--muted)] hover:text-white"><BarChart3 size={13} />Открыть метрики рынка</button></div> : null}
        </section>
      </div>

      {metricsOpen ? <MetricsSheet coin={coin} economy={data.economy} flow={flow} buyShare={buyShare} publicTradeCount={publicTradeCount} pristine={pristineMarket} onClose={() => setMetricsOpen(false)} /> : null}
    </div>
  );
}

function MetricsSheet({ coin, economy, flow, buyShare, publicTradeCount, pristine, onClose }: { coin: Coin; economy: CoinEconomy; flow: number; buyShare: number; publicTradeCount: number; pristine: boolean; onClose: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 px-2 pb-[max(8px,env(safe-area-inset-bottom))] md:items-center" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Метрики мемкоина" className="mxm-coin-metrics-sheet w-full max-w-lg rounded-[22px] border border-[var(--border)] bg-[var(--bg)] p-3 shadow-[0_-18px_60px_rgba(0,0,0,.5)]">
      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">Метрики</p><p className="mt-0.5 text-[8px] text-[var(--muted)]">${coin.symbol} · рынок</p></div><button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-full bg-white/[.035] text-[var(--muted)]"><X size={14} /></button></div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Капитализация" value={money(coin.marketCap)} />
        <Metric label="Ликвидность" value={money(coin.liquidity)} />
        <Metric label="Объём 24ч" value={pristine ? "0 TON" : money(coin.volume24h)} />
        <Metric label="Сделки" value={String(publicTradeCount)} />
        <Metric label="Владельцы" value={String(coin.holderCount)} />
        <Metric label="Макс. цена" value={price(coin.athPrice)} />
        <Metric label="Старт рынка" value={price(economy.marketOpenPrice || economy.startPrice)} />
        <Metric label="Мин. цена" value={economy.floorActive && economy.floorPrice ? price(economy.floorPrice) : "—"} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2"><Metric label="Автор" value={`${economy.creatorFeeBps / 100}% комиссии`} /><Metric label="Заблокировано" value={economy.lock ? `${compact(economy.lock.remaining)} ${coin.symbol}` : "—"} /></div>
      <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
        <div className="mb-1.5 flex items-center justify-between text-[8px] text-[var(--muted)]"><span>Поток 24ч</span><span>{flow > 0 ? `${buyShare.toFixed(0)}% покупок` : "Нет объёма"}</span></div>
        <div className="flex h-1 overflow-hidden rounded-full bg-[#15191d]"><span className="bg-[var(--positive)]" style={{ width: `${buyShare}%` }} /><span className="bg-[var(--negative)]" style={{ width: `${flow > 0 ? 100 - buyShare : 0}%` }} /></div>
        <div className="mt-1.5 flex justify-between text-[8px]"><span className="text-[var(--positive)]">Покупки {pristine ? "0 TON" : money(coin.buyVolume24h)}</span><span className="text-[var(--negative)]">Продажи {pristine ? "0 TON" : money(coin.sellVolume24h)}</span></div>
      </div>
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-[12px] bg-white/[.025] px-2.5 py-2 ring-1 ring-inset ring-white/[.035]"><p className="text-[7px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-[10px] font-semibold tabular-nums">{value}</p></div>; }
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div><p className="text-[7px] text-[var(--muted)]">{label}</p><p className={`mt-0.5 truncate text-[9px] font-medium tabular-nums ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function QuoteCompact({ label, value, warning }: { label: string; value: string; warning?: boolean }) { return <div className="min-w-0"><p className="text-[7px] text-[var(--muted)]">{label}</p><p className={`mt-0.5 truncate text-[9px] font-medium tabular-nums ${warning ? "text-[var(--negative)]" : ""}`}>{value}</p></div>; }
function Empty({ text }: { text: string }) { return <div className="grid h-full min-h-20 place-items-center text-[9px] text-[var(--muted)]">{text}</div>; }
