"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Gem, Target, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { useTelegramProfile } from "@/components/telegram-provider";
import { compact, money, price } from "@/lib/format";
import type { Coin } from "@/lib/types";

type Kind = "limit_buy" | "limit_sell" | "take_profit" | "stop_loss";
type Order = { id: string; kind: Kind; triggerPrice: number; inputAmount: number; status: string; expiresAt: string; result: unknown; failureReason: string | null; createdAt: string; executedAt: string | null };

const labels: Record<Kind, string> = { limit_buy: "Лимитная покупка", limit_sell: "Лимитная продажа", take_profit: "Фиксация прибыли", stop_loss: "Ограничение убытка" };
const statusLabels: Record<string, string> = { active: "Активна", executing: "Исполняется", filled: "Исполнена", cancelled: "Отменена", expired: "Истекла", failed: "Ошибка" };

function orderKindLabel(kind: Kind): string {
  return labels[kind];
}

function requestKey() {
  const value = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `coin-order:${value}`;
}

export function CoinConditionalOrders({ coin, holdingQuantity, availableBalance, onBalanceChange, compact: compactMode = false }: { coin: Coin; holdingQuantity: number; availableBalance: number; onBalanceChange: () => void; compact?: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [kind, setKind] = useState<Kind>("limit_buy");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [inputAmount, setInputAmount] = useState("");
  const [durationDays, setDurationDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { profile } = useTelegramProfile();

  const load = useCallback(async () => {
    try {
      const payload = await apiFetch<{ orders: Order[] }>(`/api/coins/${coin.id}/orders`, { cacheMs: 0 });
      setOrders(payload.orders);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить ордера"); }
  }, [coin.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const isBuy = kind === "limit_buy";
  const numericInput = Number(inputAmount);
  const numericTrigger = Number(triggerPrice);
  const max = isBuy ? availableBalance : holdingQuantity;
  const valid = Number.isFinite(numericInput) && numericInput > 0 && numericInput <= max && Number.isFinite(numericTrigger) && numericTrigger > 0;
  const active = useMemo(() => orders.filter((order) => order.status === "active"), [orders]);

  function setPercent(fraction: number) {
    setInputAmount((max * fraction).toFixed(8).replace(/\.?0+$/, ""));
  }

  async function create() {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/coins/${coin.id}/orders`, { method: "POST", body: JSON.stringify({ kind, triggerPrice: numericTrigger, inputAmount: numericInput, durationDays, requestKey: requestKey() }) });
      setInputAmount(""); setTriggerPrice("");
      await load();
      onBalanceChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать ордер"); }
    finally { setBusy(false); }
  }

  async function cancel(id: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/coin-orders/${id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
      await load(); onBalanceChange();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отменить ордер"); }
    finally { setBusy(false); }
  }

  return <section className={compactMode ? "min-h-0" : "border-t border-[var(--border-soft)] pt-4"}>
    {profile?.id ? <RealtimeRefresh channelName={`mxm-conditional-orders-${profile.id}`} tables={["coin_conditional_orders_v056"]} filters={{ coin_conditional_orders_v056: `profile_id=eq.${profile.id}` }} onChange={() => { void load(); }} debounceMs={650} /> : null}
    <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-1.5 text-[10px] font-medium"><Target size={12}/>Заявки</p><span className="text-[8px] text-[var(--muted)]">{active.length} активных</span></div>{!compactMode ? <p className="mt-1 text-[9px] leading-4 text-[var(--muted)]">Лимитные заявки, фиксация прибыли и ограничение убытка исполняются сервером при достижении цены. Покупка резервирует виртуальные TON.</p> : null}
    <div className={`${compactMode ? "mt-2" : "mt-3"} grid grid-cols-2 gap-2`}><select value={kind} onChange={(event) => setKind(event.target.value as Kind)} className={compactMode ? "mxm-input !min-h-9 !text-[10px]" : "mxm-input"}><option value="limit_buy">Лимитная покупка</option><option value="limit_sell">Лимитная продажа</option><option value="take_profit">Фиксация прибыли</option><option value="stop_loss">Ограничение убытка</option></select><select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))} className={compactMode ? "mxm-input !min-h-9 !text-[10px]" : "mxm-input"}><option value={1}>1 день</option><option value={3}>3 дня</option><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option></select></div>
    <div className="mt-1.5 grid grid-cols-2 gap-2"><label className="block"><span className="mb-1 block text-[9px] text-[var(--muted)]">Триггер цены</span><input value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value)} inputMode="decimal" placeholder={price(coin.currentPrice)} className={compactMode ? "mxm-input !min-h-9 !text-[10px]" : "mxm-input"} /></label><label className="block"><span className="mb-1 block text-[9px] text-[var(--muted)]">{isBuy ? "Сумма TON" : `Количество ${coin.symbol}`}</span><input value={inputAmount} onChange={(event) => setInputAmount(event.target.value)} inputMode="decimal" placeholder="0" className={compactMode ? "mxm-input !min-h-9 !text-[10px]" : "mxm-input"} /></label></div>
    <div className="mt-2 flex items-center justify-between gap-3 text-[9px] text-[var(--muted)]"><span>Доступно {isBuy ? money(availableBalance) : `${compact(holdingQuantity)} ${coin.symbol}`}</span><div className="flex gap-3">{[0.25,0.5,1].map((fraction)=><button type="button" key={fraction} onClick={()=>setPercent(fraction)}>{fraction===1?"МАКС":`${fraction*100}%`}</button>)}</div></div>
    {kind === "take_profit" && numericTrigger > 0 && numericTrigger <= coin.currentPrice ? <p className="mt-2 text-[9px] text-[var(--negative)]">Фиксацию прибыли обычно ставят выше текущей цены.</p> : null}
    {kind === "stop_loss" && numericTrigger > 0 && numericTrigger >= coin.currentPrice ? <p className="mt-2 text-[9px] text-[var(--negative)]">Ограничение убытка обычно ставят ниже текущей цены.</p> : null}
    {error ? <p className="mt-2 text-[10px] text-[var(--negative)]">{error}</p> : null}
    <button type="button" disabled={!valid || busy} onClick={() => void create()} className={`${compactMode ? "mt-1.5 min-h-9" : "mt-2 min-h-10"} flex w-full items-center justify-center gap-1.5 rounded-[13px] bg-[var(--panel-3)] text-[11px] font-semibold disabled:opacity-40`}><Gem size={11} fill="currentColor"/>{busy?"Сохраняем…":"Создать ордер"}</button>
    {orders.length ? <div className={`${compactMode ? "mt-2 max-h-28 overflow-auto" : "mt-3"} divide-y divide-[var(--border-soft)] border-t border-[var(--border-soft)]`}>{orders.slice(0,compactMode ? 6 : 12).map((order)=><div key={order.id} className="flex items-center gap-2 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium">{orderKindLabel(order.kind)} · {price(order.triggerPrice)}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{order.kind === "limit_buy" ? money(order.inputAmount) : `${compact(order.inputAmount)} ${coin.symbol}`} · <span className={order.status === "active" ? "text-[var(--positive)]" : order.status === "failed" ? "text-[var(--negative)]" : ""}>{statusLabels[order.status] || "Неизвестно"}</span>{order.failureReason ? ` · ${order.failureReason}` : ""}</p></div>{order.status === "active" ? <button type="button" disabled={busy} onClick={() => void cancel(order.id)} className="grid h-8 w-8 place-items-center text-[var(--muted)]"><X size={12}/></button> : <Clock3 size={11} className="text-[var(--muted)]"/>}</div>)}</div> : null}
  </section>;
}
