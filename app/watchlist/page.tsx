"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellRing, Gem, Star, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money, percent } from "@/lib/format";
import type { Coin, GiftAsset, GiftCollection } from "@/lib/types";
import { CoinAvatar } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";

type Alert = { id: string; kind: "coin" | "gift" | "gift_collection"; coinId: string | null; giftId: string | null; giftCollection: string | null; direction: "below" | "above"; targetPrice: number; enabled: boolean; lastTriggeredAt: string | null; createdAt: string };
type Payload = { coins: Coin[]; collections: GiftCollection[]; gifts: GiftAsset[]; alerts: Alert[] };

export default function WatchlistPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => apiFetch<Payload>("/api/watchlist").then(setData).catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить избранное")), []);
  useEffect(() => { void load(); }, [load]);
  async function remove(kind: "coin" | "gift" | "gift_collection", id: string) {
    await apiFetch("/api/watchlist", { method: "POST", body: JSON.stringify(kind === "coin" ? { kind, coinId: id, enabled: false } : kind === "gift" ? { kind, giftId: id, enabled: false } : { kind, baseName: id, enabled: false }) });
    await load();
  }
  async function removeAlert(id: string) { await apiFetch("/api/alerts", { method: "POST", body: JSON.stringify({ action: "delete", id }) }); await load(); }
  if (!data) return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-28 rounded-[22px]" /><div className="mxm-skeleton mt-3 h-72 rounded-[22px]" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  const empty = !data.coins.length && !data.collections.length && !data.gifts.length;
  return <div className="mx-auto max-w-5xl">
    <section className="mxm-summary-card p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] text-[var(--muted)]">Watchlist 2.0</p><h1 className="mt-1 text-base font-semibold">Избранное и ценовые сигналы</h1><p className="mt-1 text-[10px] text-[var(--muted)]">Gifts, коллекции и мемкоины в одном месте.</p></div><span className="grid h-10 w-10 place-items-center rounded-[16px] bg-[var(--panel-2)] text-[var(--accent)]"><Star size={18} fill="currentColor" /></span></div></section>

    {empty ? <div className="mxm-card mt-3 p-8 text-center"><Star size={22} className="mx-auto text-[var(--muted-2)]" /><p className="mt-3 text-xs font-medium">Пока ничего не отслеживается</p><Link href="/market" className="mt-3 inline-block text-xs text-[var(--accent)]">Открыть маркет</Link></div> : null}

    {data.collections.length ? <section className="mt-4"><h2 className="mb-2 text-sm font-medium">Коллекции</h2><div className="grid gap-2 md:grid-cols-2">{data.collections.map((c) => <div key={c.baseName} className="mxm-card p-3"><div className="flex items-start justify-between gap-3"><Link href={`/collections/${encodeURIComponent(c.baseName)}`} className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{c.baseName}</p><div className="mt-2 grid grid-cols-3 gap-2 text-[10px]"><Metric label="Floor" value={c.floorPrice == null ? "—" : money(c.floorPrice)} /><Metric label="24ч" value={percent(c.change24h)} tone={c.change24h} /><Metric label="Лоты" value={String(c.listedCount)} /></div></Link><button onClick={() => void remove("gift_collection", c.baseName)} className="p-2 text-[var(--muted)]" aria-label="Удалить"><Trash2 size={14} /></button></div></div>)}</div></section> : null}

    {data.coins.length ? <section className="mt-4"><h2 className="mb-2 text-sm font-medium">Мемкоины</h2><div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{data.coins.map((coin) => <div key={coin.id} className="flex items-center gap-3 p-3"><Link href={`/coin/${coin.id}`} className="flex min-w-0 flex-1 items-center gap-2.5"><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} /><div className="min-w-0"><p className="truncate text-xs font-medium">{coin.name}</p><p className="text-[10px] text-[var(--muted)]">${coin.symbol} · {money(coin.currentPrice)}</p></div><span className={`ml-auto flex items-center gap-1 text-[10px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{coin.change24h >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{percent(coin.change24h)}</span></Link><button onClick={() => void remove("coin", coin.id)} className="p-2 text-[var(--muted)]"><Trash2 size={14} /></button></div>)}</div></div></section> : null}

    {data.gifts.length ? <section className="mt-4"><h2 className="mb-2 text-sm font-medium">Gifts</h2><div className="market-grid grid gap-2.5">{data.gifts.map((gift) => <div key={gift.virtualGiftId} className="relative"><GiftCard gift={gift} showOwner /><button onClick={() => void remove("gift", gift.virtualGiftId)} className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur"><Trash2 size={12} /></button></div>)}</div></section> : null}

    <section className="mt-4"><div className="mb-2 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><BellRing size={15} />Price alerts</h2><span className="text-[10px] text-[var(--muted)]">{data.alerts.filter((a) => a.enabled).length} активных</span></div>{data.alerts.length ? <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{data.alerts.map((alert) => <div key={alert.id} className="flex items-center gap-3 p-3"><span className="grid h-8 w-8 place-items-center rounded-[14px] bg-[var(--panel-2)]"><Gem size={13} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{alert.giftCollection || alert.coinId || alert.giftId}</p><p className="text-[10px] text-[var(--muted)]">{alert.direction === "below" ? "Цена ≤" : "Цена ≥"} {money(alert.targetPrice)}</p></div><button onClick={() => void removeAlert(alert.id)} className="p-2 text-[var(--muted)]"><Trash2 size={14} /></button></div>)}</div></div> : <div className="mxm-card p-5 text-center text-[10px] text-[var(--muted)]">Алерты появятся здесь после их создания на странице актива.</div>}</section>
  </div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div><p className="text-[9px] text-[var(--muted)]">{label}</p><p className={`mt-0.5 truncate text-[11px] ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
