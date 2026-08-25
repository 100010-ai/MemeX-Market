"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Gem, RefreshCw, ShieldCheck, ShoppingCart, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";
import { useTelegramProfile } from "@/components/telegram-provider";

type CartPayload = { items: GiftAsset[]; total: number; count: number };
type CheckoutReceipt = { count: number; total: number };

function makeCheckoutRequestKey() {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return `cart:${randomUuid()}`;
  return `cart:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 14)}`;
}

export default function CartPage() {
  const [data, setData] = useState<CartPayload>({ items: [], total: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const checkoutRequestKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await apiFetch<CartPayload>("/api/cart")); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить корзину"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!clearArmed) return;
    const timer = window.setTimeout(() => setClearArmed(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [clearArmed]);

  async function remove(id: string) {
    if (busy) return;
    checkoutRequestKey.current = null;
    setReceipt(null);
    setClearArmed(false);
    setBusy(id); haptic("light");
    try {
      await apiFetch("/api/cart", { method: "POST", body: JSON.stringify({ action: "remove", virtualGiftId: id }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось убрать подарок"); }
    finally { setBusy(null); }
  }

  async function clear() {
    if (busy) return;
    if (!clearArmed) { setClearArmed(true); return; }
    checkoutRequestKey.current = null;
    setBusy("clear");
    try { await apiFetch("/api/cart", { method: "POST", body: JSON.stringify({ action: "clear" }) }); setClearArmed(false); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось очистить корзину"); }
    finally { setBusy(null); }
  }

  async function checkout() {
    if (busy || !data.items.length) return;
    const checkoutSnapshot = { count: data.count, total: data.total };
    setBusy("checkout"); setError(null); haptic("medium");
    try {
      checkoutRequestKey.current ||= makeCheckoutRequestKey();
      await apiFetch("/api/cart/checkout", { method: "POST", body: "{}", headers: { "x-idempotency-key": checkoutRequestKey.current } });
      checkoutRequestKey.current = null;
      setReceipt(checkoutSnapshot);
      await Promise.allSettled([load(), refreshProfile()]);
      haptic("heavy");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось купить корзину"); }
    finally { setBusy(null); }
  }

  const availableBalance = profile?.availableBalance ?? null;
  const balanceAfter = availableBalance == null ? null : availableBalance - data.total;

  return <div className="mxm-cart-page mx-auto max-w-5xl">
    <div className="mxm-cart-head mb-3 flex items-center gap-3">
      <Link href="/market" aria-label="Вернуться на рынок" className="grid h-10 w-10 place-items-center rounded-[16px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"><ArrowLeft size={16} /></Link>
      <div className="min-w-0 flex-1"><p className="text-[9px] uppercase tracking-[.13em] text-[var(--muted-2)]">Gift checkout</p><h1 className="mt-0.5 text-base font-semibold tracking-[-.025em]">Корзина</h1><p className="mt-0.5 text-[10px] text-[var(--muted)]">{data.count ? `${data.count} лотов готовы к проверке` : receipt ? "Покупка завершена" : "Выбранных лотов пока нет"}</p></div>
      {data.count ? <button disabled={Boolean(busy)} onClick={clear} className={`mxm-cart-clear flex h-10 items-center gap-1.5 rounded-[16px] border px-3 text-[10px] ${clearArmed ? "is-armed" : ""}`}><Trash2 size={12} />{busy === "clear" ? "Очищаем…" : clearArmed ? "Подтвердить" : "Очистить"}</button> : null}
    </div>

    {error ? <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-[16px] border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]"><span>{error}</span><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-white"><RefreshCw size={12} className={loading ? "animate-spin" : ""} />Обновить</button></div> : null}

    {loading ? <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="space-y-2">{[0,1,2].map(i => <div key={i} className="mxm-skeleton h-24 rounded-[18px]" />)}</div><div className="mxm-skeleton h-60 rounded-[20px]" /></div> : data.items.length ? <div className="mxm-cart-layout grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 space-y-2" aria-label="Подарки в корзине">
        {data.items.map((gift, index) => <article key={gift.virtualGiftId} className="mxm-cart-item grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-2.5">
          <Link href={`/gifts/${gift.virtualGiftId}`} className="relative"><GiftMedia gift={gift} compact className="h-[72px] w-[72px] rounded-[15px]" /><span className="mxm-cart-item-index">{index + 1}</span></Link>
          <Link href={`/gifts/${gift.virtualGiftId}`} className="min-w-0"><p className="truncate text-xs font-semibold">{gift.baseName} <span className="font-normal text-[var(--muted)]">#{gift.number}</span></p><p className="mt-1 truncate text-[10px] text-[var(--muted)]">{gift.modelName} · {gift.backdropName}</p><div className="mt-2 flex flex-wrap items-center gap-2"><p className="flex items-center gap-1 text-sm font-semibold"><Gem size={12} className="text-[var(--accent)]" fill="currentColor" />{gift.listingPrice == null ? "—" : money(gift.listingPrice)}</p>{gift.chainVerified ? <span className="inline-flex items-center gap-1 text-[9px] text-[var(--positive)]"><ShieldCheck size={11} />TON подтверждён</span> : <span className="text-[9px] text-[var(--muted-2)]">Лот MXM</span>}</div></Link>
          <button type="button" aria-label={`Убрать ${gift.baseName} #${gift.number} из корзины`} disabled={Boolean(busy)} onClick={() => remove(gift.virtualGiftId)} className="grid h-10 w-10 place-items-center rounded-[15px] bg-[var(--panel-2)] text-[var(--muted)] transition hover:text-white"><Trash2 size={14} /></button>
        </article>)}
      </section>
      <aside className="mxm-cart-summary mxm-floating-glass rounded-[20px] border border-[var(--border)] bg-[rgba(14,15,17,.96)] p-4 lg:sticky lg:top-[76px] lg:self-start">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] text-[var(--muted)]">Заказ</p><p className="mt-1 text-sm font-semibold">{data.count} подарков</p></div><ShoppingCart size={17} className="text-[var(--accent)]" /></div>
        <div className="mt-4 space-y-2 border-y border-[var(--border-soft)] py-3 text-[10px]"><div className="flex justify-between gap-3 text-[var(--muted)]"><span>Стоимость лотов</span><span className="text-white">{money(data.total)}</span></div><div className="flex justify-between gap-3 text-[var(--muted)]"><span>Доступно</span><span className="text-white">{availableBalance == null ? "—" : money(availableBalance)}</span></div><div className="flex justify-between gap-3 text-[var(--muted)]"><span>После покупки</span><span className={balanceAfter != null && balanceAfter < 0 ? "text-[var(--negative)]" : "text-[var(--positive)]"}>{balanceAfter == null ? "—" : money(balanceAfter)}</span></div></div>
        <div className="mt-3 flex gap-2 rounded-[15px] bg-[var(--panel-2)] px-3 py-2.5 text-[9px] leading-4 text-[var(--muted)]"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-[var(--positive)]" /><span>Перед списанием сервер заново проверит цену, владельца и доступность каждого лота. Покупка проходит атомарно.</span></div>
        <button disabled={Boolean(busy) || !profile || profile.availableBalance < data.total} onClick={checkout} className="mt-3 h-12 w-full rounded-[17px] bg-[var(--accent)] text-xs font-bold text-[#111] disabled:opacity-40">{busy === "checkout" ? "Проверяем и покупаем…" : profile && profile.availableBalance < data.total ? "Недостаточно TON" : `Купить всё · ${money(data.total)}`}</button>
        <p className="mt-2 text-center text-[8px] text-[var(--muted-2)]">Одно подтверждение · один итог операции</p>
      </aside>
    </div> : receipt ? <div aria-live="polite" className="mxm-cart-success rounded-[22px] border border-[var(--border)] bg-[var(--panel)] px-4 py-10 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[rgba(76,189,126,.1)] text-[var(--positive)]"><CheckCircle2 size={25} /></div><p className="mt-4 text-base font-semibold">Покупка завершена</p><p className="mt-1 text-[11px] text-[var(--muted)]">{receipt.count} подарков куплены за {money(receipt.total)} и уже находятся в портфеле.</p><div className="mx-auto mt-5 grid max-w-sm grid-cols-2 gap-2"><Link href="/vault" className="flex min-h-11 items-center justify-center rounded-[16px] bg-[var(--accent)] px-3 text-xs font-semibold text-black">Открыть портфель</Link><Link href="/market" className="flex min-h-11 items-center justify-center rounded-[16px] bg-[var(--panel-2)] px-3 text-xs font-medium">Продолжить покупки</Link></div></div> : <div className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] px-4 py-10 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-[18px] bg-[var(--panel-2)] text-[var(--muted)]"><ShoppingCart size={18} /></div><p className="mt-3 text-xs font-medium">Корзина пуста</p><p className="mt-1 text-[11px] text-[var(--muted)]">Собери активные лоты в каталоге и оформи их одной операцией.</p><Link href="/market" className="mt-4 inline-flex min-h-10 items-center rounded-[16px] bg-[var(--panel-3)] px-4 text-xs font-medium">Открыть маркет</Link></div>}
  </div>;
}
