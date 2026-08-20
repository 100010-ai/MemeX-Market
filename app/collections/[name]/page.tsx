"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, Gem, Layers3, RefreshCw, Search, ShoppingBasket, Star, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ago, money, percent } from "@/lib/format";
import type { GiftAsset, GiftCollectionDetail, GiftTraitGroup } from "@/lib/types";
import { CoinChart } from "@/components/coin-chart";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { AdvancedOffersPanel } from "@/components/gifts/advanced-offers-panel";

const realtimeTables = ["virtual_gifts", "gift_trades", "gift_offers", "gift_listing_events", "market_events"];

type TraitTab = "models" | "backdrops" | "symbols";
type GiftSort = "price-asc" | "price-desc" | "rarity" | "number" | "newest" | "offers";

function rarest(gift: GiftAsset) {
  return Math.min(gift.modelRarityPerMille, gift.backdropRarityPerMille, gift.symbolRarityPerMille);
}

export default function GiftCollectionPage() {
  const { name } = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(name);
  const [data, setData] = useState<GiftCollectionDetail | null>(null);
  const [traitTab, setTraitTab] = useState<TraitTab>("models");
  const [busyWatch, setBusyWatch] = useState(false);
  const [busySweep, setBusySweep] = useState<number | null>(null);
  const [sweepMessage, setSweepMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("all");
  const [backdrop, setBackdrop] = useState("all");
  const [symbol, setSymbol] = useState("all");
  const [sort, setSort] = useState<GiftSort>("price-asc");
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setData(null);
    try {
      const next = await apiFetch<GiftCollectionDetail>(`/api/collections/${encodeURIComponent(decodedName)}`);
      setData(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить коллекцию");
    }
  }, [decodedName]);

  useEffect(() => { void load(); }, [load]);
  const reload = useCallback(() => { void load(true); }, [load]);

  const loadMore = useCallback(async () => {
    if (!data || data.nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const payload = await apiFetch<{ gifts: GiftAsset[]; nextOffset: number | null }>(`/api/collections/${encodeURIComponent(decodedName)}/listings?offset=${data.nextOffset}&limit=36`, { cacheMs: 0 });
      setData((current) => {
        if (!current) return current;
        const seen = new Set(current.gifts.map((gift) => gift.virtualGiftId));
        return { ...current, gifts: [...current.gifts, ...payload.gifts.filter((gift) => !seen.has(gift.virtualGiftId))], nextOffset: payload.nextOffset };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить следующие лоты");
    } finally {
      setLoadingMore(false);
    }
  }, [data, decodedName, loadingMore]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !data || data.nextOffset == null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "320px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [data, loadMore]);

  const visibleGifts = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.gifts
      .filter((gift) => !needle || `${gift.baseName} ${gift.number} ${gift.modelName} ${gift.backdropName} ${gift.symbolName}`.toLowerCase().includes(needle))
      .filter((gift) => model === "all" || gift.modelName === model)
      .filter((gift) => backdrop === "all" || gift.backdropName === backdrop)
      .filter((gift) => symbol === "all" || gift.symbolName === symbol)
      .sort((a, b) => {
        if (sort === "price-desc") return (b.listingPrice ?? 0) - (a.listingPrice ?? 0);
        if (sort === "rarity") return rarest(a) - rarest(b) || a.number - b.number;
        if (sort === "number") return a.number - b.number;
        if (sort === "newest") return new Date(b.listedAt || b.createdAt).getTime() - new Date(a.listedAt || a.createdAt).getTime();
        if (sort === "offers") return b.offerCount - a.offerCount || (b.bestOffer ?? 0) - (a.bestOffer ?? 0);
        return (a.listingPrice ?? Number.MAX_SAFE_INTEGER) - (b.listingPrice ?? Number.MAX_SAFE_INTEGER);
      });
  }, [data, query, model, backdrop, symbol, sort]);

  async function sweep(count: 2 | 5 | 10) {
    if (!data || busySweep !== null) return;
    const cheapest = data.gifts.filter((gift) => gift.listingPrice != null).slice().sort((a, b) => Number(a.listingPrice) - Number(b.listingPrice)).slice(0, count);
    const estimate = cheapest.length === count ? cheapest.reduce((sum, gift) => sum + Number(gift.listingPrice || 0), 0) : null;
    const question = estimate == null
      ? `Купить ${count} самых дешёвых Gifts из ${data.collection.baseName}?`
      : `Купить ${count} самых дешёвых Gifts примерно за ${money(estimate)}? Итог проверится сервером перед покупкой.`;
    if (!window.confirm(question)) return;
    setBusySweep(count);
    setSweepMessage(null);
    try {
      const result = await apiFetch<{ sweep?: { total?: number; itemCount?: number } }>(`/api/collections/${encodeURIComponent(decodedName)}/sweep`, {
        method: "POST",
        headers: { "x-idempotency-key": `sweep-${Date.now()}-${count}` },
        body: JSON.stringify({ count }),
      });
      const total = Number(result.sweep?.total || 0);
      setSweepMessage(`Куплено ${Number(result.sweep?.itemCount || count)} Gifts${total > 0 ? ` · ${money(total)}` : ""}`);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить Sweep");
    } finally {
      setBusySweep(null);
    }
  }

  async function toggleWatch() {
    if (!data || busyWatch) return;
    setBusyWatch(true);
    const enabled = !data.watched;
    try {
      await apiFetch("/api/watchlist", { method: "POST", body: JSON.stringify({ kind: "gift_collection", baseName: data.collection.baseName, enabled }) });
      setData((current) => current ? { ...current, watched: enabled } : current);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить избранное");
    } finally {
      setBusyWatch(false);
    }
  }

  if (!data) {
    return <div className="mx-auto max-w-6xl"><div className="mxm-skeleton h-[420px] rounded-2xl" />{error ? <div className="mt-3 flex items-center justify-between gap-3 rounded-[18px] border border-[#5a3035] bg-[#181012] px-3 py-2.5 text-xs text-[#ff9aa4]"><span>{error}</span><button onClick={() => void load()} className="inline-flex shrink-0 items-center gap-1 text-white"><RefreshCw size={12} />Повторить</button></div> : null}</div>;
  }

  const traits = traitTab === "models" ? data.models : traitTab === "backdrops" ? data.backdrops : data.symbols;
  const c = data.collection;

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName={`mxm-collection-${encodeURIComponent(c.baseName)}`} tables={realtimeTables} onChange={reload} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/market" className="inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-white"><ArrowLeft size={15} />Маркет</Link>
        <button onClick={toggleWatch} disabled={busyWatch} aria-label={data.watched ? "Убрать коллекцию из избранного" : "Добавить коллекцию в избранное"} className={`grid h-9 w-9 place-items-center rounded-[20px] border ${data.watched ? "border-[var(--accent)] bg-[rgba(198,170,88,.09)] text-[var(--accent)]" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"}`}><Star size={16} fill={data.watched ? "currentColor" : "none"} /></button>
      </div>

      <section className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
        <div className="px-3 py-4 md:px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">{c.baseName}</h1>
              <p className="mt-1 text-xs text-[var(--muted)]">{c.itemCount} NFT · {c.holderCount} владельцев · {c.listedPct.toFixed(1)}% в продаже</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[var(--muted)]">MXM floor</p>
              <p className="mt-1 flex items-center justify-end gap-1 text-base font-semibold"><Gem size={14} fill="currentColor" />{c.floorPrice == null ? "—" : money(c.floorPrice)}</p>
              <p className={`mt-1 text-[11px] ${c.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(c.change24h)} 24h</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 border-t border-[var(--border-soft)]">
          <Metric icon={<BarChart3 size={12} />} label="Объём 24ч" value={money(c.volume24h)} />
          <Metric icon={<Users size={12} />} label="Владельцы" value={String(c.holderCount)} />
          <Metric icon={<Layers3 size={12} />} label="Лоты" value={String(c.listedCount)} />
          <Metric icon={<Gem size={12} />} label="Последняя продажа" value={c.lastSalePrice == null ? "—" : money(c.lastSalePrice)} />
        </div>
        <div className="grid grid-cols-4 border-t border-[var(--border-soft)]">
          <Metric icon={<BarChart3 size={12} />} label="Объём 7д" value={money(c.volume7d)} />
          <Metric icon={<Gem size={12} />} label="Продажи 7д" value={String(c.tradeCount7d)} />
          <Metric icon={<Gem size={12} />} label="High sale" value={c.highSale == null ? "—" : money(c.highSale)} />
          <Metric icon={<Gem size={12} />} label="Внешний floor" value={c.externalFloor == null ? "—" : money(c.externalFloor)} />
        </div>
      </section>

      <section className="mt-3 rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-1.5 text-xs font-medium"><ShoppingBasket size={14} />Sweep</p><p className="mt-1 text-[10px] text-[var(--muted)]">Купить несколько самых дешёвых активных лотов одной атомарной операцией.</p></div>{sweepMessage ? <span className="text-[10px] text-[var(--positive)]">{sweepMessage}</span> : null}</div>
        <div className="mt-3 grid grid-cols-3 gap-2">{([2,5,10] as const).map((count) => <button key={count} type="button" disabled={busySweep !== null || c.listedCount < count} onClick={() => void sweep(count)} className="rounded-[16px] border border-[var(--border-soft)] bg-[var(--panel-2)] px-3 py-2.5 text-[11px] font-medium disabled:opacity-40">{busySweep === count ? "Покупка…" : `${count} Gifts`}</button>)}</div>
      </section>

      <div className="mt-3"><AdvancedOffersPanel baseName={c.baseName} models={data.models} backdrops={data.backdrops} symbols={data.symbols} /></div>

      {error ? <div className="mt-3 rounded-[20px] border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <section className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-3"><CoinChart candles={data.candles} height={320} baseFrame="1h" /></section>

          <section className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
            <div className="mxm-hscroll gap-1 border-b border-[var(--border-soft)] p-1">
              <TraitTabButton active={traitTab === "models"} onClick={() => setTraitTab("models")}>Модели</TraitTabButton>
              <TraitTabButton active={traitTab === "backdrops"} onClick={() => setTraitTab("backdrops")}>Фоны</TraitTabButton>
              <TraitTabButton active={traitTab === "symbols"} onClick={() => setTraitTab("symbols")}>Символы</TraitTabButton>
            </div>
            <TraitTable rows={traits} />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium">Подарки в продаже</h2><span className="text-[10px] text-[var(--muted)]">{visibleGifts.length} / {data.gifts.length}</span></div>
            <div className="mb-2 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-2">
              <label className="flex h-9 items-center gap-2 border-b border-[var(--border-soft)] px-1"><Search size={14} className="text-[var(--muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, модель, фон, символ" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
              <div className="mxm-hscroll mt-2 gap-2">
                <FilterSelect value={model} onChange={setModel} label="Все модели" values={data.models.map((item) => item.name)} />
                <FilterSelect value={backdrop} onChange={setBackdrop} label="Все фоны" values={data.backdrops.map((item) => item.name)} />
                <FilterSelect value={symbol} onChange={setSymbol} label="Все символы" values={data.symbols.map((item) => item.name)} />
                <select value={sort} onChange={(event) => setSort(event.target.value as GiftSort)} className="h-8 shrink-0 rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface)] px-2 text-[10px] outline-none"><option value="price-asc">Цена ↑</option><option value="price-desc">Цена ↓</option><option value="rarity">Редкость</option><option value="offers">Офферы</option><option value="number">Номер</option><option value="newest">Новые лоты</option></select>
              </div>
            </div>
            {visibleGifts.length ? <div className="market-grid grid gap-2.5">{visibleGifts.map((gift, index) => <GiftCard key={gift.virtualGiftId} gift={gift} priority={index < 4} />)}</div> : <div className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-xs text-[var(--muted)]">По этим фильтрам активных лотов нет.</div>}
            <div ref={loadMoreRef} className="mt-3 h-8 text-center text-[10px] text-[var(--muted)]">{loadingMore ? "Загрузка…" : data.nextOffset != null ? "Ещё ниже" : data.gifts.length ? "Все лоты" : ""}</div>
          </section>
        </div>

        <aside className="space-y-3">
          <section className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
            <div className="border-b border-[var(--border-soft)] px-3 py-3 text-xs font-medium">Последние продажи</div>
            {data.recentSales.length ? <div className="divide-y divide-[var(--border-soft)]">{data.recentSales.slice(0, 12).map((sale) => <div key={sale.id} className="px-3 py-2.5"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-[11px]"><span className="text-[var(--muted)]">{sale.sellerName || "—"}</span> → {sale.buyerName}</p><p className="flex shrink-0 items-center gap-1 text-xs font-medium"><Gem size={10} fill="currentColor" />{money(sale.price)}</p></div><p className="mt-1 text-[9px] text-[var(--muted)]">{ago(sale.createdAt)}</p></div>)}</div> : <div className="p-6 text-center text-xs text-[var(--muted)]">Продаж пока нет.</div>}
          </section>
          <section className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)] lg:sticky lg:top-[72px]">
            <div className="border-b border-[var(--border-soft)] px-3 py-3 text-xs font-medium">Активность коллекции</div>
            {data.activity?.length ? <div className="divide-y divide-[var(--border-soft)]">{data.activity.slice(0, 20).map((event) => <Link href={`/gifts/${event.virtualGiftId}`} key={event.id} className="block px-3 py-2.5"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-[11px]">#{event.giftNumber} · {activityLabel(event.kind)}</p>{event.price != null ? <p className="shrink-0 text-[10px] font-medium">{money(event.price)}</p> : null}</div><p className="mt-1 text-[9px] text-[var(--muted)]">{event.actorName || "Система"} · {ago(event.createdAt)}</p></Link>)}</div> : <div className="p-6 text-center text-xs text-[var(--muted)]">Активности пока нет.</div>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function activityLabel(kind: string) {
  if (kind === "listed") return "выставлен";
  if (kind === "repriced") return "цена изменена";
  if (kind === "unlisted") return "снят с продажи";
  if (kind === "expired") return "листинг истёк";
  if (kind === "sold") return "продан";
  if (kind === "offer_accepted") return "оффер принят";
  return kind;
}

function FilterSelect({ value, onChange, label, values }: { value: string; onChange: (value: string) => void; label: string; values: string[] }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 max-w-[160px] shrink-0 rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface)] px-2 text-[10px] outline-none"><option value="all">{label}</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="min-w-0 border-r border-[var(--border-soft)] px-2 py-2.5 last:border-r-0"><p className="flex items-center gap-1 text-[9px] text-[var(--muted)]">{icon}<span className="truncate">{label}</span></p><p className="mt-1 truncate text-[11px] font-medium">{value}</p></div>;
}

function TraitTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`shrink-0 rounded-2xl px-4 py-2 text-[11px] whitespace-nowrap ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{children}</button>;
}

function TraitTable({ rows }: { rows: GiftTraitGroup[] }) {
  if (!rows.length) return <div className="p-6 text-center text-xs text-[var(--muted)]">Нет данных.</div>;
  return <div className="divide-y divide-[var(--border-soft)]">{rows.slice(0, 40).map((row) => <div key={row.name} className="grid grid-cols-[minmax(0,1fr)_56px_74px] items-center gap-2 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs">{row.name}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{row.count} шт. · {row.listedCount} в продаже{row.rarityPerMille == null ? "" : ` · ${(row.rarityPerMille / 10).toFixed(row.rarityPerMille % 10 ? 1 : 0)}%`}</p></div><span className="text-right text-[10px] text-[var(--muted)]">флор</span><span className="truncate text-right text-xs font-medium">{row.floorPrice == null ? "—" : money(row.floorPrice)}</span></div>)}</div>;
}
