"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Gem, ShoppingCart, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";
import { useTelegramProfile } from "@/components/telegram-provider";

type CartPayload = { items: GiftAsset[]; total: number; count: number };

export default function CartPage() {
  const [data, setData] = useState<CartPayload>({ items: [], total: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { profile, refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async () => {
    try { setData(await apiFetch<CartPayload>("/api/cart")); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить корзину"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove(id: string) {
    if (busy) return;
    setBusy(id); haptic("light");
    try {
      await apiFetch("/api/cart", { method: "POST", body: JSON.stringify({ action: "remove", virtualGiftId: id }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось убрать подарок"); }
    finally { setBusy(null); }
  }

  async function clear() {
    if (busy) return;
    setBusy("clear");
    try { await apiFetch("/api/cart", { method: "POST", body: JSON.stringify({ action: "clear" }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось очистить корзину"); }
    finally { setBusy(null); }
  }

  async function checkout() {
    if (busy || !data.items.length) return;
    setBusy("checkout"); setError(null); haptic("medium");
    try {
      await apiFetch("/api/cart/checkout", { method: "POST", body: "{}" });
      await Promise.all([load(), refreshProfile()]);
      haptic("heavy");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось купить корзину"); }
    finally { setBusy(null); }
  }

  return <div className="mx-auto max-w-2xl">
    <div className="mb-3 flex items-center gap-2">
      <Link href="/market" className="grid h-9 w-9 place-items-center rounded-[16px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"><ArrowLeft size={16} /></Link>
      <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">Корзина</h1><p className="text-[10px] text-[var(--muted)]">Покупка лотов одним атомарным действием</p></div>
      {data.count ? <button disabled={Boolean(busy)} onClick={clear} className="flex h-9 items-center gap-1.5 rounded-[16px] bg-[var(--panel)] px-3 text-[10px] text-[var(--muted)]"><Trash2 size={12} />Очистить</button> : null}
    </div>

    {error ? <div className="mb-3 rounded-[16px] border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

    {loading ? <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="mxm-skeleton h-20 rounded-[18px]" />)}</div> : data.items.length ? <div className="space-y-1.5">
      {data.items.map((gift) => <div key={gift.virtualGiftId} className="grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-2">
        <Link href={`/gifts/${gift.virtualGiftId}`}><GiftMedia gift={gift} compact className="h-[58px] w-[58px] rounded-[14px]" /></Link>
        <Link href={`/gifts/${gift.virtualGiftId}`} className="min-w-0"><p className="truncate text-xs font-medium">{gift.baseName}</p><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">#{gift.number} · {gift.modelName}</p><p className="mt-1 flex items-center gap-1 text-xs font-semibold"><Gem size={11} fill="currentColor" />{gift.listingPrice == null ? "—" : money(gift.listingPrice)}</p></Link>
        <button disabled={Boolean(busy)} onClick={() => remove(gift.virtualGiftId)} className="grid h-9 w-9 place-items-center rounded-[15px] bg-[var(--panel-2)] text-[var(--muted)]"><Trash2 size={14} /></button>
      </div>)}
    </div> : <div className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] px-4 py-10 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-[18px] bg-[var(--panel-2)] text-[var(--muted)]"><ShoppingCart size={18} /></div><p className="mt-3 text-xs font-medium">Корзина пуста</p><p className="mt-1 text-[11px] text-[var(--muted)]">Добавляй активные лоты прямо из каталога.</p><Link href="/market" className="mt-4 inline-flex rounded-[16px] bg-[var(--panel-3)] px-4 py-2.5 text-xs font-medium">Открыть маркет</Link></div>}

    {data.items.length ? <div className="sticky bottom-[calc(66px+env(safe-area-inset-bottom))] mt-3 rounded-[20px] border border-[var(--border)] bg-[rgba(14,15,17,.96)] p-3 shadow-[0_-12px_30px_rgba(0,0,0,.32)] backdrop-blur-xl lg:bottom-3">
      <div className="mb-2.5 flex items-center justify-between"><div><p className="text-[10px] text-[var(--muted)]">{data.count} подарков</p><p className="mt-0.5 flex items-center gap-1 text-sm font-semibold"><Gem size={13} fill="currentColor" />{money(data.total)}</p></div><p className="text-right text-[10px] text-[var(--muted)]">Доступно<br/><span className="text-white">{profile ? money(profile.availableBalance) : "—"}</span></p></div>
      <button disabled={Boolean(busy) || !profile || profile.availableBalance < data.total} onClick={checkout} className="h-11 w-full rounded-[17px] bg-[var(--accent)] text-xs font-bold text-[#111] disabled:opacity-40">{busy === "checkout" ? "Покупаем…" : profile && profile.availableBalance < data.total ? "Недостаточно TON" : `Купить всё · ${money(data.total)}`}</button>
    </div> : null}
  </div>;
}
