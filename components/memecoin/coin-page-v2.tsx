"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  Crown,
  Rocket,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Star,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { calculateCoinQuote } from "@/lib/amm";
import type { CoinPulse } from "@/lib/coin-pulse";
import {
  creatorReputationLabel,
  memecoinActivityLabels,
  memecoinFlagLabel,
  memecoinHealthLabels,
  memecoinLifecycleLabels,
  memecoinRiskLabels,
} from "@/lib/memecoin-labels";
import { compact, money, percent, price } from "@/lib/format";
import { MIN_COIN_BUY_TON, nonNegativeEconomyValue, parseEconomyAmount } from "@/lib/economy";
import type { Candle, Coin, CoinQuote, Trade } from "@/lib/types";
import { openTelegramLinkSafely } from "@/lib/telegram-webapp";

const CoinChart = dynamic(() => import("@/components/coin-chart").then((module) => module.CoinChart), {
  ssr: false,
  loading: () => <div className="mxm-skeleton h-[190px] rounded-[18px]" />,
});

const CoinConditionalOrders = dynamic(() => import("@/components/coin-conditional-orders").then((module) => module.CoinConditionalOrders), {
  ssr: false,
  loading: () => <div className="mxm-skeleton h-32 rounded-[18px]" />,
});

const realtimeTables = ["coins", "trades"];
type MarketTab = "trade" | "orders" | "holders" | "events";
type CoinTrade = Trade & { genesisOrdinal: number | null };
type CoinEvent = {
  id: string;
  kind: string;
  actorId: string | null;
  actorName: string;
  amount: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};
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
  pulse: CoinPulse;
  candles: Candle[];
  trades: CoinTrade[];
  events: CoinEvent[];
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
  globalThis.crypto?.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bps(value: number) {
  const percentValue = Math.max(0, value) / 100;
  return `${percentValue.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function eventText(event: CoinEvent) {
  const target = Number(event.metadata.target || 0);
  switch (event.kind) {
    case "coin_whale_buy": return { title: "Крупная покупка", detail: event.amount == null ? event.actorName : `${event.actorName} · ${money(event.amount)}`, tone: "positive" as const };
    case "coin_whale_sell": return { title: "Крупная продажа", detail: event.amount == null ? event.actorName : `${event.actorName} · ${money(event.amount)}`, tone: "negative" as const };
    case "coin_ath": return { title: "Новый максимум цены", detail: event.amount == null ? event.actorName : price(event.amount), tone: "positive" as const };
    case "coin_graduated": return { title: "Выход на основной рынок", detail: "Монета выполнила все требования развития", tone: "positive" as const };
    case "coin_holder_milestone": return { title: "Рубеж владельцев", detail: target > 0 ? `${compact(target)} владельцев` : "Новый уровень сообщества", tone: "default" as const };
    case "coin_volume_milestone": return { title: "Рубеж объёма", detail: target > 0 ? `${compact(target)} TON общего объёма` : "Новый торговый рубеж", tone: "default" as const };
    default: return { title: "Событие рынка", detail: event.actorName, tone: "default" as const };
  }
}

export function MemecoinPageV2() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [tab, setTab] = useState<MarketTab>("trade");
  const [amount, setAmount] = useState("");
  const [sellAll, setSellAll] = useState(false);
  const [slippage, setSlippage] = useState(2);
  const [tradeNotice, setTradeNotice] = useState<string | null>(null);
  const [impactArmed, setImpactArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadSeq = useRef(0);
  const tradeInFlight = useRef(false);
  const tradeRequestId = useRef<string | null>(null);
  const openedReloaded = useRef(false);
  const { refreshProfile, patchProfile, haptic } = useTelegramProfile();
  const realtimeFilters = useMemo(() => ({ coins: `id=eq.${id}`, trades: `coin_id=eq.${id}` }), [id]);

  const load = useCallback(async (silent = false) => {
    const seq = ++loadSeq.current;
    try {
      const payload = await apiFetch<Payload>(`/api/coins/${id}`, { cacheMs: 0 });
      if (seq !== loadSeq.current || tradeInFlight.current) return;
      setData(payload);
      setError(null);
    } catch (cause) {
      if (!silent && seq === loadSeq.current) setError(cause instanceof Error ? cause.message : "Не удалось загрузить мемкоин");
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const savedTab = window.sessionStorage.getItem("mxm-memecoin-v2-tab");
    if (savedTab === "trade" || savedTab === "orders" || savedTab === "holders" || savedTab === "events") setTab(savedTab);
    const savedSlippage = Number(window.sessionStorage.getItem("mxm-coin-slippage"));
    if ([0.5, 1, 2, 5].includes(savedSlippage)) setSlippage(savedSlippage);
    const requestedSide = new URLSearchParams(window.location.search).get("side");
    if (requestedSide === "buy" || requestedSide === "sell") setSide(requestedSide);
  }, []);

  useEffect(() => { window.sessionStorage.setItem("mxm-memecoin-v2-tab", tab); }, [tab]);
  useEffect(() => { window.sessionStorage.setItem("mxm-coin-slippage", String(slippage)); }, [slippage]);

  const opensAtMs = data?.pulse.lifecycle.opensAt ? Date.parse(data.pulse.lifecycle.opensAt) : Number.NaN;
  const secondsToOpen = Number.isFinite(opensAtMs) ? Math.max(0, Math.ceil((opensAtMs - now) / 1000)) : 0;
  const tradingOpen = Boolean(data && (data.pulse.lifecycle.tradingOpen || secondsToOpen <= 0));

  useEffect(() => {
    if (!data || data.pulse.lifecycle.tradingOpen || !Number.isFinite(opensAtMs)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [data, opensAtMs]);

  useEffect(() => {
    if (!data || data.pulse.lifecycle.tradingOpen || secondsToOpen > 0 || openedReloaded.current) return;
    openedReloaded.current = true;
    void load(true);
  }, [data, secondsToOpen, load]);

  const realtimeReload = useCallback(() => {
    if (!tradeInFlight.current) void load(true);
  }, [load]);

  const max = useMemo(() => side === "buy" ? data?.availableBalance || 0 : data?.holding.availableQuantity || 0, [data, side]);
  const parsedAmount = parseEconomyAmount(amount);
  const numericAmount = parsedAmount ?? 0;
  const belowMinimumBuy = side === "buy" && numericAmount > 0 && numericAmount < MIN_COIN_BUY_TON;
  const validAmount = Boolean(data && tradingOpen && parsedAmount != null && numericAmount > 0 && !belowMinimumBuy && (sellAll && side === "sell" ? max > 0 : numericAmount <= max));
  const quote = useMemo(() => {
    if (!data || !validAmount) return null;
    const input = sellAll && side === "sell" ? data.holding.availableQuantity : numericAmount;
    return calculateCoinQuote({
      side,
      amount: input,
      tokenReserve: data.coin.tokenReserve,
      quoteReserve: data.coin.quoteReserve,
      currentPrice: data.coin.currentPrice,
      feeRate: Math.max(0, Number(data.economy.totalFeeBps || 0)) / 10_000,
      floorPrice: data.economy.floorPrice,
      floorActive: data.economy.floorActive,
    });
  }, [data, validAmount, sellAll, side, numericAmount]);

  function switchSide(next: "buy" | "sell") {
    setSide(next);
    setAmount("");
    setSellAll(false);
    tradeRequestId.current = null;
    setTradeNotice(null);
    setImpactArmed(false);
    setError(null);
  }

  function applyFraction(fraction: number) {
    if (!data) return;
    tradeRequestId.current = null;
    setImpactArmed(false);
    setTradeNotice(null);
    if (side === "sell" && fraction === 1) {
      setSellAll(true);
      setAmount(amountText(data.holding.availableQuantity));
      return;
    }
    setSellAll(false);
    setAmount(amountText(max * fraction));
  }

  async function trade() {
    if (!data || busy || !quote || !validAmount || tradeInFlight.current || !tradingOpen) return;
    const previous = data;
    const requestedInputAmount = sellAll && side === "sell" ? data.holding.availableQuantity : numericAmount;
    const wasSellAll = side === "sell" && sellAll;
    tradeInFlight.current = true;
    setBusy(true);
    setError(null);

    let authoritativeQuote: CoinQuote;
    try {
      const quoteResult = await apiFetch<{ quote: CoinQuote }>(`/api/coins/${id}/quote`, {
        method: "POST",
        body: JSON.stringify({ side, amount: requestedInputAmount }),
      });
      authoritativeQuote = quoteResult.quote;
      if (!authoritativeQuote
        || authoritativeQuote.side !== side
        || !Number.isFinite(authoritativeQuote.inputAmount)
        || !Number.isFinite(authoritativeQuote.outputAmount)
        || !Number.isFinite(authoritativeQuote.executionPrice)
        || !Number.isFinite(authoritativeQuote.projectedPrice)
        || !Number.isFinite(authoritativeQuote.priceImpact)
        || authoritativeQuote.inputAmount <= 0
        || authoritativeQuote.outputAmount <= 0) {
        throw new Error("Сервер вернул некорректную котировку");
      }
    } catch (cause) {
      tradeInFlight.current = false;
      setBusy(false);
      setTradeNotice(null);
      setError(cause instanceof Error ? cause.message : "Не удалось обновить котировку");
      void load(true);
      return;
    }

    if (authoritativeQuote.priceImpact >= 10 && !impactArmed) {
      tradeInFlight.current = false;
      setBusy(false);
      setImpactArmed(true);
      setTradeNotice(`Влияние на цену ${authoritativeQuote.priceImpact.toFixed(1)}%. Нажми ещё раз для подтверждения.`);
      haptic("light");
      return;
    }
    setImpactArmed(false);

    const inputAmount = authoritativeQuote.inputAmount;
    const oldQuantity = data.holding.quantity;
    const oldAvailableQuantity = data.holding.availableQuantity;
    const oldCost = data.holding.costBasis;
    const nextTokenReserve = side === "buy" ? data.coin.tokenReserve - authoritativeQuote.outputAmount : data.coin.tokenReserve + inputAmount;
    if (!Number.isFinite(nextTokenReserve) || nextTokenReserve <= 0) {
      tradeInFlight.current = false;
      setBusy(false);
      setError("Сделка слишком большая для текущей ликвидности");
      return;
    }
    const nextQuoteReserve = (data.coin.tokenReserve * data.coin.quoteReserve) / nextTokenReserve;
    const costReduction = side === "sell" && oldQuantity > 0 ? oldCost * Math.min(1, inputAmount / oldQuantity) : 0;
    const optimistic: Payload = {
      ...data,
      coin: {
        ...data.coin,
        currentPrice: authoritativeQuote.projectedPrice,
        marketCap: authoritativeQuote.projectedPrice * data.coin.totalSupply,
        tokenReserve: nextTokenReserve,
        quoteReserve: nextQuoteReserve,
      },
      holding: side === "buy"
        ? { quantity: oldQuantity + authoritativeQuote.outputAmount, availableQuantity: oldAvailableQuantity + authoritativeQuote.outputAmount, costBasis: oldCost + inputAmount }
        : { quantity: Math.max(0, oldQuantity - inputAmount), availableQuantity: Math.max(0, oldAvailableQuantity - inputAmount), costBasis: Math.max(0, oldCost - costReduction) },
      balance: side === "buy" ? nonNegativeEconomyValue(data.balance - inputAmount) : data.balance + authoritativeQuote.outputAmount,
      availableBalance: side === "buy" ? nonNegativeEconomyValue(data.availableBalance - inputAmount) : data.availableBalance + authoritativeQuote.outputAmount,
    };

    setTradeNotice(null);
    setData(optimistic);
    patchProfile({ balance: optimistic.balance, availableBalance: optimistic.availableBalance });
    setAmount("");
    setSellAll(false);
    haptic("medium");

    try {
      const minOutput = Math.max(0, authoritativeQuote.outputAmount * (1 - slippage / 100));
      const requestId = tradeRequestId.current || makeTradeRequestId();
      tradeRequestId.current = requestId;
      await apiFetch("/api/trade", {
        method: "POST",
        body: JSON.stringify({ requestId, coinId: id, side, amount: inputAmount, sellAll: wasSellAll, minOutput }),
      });
      tradeRequestId.current = null;
      tradeInFlight.current = false;
      setBusy(false);
      setTradeNotice(side === "buy" ? `Получено ${compact(authoritativeQuote.outputAmount)} ${data.coin.symbol}` : `Получено ${money(authoritativeQuote.outputAmount)}`);
      haptic("light");
      void refreshProfile();
      void load(true);
    } catch (cause) {
      tradeInFlight.current = false;
      setBusy(false);
      setData(previous);
      patchProfile({ balance: previous.balance, availableBalance: previous.availableBalance });
      setAmount(amountText(inputAmount));
      setSellAll(wasSellAll);
      setTradeNotice(null);
      const message = cause instanceof Error ? cause.message : "Сделка не выполнена";
      setError((message.includes("Insufficient token balance") || message.includes("unreserved token")) ? "Баланс изменился. Нажми МАКС ещё раз." : message);
      void load(true);
    }
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
    } finally {
      setWatchBusy(false);
    }
  }

  function shareCoin() {
    if (!data) return;
    const target = typeof window !== "undefined" ? `${window.location.origin}/coin/${id}` : "";
    const text = `${data.coin.name} ($${data.coin.symbol}) в MemeX Market`;
    openTelegramLinkSafely(`https://t.me/share/url?url=${encodeURIComponent(target)}&text=${encodeURIComponent(text)}`);
    haptic("light");
  }

  if (!data) {
    return <div className="mx-auto max-w-6xl"><div className="mxm-skeleton h-[620px] rounded-[22px]" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  }

  const { coin, pulse } = data;
  const publicTradeCount = Math.max(0, data.economy.publicTradeCount ?? coin.tradeCount24h);
  const pristine = publicTradeCount === 0 && coin.allTimeVolume <= 0;
  const holdingValue = data.holding.quantity * coin.currentPrice;
  const holdingPnl = holdingValue - data.holding.costBasis;
  const chartCandles = pristine ? [] : data.candles;
  const uniqueFlags = [...new Set([...pulse.health.flags, ...pulse.risk.flags])];
  const stageLabel = memecoinLifecycleLabels[pulse.lifecycle.key];
  const riskLabel = memecoinRiskLabels[pulse.risk.grade];
  const reputation = pulse.creatorReputation;
  const graduationDone = pulse.lifecycle.key === "graduated" || pulse.lifecycle.key === "elite" || pulse.lifecycle.key === "legendary";
  const launchLabel = !tradingOpen ? `Открытие через ${secondsToOpen} сек.` : graduationDone ? "Основной рынок открыт" : "Торги открыты";

  const tradePanel = (
    <section className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-3.5">
      <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-[var(--panel)] p-1">
        <button disabled={busy || !tradingOpen} onClick={() => switchSide("buy")} className={`mxm-pressable rounded-[11px] py-2.5 text-[11px] font-semibold transition ${side === "buy" ? "bg-[var(--positive)] text-black" : "text-[var(--muted)]"}`}>Купить</button>
        <button disabled={busy || !tradingOpen} onClick={() => switchSide("sell")} className={`mxm-pressable rounded-[11px] py-2.5 text-[11px] font-semibold transition ${side === "sell" ? "bg-[var(--negative)] text-white" : "text-[var(--muted)]"}`}>Продать</button>
      </div>

      {!tradingOpen ? <div className="mt-3 rounded-[14px] border border-[var(--border-soft)] bg-[var(--panel)] p-3 text-center"><Clock3 size={17} className="mx-auto text-[var(--accent)]" /><p className="mt-2 text-[11px] font-semibold">Идёт подготовка рынка</p><p className="mt-1 text-[10px] text-[var(--muted)]">Торги откроются автоматически через {secondsToOpen} сек.</p></div> : <>
        <div className="mt-3 flex items-center justify-between text-[9px]"><span className="text-[var(--muted)]">Доступно</span><strong className="font-medium">{side === "buy" ? money(data.availableBalance) : `${compact(data.holding.availableQuantity)} ${coin.symbol}`}</strong></div>
        <div className="mt-1.5 flex items-center rounded-[13px] border border-[var(--border-soft)] bg-[var(--panel)] px-3">
          <input value={amount} onChange={(event) => { tradeRequestId.current = null; setImpactArmed(false); setTradeNotice(null); setAmount(event.target.value.replace(",", ".")); setSellAll(false); }} inputMode="decimal" placeholder={side === "buy" ? String(MIN_COIN_BUY_TON) : "0"} className="min-w-0 flex-1 bg-transparent py-3 text-base font-medium outline-none" />
          <span className="text-[10px] text-[var(--muted)]">{side === "buy" ? "TON" : coin.symbol}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex gap-1">{[0.1, 0.25, 0.5, 1].map((fraction) => <button key={fraction} type="button" onClick={() => applyFraction(fraction)} className="rounded-lg bg-[var(--panel)] px-2 py-1 text-[8px] text-[var(--muted)] hover:text-white">{fraction === 1 ? "МАКС" : `${fraction * 100}%`}</button>)}</div>
          <div className="flex items-center gap-1.5 text-[8px] text-[var(--muted)]"><span>Допуск</span>{[0.5, 1, 2, 5].map((value) => <button key={value} type="button" onClick={() => { setSlippage(value); setImpactArmed(false); setTradeNotice(null); }} className={slippage === value ? "font-semibold text-white" : "hover:text-white"}>{value}%</button>)}</div>
        </div>

        {quote ? <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border-soft)] pt-3 sm:grid-cols-3">
          <QuoteStat label="Отдаёшь" value={side === "buy" ? money(numericAmount) : `${compact(numericAmount)} ${coin.symbol}`} />
          <QuoteStat label="Получишь" value={side === "buy" ? `${compact(quote.outputAmount)} ${coin.symbol}` : money(quote.outputAmount)} />
          <QuoteStat label="Новая цена" value={price(quote.projectedPrice)} />
          <QuoteStat label="Средняя цена" value={price(quote.executionPrice)} />
          <QuoteStat label="Комиссия" value={money(quote.feeAmount)} />
          <QuoteStat label="Влияние на цену" value={`${quote.priceImpact.toFixed(2)}%`} warning={quote.priceImpact >= 10} />
        </div> : null}

        {belowMinimumBuy ? <p className="mt-2 text-[9px] text-[var(--muted)]">Минимальная покупка: {MIN_COIN_BUY_TON} TON.</p> : null}
        {parsedAmount != null && numericAmount > max && !sellAll ? <p className="mt-2 text-[9px] text-[var(--negative)]">Недостаточно доступного баланса.</p> : null}
        {side === "sell" && data.economy.lock?.remaining ? <p className="mt-2 text-[9px] text-[var(--accent)]">Заблокировано у автора: {compact(data.economy.lock.remaining)} {coin.symbol}</p> : null}
        {tradeNotice ? <p aria-live="polite" className={`mt-2 text-[10px] font-medium ${impactArmed ? "text-[var(--accent)]" : "text-[var(--positive)]"}`}>{tradeNotice}</p> : null}
        {error ? <p className="mt-2 text-[10px] text-[var(--negative)]">{error}</p> : null}

        <PrimaryButton onClick={trade} disabled={busy || !quote || !validAmount} className={`mt-3 w-full !min-h-10 !rounded-[13px] ${side === "sell" ? "!bg-[var(--negative)] !text-white" : "!bg-[var(--positive)] !text-black"}`}>{busy ? "Подтверждаем…" : impactArmed ? "Подтвердить сделку" : side === "buy" ? `Купить $${coin.symbol}` : `Продать $${coin.symbol}`}</PrimaryButton>
      </>}

      {data.holding.quantity > 0 ? <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border-soft)] pt-3"><MiniStat label="Моя позиция" value={money(holdingValue)} /><MiniStat label="Результат" value={money(holdingPnl)} tone={holdingPnl} /></div> : null}
    </section>
  );

  return (
    <div className="mx-auto max-w-6xl mxm-page-enter">
      <RealtimeRefresh channelName={`mxm-memecoin-v2-${id}`} tables={realtimeTables} filters={realtimeFilters} onChange={realtimeReload} debounceMs={700} />

      <header className="mb-3 flex items-center gap-2">
        <Link href="/market?tab=coins" className="inline-flex items-center gap-1.5 text-[10px] text-[var(--muted)] hover:text-white"><ArrowLeft size={14} />Мемкоины</Link>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={shareCoin} aria-label="Поделиться мемкоином" className="header-action"><Share2 size={15} /></button>
          <button type="button" onClick={toggleWatch} disabled={watchBusy} aria-label={data.watched ? "Убрать из избранного" : "Добавить в избранное"} className={`header-action ${data.watched ? "is-active" : ""}`}><Star size={15} fill={data.watched ? "currentColor" : "none"} /></button>
        </div>
      </header>

      <section className="rounded-[20px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-4">
        <div className="flex items-center gap-3">
          <CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5"><h1 className="truncate text-[16px] font-semibold tracking-[-.02em]">{coin.name}</h1><span className="text-[10px] text-[var(--muted)]">${coin.symbol}</span>{pulse.verification.coinVerified ? <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(92,157,255,.12)] px-1.5 py-0.5 text-[8px] font-semibold text-[#74adff]"><ShieldCheck size={9} />Проверен</span> : null}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"><strong className="text-[13px] tabular-nums">{price(coin.currentPrice)}</strong><span className={`text-[10px] font-medium ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(pristine ? 0 : coin.change24h)}</span><span className="text-[9px] text-[var(--muted)]">{launchLabel}</span></div>
          </div>
        </div>

        {coin.description ? <p className="mt-3 text-[10px] leading-5 text-[var(--muted)]">{coin.description}</p> : null}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusCard label="Активность" value={`${pulse.heat.score}/100`} detail={memecoinActivityLabels[pulse.heat.tier]} icon={<Activity size={13} />} />
          <StatusCard label="Этап" value={stageLabel} detail={graduationDone ? "Развитие завершено" : `${pulse.lifecycle.graduationProgressPct}% до выпуска`} icon={<Rocket size={13} />} />
          <StatusCard label="Риск" value={`${pulse.risk.score}/100`} detail={riskLabel} icon={pulse.risk.score >= 50 ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />} tone={pulse.risk.score >= 50 ? -1 : pulse.risk.score < 25 ? 1 : 0} />
          <StatusCard label="Ранний участник" value={pulse.og.userOrdinal ? `OG #${pulse.og.userOrdinal}` : `${pulse.og.count}/${pulse.og.limit}`} detail={pulse.og.userOrdinal ? "Твоё место" : `${pulse.og.remaining} мест осталось`} icon={<Crown size={13} />} />
        </div>
      </section>

      {!tradingOpen ? <section className="mt-3 overflow-hidden rounded-[18px] border border-[rgba(198,170,88,.28)] bg-[linear-gradient(120deg,rgba(198,170,88,.12),rgba(198,170,88,.025))] p-4">
        <div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[rgba(198,170,88,.12)] text-[var(--accent)]"><Clock3 size={17} /></div><div className="min-w-0"><p className="text-[12px] font-semibold">Подготовка запуска</p><p className="mt-1 text-[10px] leading-5 text-[var(--muted)]">Рынок уже создан, но публичные сделки начнутся одновременно для всех. До открытия осталось <strong className="text-white">{secondsToOpen} сек.</strong></p></div></div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,.06)]"><div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, 100 - secondsToOpen / 45 * 100))}%` }} /></div>
      </section> : null}

      <section className="mt-3 rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[12px] font-semibold">Выпуск на основной рынок</p><p className="mt-1 text-[9px] text-[var(--muted)]">Нужно выполнить все три требования. Слабое место ограничивает общий прогресс.</p></div>{graduationDone ? <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--positive)]"><CheckCircle2 size={12} />Выпущен</span> : <strong className="text-sm">{pulse.lifecycle.graduationProgressPct}%</strong>}</div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel)]"><div className="h-full rounded-full bg-[var(--positive)] transition-[width] duration-500" style={{ width: `${pulse.lifecycle.graduationProgressPct}%` }} /></div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <TargetProgress label="Владельцы" current={pulse.lifecycle.targets.holders.current} target={pulse.lifecycle.targets.holders.target} />
          <TargetProgress label="Трейдеры" current={pulse.lifecycle.targets.traders.current} target={pulse.lifecycle.targets.traders.target} />
          <TargetProgress label="Объём" current={pulse.lifecycle.targets.volume.current} target={pulse.lifecycle.targets.volume.target} moneyValue />
        </div>
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,.75fr)]">
        <section className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-3">
          <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-medium text-[var(--muted)]">График цены</span><span className="text-[9px] text-[var(--muted-2)]">{pristine ? "Первая свеча появится после сделки" : `${publicTradeCount} сделок`}</span></div>
          <CoinChart candles={chartCandles} height={184} baseFrame="15m" compact emptyLabel={pristine ? "Торгов пока не было" : "История цены обновляется…"} />
        </section>

        <section className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-4">
          <div className="flex items-center gap-2"><TrendingUp size={14} className="text-[var(--accent)]" /><p className="text-[12px] font-semibold">Сигналы рынка</p></div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <InfoStat label="Сила тренда" value={`${pulse.signals.trendScore}/100`} />
            <InfoStat label="Крупных сделок 24ч" value={String(pulse.signals.whaleTrades24h)} />
            <InfoStat label="Уникальных покупателей" value={String(pulse.signals.uniqueBuyers24h)} />
            <InfoStat label="Уникальных продавцов" value={String(pulse.signals.uniqueSellers24h)} />
            <InfoStat label="Порог крупной сделки" value={money(pulse.signals.whaleThreshold)} />
            <InfoStat label="Просадка от максимума" value={bps(pulse.risk.drawdownBps)} />
          </div>
        </section>
      </div>

      <div className="mt-3 flex overflow-x-auto border-b border-[var(--border-soft)]" role="tablist" aria-label="Разделы мемкоина">
        {([["trade", "Торговля"], ["orders", "Заявки"], ["holders", "Владельцы"], ["events", "События"]] as Array<[MarketTab, string]>).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`shrink-0 border-b-2 px-4 py-3 text-[10px] font-semibold transition ${tab === key ? "border-white text-white" : "border-transparent text-[var(--muted)]"}`}>{label}</button>)}
      </div>

      <div className="mt-3">
        {tab === "trade" ? <div className="grid gap-3 lg:grid-cols-[minmax(300px,.8fr)_minmax(0,1.2fr)]">
          {tradePanel}
          <section className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-4">
            <p className="text-[12px] font-semibold">Состояние рынка</p>
            <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
              <InfoStat label="Капитализация" value={money(coin.marketCap)} />
              <InfoStat label="Ликвидность" value={money(coin.liquidity)} />
              <InfoStat label="Объём 24ч" value={money(coin.volume24h)} />
              <InfoStat label="Всего владельцев" value={String(coin.holderCount)} />
              <InfoStat label="Здоровье рынка" value={`${pulse.health.score}/100 · ${memecoinHealthLabels[pulse.health.grade]}`} />
              <InfoStat label="Доля покупок 24ч" value={bps(pulse.heat.buyShareBps)} />
            </div>

            <div className="mt-4 border-t border-[var(--border-soft)] pt-4">
              <p className="text-[10px] font-semibold">Распределение</p>
              <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
                <InfoStat label="Крупнейший владелец" value={bps(pulse.distribution.topHolderShareBps)} />
                <InfoStat label="Топ-3 владельца" value={bps(pulse.distribution.top3ShareBps)} />
                <InfoStat label="Доля автора" value={bps(pulse.distribution.creatorShareBps)} />
                <InfoStat label="Заблокировано у автора" value={bps(pulse.distribution.creatorLockedShareBps)} />
              </div>
            </div>

            <div className="mt-4 border-t border-[var(--border-soft)] pt-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold">Репутация автора</p><p className="mt-1 text-[9px] text-[var(--muted)]">{coin.creatorName || "Автор"} · {creatorReputationLabel(reputation.grade)}</p></div><strong className="text-sm">{reputation.score}/100</strong></div>
              <div className="mt-2 grid grid-cols-3 gap-2"><TinyMetric label="Внешние владельцы" value={reputation.externalHolders} /><TinyMetric label="Трейдеры" value={reputation.uniqueTraders} /><TinyMetric label="Объём" value={compact(reputation.externalVolume)} /></div>
            </div>

            {uniqueFlags.length ? <div className="mt-4 border-t border-[var(--border-soft)] pt-4"><p className="flex items-center gap-1.5 text-[10px] font-semibold"><ShieldAlert size={12} />На что обратить внимание</p><div className="mt-2 flex flex-wrap gap-1.5">{uniqueFlags.map((flag) => <span key={flag} className="rounded-full bg-[var(--panel)] px-2 py-1 text-[8px] text-[var(--muted)]">{memecoinFlagLabel(flag)}</span>)}</div></div> : <div className="mt-4 flex items-center gap-2 border-t border-[var(--border-soft)] pt-4 text-[9px] text-[var(--positive)]"><ShieldCheck size={12} />Критических рыночных сигналов сейчас нет.</div>}
          </section>
        </div> : null}

        {tab === "orders" ? (!tradingOpen ? <EmptyState icon={<Clock3 />} title="Заявки откроются вместе с торгами" text={`Осталось ${secondsToOpen} сек.`} /> : <CoinConditionalOrders coin={coin} holdingQuantity={data.holding.availableQuantity} availableBalance={data.availableBalance} compact onBalanceChange={() => { void refreshProfile(); void load(true); }} />) : null}

        {tab === "holders" ? (data.topHolders.length ? <section className="overflow-hidden rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)]"><div className="border-b border-[var(--border-soft)] px-4 py-3 text-[10px] font-semibold">Крупнейшие владельцы</div>{data.topHolders.map((holder, index) => <Link href={`/u/${holder.id}`} key={holder.id} className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3 last:border-b-0"><span className="w-5 text-[9px] text-[var(--muted)]">#{index + 1}</span><span className="min-w-0 flex-1 truncate text-[10px]">{holder.name}</span>{holder.genesisOrdinal ? <span className="rounded-full bg-[rgba(198,170,88,.12)] px-1.5 py-0.5 text-[8px] text-[var(--accent)]">OG #{holder.genesisOrdinal}</span> : null}<strong className="text-[10px]">{compact(holder.quantity)}</strong></Link>)}</section> : <EmptyState icon={<Users />} title="Владельцев пока нет" text="Первые участники появятся после открытия торгов." />) : null}

        {tab === "events" ? <div className="grid gap-3 lg:grid-cols-2">
          <section className="overflow-hidden rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)]"><div className="border-b border-[var(--border-soft)] px-4 py-3 text-[10px] font-semibold">Ключевые события</div>{data.events.length ? data.events.map((event) => { const item = eventText(event); return <div key={event.id} className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3 last:border-b-0"><div className={`h-2 w-2 shrink-0 rounded-full ${item.tone === "positive" ? "bg-[var(--positive)]" : item.tone === "negative" ? "bg-[var(--negative)]" : "bg-[var(--muted)]"}`} /><div className="min-w-0 flex-1"><p className="text-[10px] font-medium">{item.title}</p><p className="mt-1 truncate text-[9px] text-[var(--muted)]">{item.detail}</p></div><span className="text-[8px] text-[var(--muted-2)]">{formatTime(event.createdAt)}</span></div>; }) : <div className="p-5 text-center text-[10px] text-[var(--muted)]">Ключевых событий пока не было.</div>}</section>
          <section className="overflow-hidden rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)]"><div className="border-b border-[var(--border-soft)] px-4 py-3 text-[10px] font-semibold">Последние сделки</div>{data.trades.length ? data.trades.slice(0, 20).map((trade) => <div key={trade.id} className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3 last:border-b-0"><span className={`text-[9px] font-semibold ${trade.side === "buy" ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{trade.side === "buy" ? "Покупка" : "Продажа"}</span><span className="min-w-0 flex-1 truncate text-[9px] text-[var(--muted)]">{trade.traderName}{trade.genesisOrdinal ? ` · OG #${trade.genesisOrdinal}` : ""}</span><div className="text-right"><p className="text-[9px]">{money(trade.quoteAmount)}</p><p className="mt-1 text-[8px] text-[var(--muted-2)]">{formatTime(trade.createdAt)}</p></div></div>) : <div className="p-5 text-center text-[10px] text-[var(--muted)]">Сделок пока не было.</div>}</section>
        </div> : null}
      </div>
    </div>
  );
}

function StatusCard({ label, value, detail, icon, tone = 0 }: { label: string; value: string; detail: string; icon: React.ReactNode; tone?: number }) {
  return <div className="rounded-[14px] bg-[var(--panel)] p-2.5"><div className="flex items-center gap-1.5 text-[8px] text-[var(--muted)]">{icon}{label}</div><p className={`mt-1.5 truncate text-[11px] font-semibold ${tone > 0 ? "text-[var(--positive)]" : tone < 0 ? "text-[var(--negative)]" : ""}`}>{value}</p><p className="mt-1 truncate text-[8px] text-[var(--muted-2)]">{detail}</p></div>;
}

function TargetProgress({ label, current, target, moneyValue = false }: { label: string; current: number; target: number; moneyValue?: boolean }) {
  const done = target > 0 && current >= target;
  const currentText = moneyValue ? `${compact(current)} TON` : compact(current);
  const targetText = moneyValue ? `${compact(target)} TON` : compact(target);
  return <div className="rounded-[13px] bg-[var(--panel)] p-2.5"><div className="flex items-center justify-between gap-1"><span className="text-[8px] text-[var(--muted)]">{label}</span>{done ? <CheckCircle2 size={10} className="text-[var(--positive)]" /> : null}</div><p className="mt-1 text-[10px] font-semibold">{currentText}</p><p className="mt-0.5 text-[8px] text-[var(--muted-2)]">нужно {targetText}</p></div>;
}

function QuoteStat({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div><p className="text-[8px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-[10px] font-medium ${warning ? "text-[var(--accent)]" : ""}`}>{value}</p></div>;
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[8px] text-[var(--muted)]">{label}</p><p className="mt-1 break-words text-[10px] font-medium">{value}</p></div>;
}

function TinyMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-[12px] bg-[var(--panel)] p-2"><p className="truncate text-[7px] text-[var(--muted)]">{label}</p><p className="mt-1 text-[9px] font-semibold">{value}</p></div>;
}

function MiniStat({ label, value, tone = 0 }: { label: string; value: string; tone?: number }) {
  return <div><p className="text-[8px] text-[var(--muted)]">{label}</p><p className={`mt-1 text-[10px] font-semibold ${tone > 0 ? "text-[var(--positive)]" : tone < 0 ? "text-[var(--negative)]" : ""}`}>{value}</p></div>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-8 text-center"><div className="mx-auto grid h-9 w-9 place-items-center text-[var(--muted)]">{icon}</div><p className="mt-2 text-[11px] font-semibold">{title}</p><p className="mt-1 text-[9px] text-[var(--muted)]">{text}</p></div>;
}
