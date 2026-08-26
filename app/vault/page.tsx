"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, ListPlus, LockKeyhole, Search, SortAsc, WalletCards, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset, Holding, PortfolioPoint, Profile } from "@/lib/types";
import { ago, compact, money, percent, price } from "@/lib/format";
import { CoinAvatar } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { PortfolioChart } from "@/components/portfolio-chart";
import { adaptiveListPageSize } from "@/lib/client-performance";

const realtimeTables = ["holdings", "trades", "virtual_gifts"];
const realtimeGiftTradeTables = ["gift_trades"];
type HistoryItem = { id: string; kind: "coin" | "gift"; label: string; amount: number; pnl: number; createdAt: string; href: string };
type Payload = { holdings: Holding[]; gifts: GiftAsset[]; listedGifts?: GiftAsset[]; profile: Profile; analytics: { realizedPnl: number; unrealizedPnl: number; unrealizedCoinPnl: number; unrealizedGiftPnl: number }; history: HistoryItem[]; portfolioSeries: PortfolioPoint[]; inventory?: { giftCount: number; giftsLoaded: number; nextGiftOffset?: number | null } };
type TabKey = "gifts" | "coins" | "listed" | "history";

export default function VaultPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "gifts";
    const saved = window.sessionStorage.getItem("mxm-vault-tab");
    return saved === "coins" || saved === "listed" || saved === "history" ? saved : "gifts";
  });
  const [giftSort, setGiftSort] = useState<"new" | "value" | "name">(() => {
    if (typeof window === "undefined") return "new";
    const saved = window.sessionStorage.getItem("mxm-vault-gift-sort");
    return saved === "value" || saved === "name" ? saved : "new";
  });
  const [coinSort, setCoinSort] = useState<"value" | "pnl" | "name">(() => {
    if (typeof window === "undefined") return "value";
    const saved = window.sessionStorage.getItem("mxm-vault-coin-sort");
    return saved === "pnl" || saved === "name" ? saved : "value";
  });
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [assetQuery, setAssetQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<"fixed" | "floor">("floor");
  const [fixedPrice, setFixedPrice] = useState("");
  const [floorOffset, setFloorOffset] = useState("-3");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [giftRenderStep] = useState(() => adaptiveListPageSize(120, 72));
  const [giftRenderLimit, setGiftRenderLimit] = useState(() => adaptiveListPageSize(120, 72));
  const [moreGiftsBusy, setMoreGiftsBusy] = useState(false);
  const load = useCallback(async () => {
    const next = await apiFetch<Payload>("/api/portfolio");
    setData(next);
    setLoadError(null);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      void load()
        .catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Не удалось загрузить хранилище"))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => { window.sessionStorage.setItem("mxm-vault-tab", tab); }, [tab]);
  useEffect(() => { window.sessionStorage.setItem("mxm-vault-gift-sort", giftSort); }, [giftSort]);
  useEffect(() => { window.sessionStorage.setItem("mxm-vault-coin-sort", coinSort); }, [coinSort]);
  const realtimeReload = useCallback(() => { void load().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Не удалось обновить хранилище")); }, [load]);

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function loadMoreGifts() {
    const offset = data?.inventory?.nextGiftOffset;
    if (offset == null || moreGiftsBusy) return;
    setMoreGiftsBusy(true);
    try {
      const page = await apiFetch<{ gifts: GiftAsset[]; inventory: { giftCount: number; giftsLoaded: number; nextGiftOffset?: number | null } }>(`/api/portfolio?giftsOnly=1&giftOffset=${offset}&giftLimit=96`, { cacheMs: 0 });
      setData((current) => {
        if (!current) return current;
        const seen = new Set(current.gifts.map((gift) => gift.virtualGiftId));
        const appended = page.gifts.filter((gift) => gift.virtualGiftId && !seen.has(gift.virtualGiftId));
        return { ...current, gifts: [...current.gifts, ...appended], inventory: { ...page.inventory, giftsLoaded: current.gifts.length + appended.length } };
      });
      setGiftRenderLimit((value) => Math.max(value, offset + giftRenderStep));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Не удалось загрузить остальные подарки");
    } finally {
      setMoreGiftsBusy(false);
    }
  }

  async function bulkList() {
    if (!selected.size || bulkBusy) return;
    setBulkBusy(true);
    setMessage(null);
    try {
      await apiFetch("/api/portfolio/bulk-list", {
        method: "POST",
        body: JSON.stringify({
          giftIds: [...selected],
          mode: bulkMode,
          fixedPrice: bulkMode === "fixed" ? fixedPrice : null,
          floorOffsetPct: bulkMode === "floor" ? Number(floorOffset) : null,
          durationDays: 7,
        }),
      });
      setMessageTone("success");
      setMessage(`Выставлено подарков: ${selected.size}`);
      setSelected(new Set());
      setSelecting(false);
      await load();
    } catch (cause) {
      setMessageTone("error");
      setMessage(cause instanceof Error ? cause.message : "Не удалось выставить выбранные подарки");
    } finally {
      setBulkBusy(false);
    }
  }

  const listed = useMemo(() => data?.listedGifts ?? data?.gifts.filter((gift) => gift.status === "listed") ?? [], [data]);
  const activeGiftRows = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    const rows = [...(tab === "listed" ? listed : data?.gifts || [])].filter((gift) => !q || `${gift.baseName} ${gift.modelName} ${gift.backdropName} ${gift.symbolName} ${gift.number}`.toLowerCase().includes(q));
    if (giftSort === "value") return rows.sort((a, b) => Number(b.estimatedValue || b.listingPrice || 0) - Number(a.estimatedValue || a.listingPrice || 0));
    if (giftSort === "name") return rows.sort((a, b) => `${a.baseName || a.telegramName}`.localeCompare(`${b.baseName || b.telegramName}`, "ru"));
    return rows;
  }, [assetQuery, data?.gifts, giftSort, listed, tab]);
  const sortedHoldings = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    const rows = [...(data?.holdings || [])].filter((holding) => !q || `${holding.name} ${holding.symbol}`.toLowerCase().includes(q));
    if (coinSort === "pnl") return rows.sort((a, b) => b.pnl - a.pnl);
    if (coinSort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return rows.sort((a, b) => b.marketValue - a.marketValue);
  }, [assetQuery, coinSort, data?.holdings]);
  const visibleGiftRows = activeGiftRows.slice(0, giftRenderLimit);
  const realtimeFilters = useMemo(() => data?.profile.id ? ({ holdings: `profile_id=eq.${data.profile.id}`, trades: `profile_id=eq.${data.profile.id}`, virtual_gifts: `owner_profile_id=eq.${data.profile.id}` }) : undefined, [data?.profile.id]);
  if (!data) {
    if (loadError && !loading) return <div className="mx-auto max-w-5xl"><div className="mxm-card p-6 text-center"><p className="text-xs text-[var(--negative)]">{loadError}</p><button type="button" onClick={() => { setLoading(true); setLoadError(null); void load().catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Не удалось загрузить хранилище")).finally(() => setLoading(false)); }} className="mt-4 rounded-[13px] bg-[var(--panel-3)] px-4 py-2.5 text-[10px] font-medium">Повторить</button></div></div>;
    return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-40 rounded-[22px]" /><div className="mxm-skeleton mt-3 h-72 rounded-[22px]" /></div>;
  }

  const giftPct = data.profile.netWorth > 0 ? data.profile.giftValue / data.profile.netWorth * 100 : 0;
  const coinPct = data.profile.netWorth > 0 ? data.profile.coinValue / data.profile.netWorth * 100 : 0;
  const cashPct = data.profile.netWorth > 0 ? data.profile.balance / data.profile.netWorth * 100 : 0;

  return (
    <div className="mxm-vault-page mx-auto max-w-5xl mxm-page-enter">
      <RealtimeRefresh channelName="mxm-vault" tables={realtimeTables} filters={realtimeFilters} onChange={realtimeReload} debounceMs={1000} />
      {data.profile.id ? <RealtimeRefresh channelName="mxm-vault-gift-buys" tables={realtimeGiftTradeTables} filters={{ gift_trades: `buyer_profile_id=eq.${data.profile.id}` }} onChange={realtimeReload} debounceMs={700} /> : null}
      {data.profile.id ? <RealtimeRefresh channelName="mxm-vault-gift-sales" tables={realtimeGiftTradeTables} filters={{ gift_trades: `seller_profile_id=eq.${data.profile.id}` }} onChange={realtimeReload} debounceMs={700} /> : null}

      <header className="mxm-compact-page-head">
        <div><p className="mxm-eyebrow">Portfolio</p><h1 className="mxm-page-title mt-1">Хранилище активов</h1><p className="mt-1 text-[9px] text-[var(--muted)]">Позиции, коллекция и операции в одном рабочем пространстве.</p></div>
        <Link href="/market" className="mxm-compact-link mxm-portfolio-quick">Найти актив<ArrowUpRight size={12} /></Link>
      </header>

      <section className="mxm-vault-command mb-3">
        <div className="mxm-vault-command-main">
          <div className="min-w-0">
            <p className="mxm-eyebrow">Общий капитал</p>
            <h2>{money(data.profile.netWorth)}</h2>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px]"><span className={data.analytics.realizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>Зафиксировано {data.analytics.realizedPnl >= 0 ? "+" : ""}{money(data.analytics.realizedPnl)}</span><span className={data.analytics.unrealizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>Открытый результат {data.analytics.unrealizedPnl >= 0 ? "+" : ""}{money(data.analytics.unrealizedPnl)}</span></div>
          </div>
          <div className="mxm-vault-balance"><small>Доступно</small><strong>{money(data.profile.availableBalance)}</strong>{data.profile.reservedBalance > 0 ? <span><LockKeyhole size={9} />{money(data.profile.reservedBalance)} в резерве</span> : <span>Свободный баланс</span>}</div>
        </div>
        <div className="mxm-vault-allocation"><Allocation label="Баланс" value={data.profile.balance} pct={cashPct} /><Allocation label="Подарки" value={data.profile.giftValue} pct={giftPct} /><Allocation label="Мемкоины" value={data.profile.coinValue} pct={coinPct} /></div>
        <div className="mxm-vault-actions"><Link href="/market">Рынок</Link><Link href="/orders">Заявки</Link><Link href="/create">Запустить мемкоин</Link></div>
      </section>

      <section className="mb-4"><PortfolioChart points={data.portfolioSeries || []} /></section>

      {loadError ? <div className="mb-3 mxm-alert mxm-alert-error">{loadError}</div> : null}
      {message ? <div className={`mxm-inline-notice mb-3 ${messageTone === "error" ? "is-error" : "is-success"}`} role={messageTone === "error" ? "alert" : "status"}>{message}</div> : null}

      <div className="mxm-segment mb-3 overflow-x-auto" role="tablist" aria-label="Активы портфеля">
        <Tab label="Подарки" count={data.inventory?.giftCount ?? data.gifts.length} active={tab === "gifts"} onClick={() => { setTab("gifts"); setGiftRenderLimit(giftRenderStep); }} />
        <Tab label="Мемкоины" count={data.holdings.length} active={tab === "coins"} onClick={() => setTab("coins")} />
        <Tab label="Лоты" count={listed.length} active={tab === "listed"} onClick={() => { setTab("listed"); setGiftRenderLimit(giftRenderStep); }} />
        <Tab label="История" active={tab === "history"} onClick={() => setTab("history")} />
      </div>

      {tab !== "history" ? <div className="mb-2 flex items-center gap-2"><label className="mxm-vault-search min-w-0 flex-1"><Search size={12} /><input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} aria-label={tab === "coins" ? "Поиск по мемкоинам" : "Поиск по подаркам"} placeholder={tab === "coins" ? "Найти мемкоин" : "Найти подарок"} /></label>{assetQuery ? <button type="button" onClick={() => setAssetQuery("")} className="mxm-vault-search-clear" aria-label="Очистить поиск"><X size={12} /></button> : null}</div> : null}
      {tab === "gifts" || tab === "listed" ? <div className="mb-2 flex items-center justify-end gap-2 text-[9px] text-[var(--muted)]"><SortAsc size={11}/><select value={giftSort} onChange={(event)=>setGiftSort(event.target.value as typeof giftSort)} className="mxm-compact-select"><option value="new">Сначала новые</option><option value="value">По стоимости</option><option value="name">По названию</option></select></div> : null}
      {tab === "coins" ? <div className="mb-2 flex items-center justify-end gap-2 text-[9px] text-[var(--muted)]"><SortAsc size={11}/><select value={coinSort} onChange={(event)=>setCoinSort(event.target.value as typeof coinSort)} className="mxm-compact-select"><option value="value">По стоимости</option><option value="pnl">По результату</option><option value="name">По названию</option></select></div> : null}

      {tab === "gifts" || tab === "listed" ? (
        activeGiftRows.length ? <div>
          {tab === "gifts" ? <div className="mxm-bulk-listing">
            <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium">Массовая продажа</p><button type="button" onClick={() => { setSelecting((value) => !value); setSelected(new Set()); }} className="inline-flex items-center gap-1.5 px-1 py-2 text-[10px] text-[var(--muted)]">{selecting ? <X size={12} /> : <ListPlus size={12} />}{selecting ? "Отмена" : "Выбрать"}</button></div>
            {selecting ? <div className="mt-2 border-t border-[var(--border-soft)] pt-2"><div className="flex flex-wrap items-center gap-2"><select value={bulkMode} onChange={(event) => setBulkMode(event.target.value as "fixed" | "floor")} className="mxm-bulk-listing-control h-9 px-1 text-[10px] outline-none"><option value="floor">Относительно мин. цены</option><option value="fixed">Одна цена каждому</option></select>{bulkMode === "floor" ? <label className="mxm-bulk-listing-control flex h-9 items-center gap-1 px-1 text-[10px]"><span>Мин. цена</span><input value={floorOffset} onChange={(event) => setFloorOffset(event.target.value)} inputMode="decimal" className="w-12 bg-transparent text-right outline-none" /><span>%</span></label> : <label className="mxm-bulk-listing-control flex h-9 items-center gap-1 px-1 text-[10px]"><input value={fixedPrice} onChange={(event) => setFixedPrice(event.target.value)} inputMode="decimal" placeholder="Цена" className="w-20 bg-transparent outline-none" /><span>TON</span></label>}<button type="button" disabled={!selected.size || bulkBusy} onClick={() => void bulkList()} className="mxm-primary-action ml-auto !min-h-9 !px-3">{bulkBusy ? "Выставляем…" : `Выставить ${selected.size || ""}`}</button></div></div> : null}
          </div> : null}
          <div className="market-grid grid gap-2">{visibleGiftRows.map((gift) => <div key={gift.virtualGiftId} className="relative">{selecting && tab === "gifts" ? <button type="button" aria-label={selected.has(gift.virtualGiftId) ? "Убрать из выбора" : "Выбрать подарок"} onClick={() => toggleSelected(gift.virtualGiftId)} className={`absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-full border ${selected.has(gift.virtualGiftId) ? "border-[var(--accent)] bg-[var(--accent)] text-black" : "border-white/20 bg-black/55 text-white"}`}>{selected.has(gift.virtualGiftId) ? <Check size={14} /> : null}</button> : null}<div className={selecting && tab === "gifts" && !selected.has(gift.virtualGiftId) ? "opacity-80" : ""}><GiftCard gift={gift} /></div></div>)}</div>
          {visibleGiftRows.length < activeGiftRows.length ? <div className="mt-4 text-center"><button type="button" onClick={() => setGiftRenderLimit((value) => Math.min(activeGiftRows.length, value + giftRenderStep))} className="border-b border-[var(--border)] pb-1 text-[10px] text-[var(--muted)]">Показать ещё {Math.min(giftRenderStep, activeGiftRows.length - visibleGiftRows.length)}</button></div> : null}
          {tab === "gifts" && visibleGiftRows.length >= activeGiftRows.length && data.inventory?.nextGiftOffset != null ? <div className="mt-4 text-center"><button type="button" disabled={moreGiftsBusy} onClick={() => void loadMoreGifts()} className="border-b border-[var(--border)] pb-1 text-[10px] text-[var(--muted)] disabled:opacity-50">{moreGiftsBusy ? "Загружаем…" : `Загрузить ещё ${Math.min(96, Math.max(0, (data.inventory?.giftCount || 0) - data.gifts.length))}`}</button></div> : null}
        </div> : <Empty title={assetQuery ? "Ничего не найдено" : tab === "listed" ? "Лотов нет" : "Подарков нет"} detail={assetQuery ? `По запросу «${assetQuery.trim()}» нет совпадений.` : tab === "listed" ? "Выставленные подарки появятся здесь." : "Добавьте первый подарок с рынка."} action={assetQuery ? <button type="button" onClick={() => setAssetQuery("")} className="mxm-secondary-action">Сбросить поиск</button> : tab === "gifts" ? <Link href="/market" className="mxm-secondary-action">Открыть рынок</Link> : undefined} />
      ) : tab === "coins" ? (
        sortedHoldings.length ? <div className="overflow-hidden"><div className="divide-y divide-[var(--border-soft)]">{sortedHoldings.map((holding) => <div key={holding.coinId} className="mxm-vault-coin-row"><Link href={`/coin/${holding.coinId}`} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_1fr_1fr]"><div className="flex min-w-0 items-center gap-2.5"><CoinAvatar symbol={holding.symbol} imageUrl={holding.imageUrl} /><div className="min-w-0"><p className="truncate text-xs font-medium">{holding.name}</p><p className="text-[10px] text-[var(--muted)]">{compact(holding.quantity)} {holding.symbol}</p></div></div><div className="text-right sm:text-left"><p className="text-xs">{money(holding.marketValue)}</p><p className={`text-[10px] ${holding.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{holding.costBasis ? percent(holding.pnl / holding.costBasis * 100) : "—"}</p></div><div className="hidden sm:block"><p className="text-[10px] text-[var(--muted)]">Текущая цена</p><p className="text-xs">{price(holding.currentPrice)}</p></div></Link><Link href={`/coin/${holding.coinId}?side=sell`} className="mxm-vault-quick-sell">Продать</Link></div>)}</div></div> : <Empty title={assetQuery ? "Мемкоин не найден" : "Мемкоинов нет"} detail={assetQuery ? `Нет позиций по запросу «${assetQuery.trim()}».` : "Первая купленная позиция появится здесь автоматически."} action={assetQuery ? <button type="button" onClick={() => setAssetQuery("")} className="mxm-secondary-action">Сбросить поиск</button> : <Link href="/market?tab=coins" className="mxm-secondary-action">Открыть рынок</Link>} />
      ) : (
        data.history.length ? <div className="overflow-hidden"><div className="divide-y divide-[var(--border-soft)]">{data.history.map((item) => <Link href={item.href} key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{item.label}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{ago(item.createdAt)} · {item.kind === "coin" ? "мемкоин" : "подарок"}</p></div><div className="text-right"><p className="text-xs">{money(item.amount)}</p>{item.pnl !== 0 ? <p className={`text-[10px] ${item.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{item.pnl > 0 ? "+" : ""}{money(item.pnl)}</p> : null}</div></Link>)}</div></div> : <Empty title="История пуста" detail="Покупки, продажи и изменения позиций появятся после первой операции." />
      )}
    </div>
  );
}

function Allocation({ label, value, pct }: { label: string; value: number; pct: number }) {
  return <div className="min-w-0"><div className="flex justify-between gap-1 text-[9px]"><span className="truncate text-[var(--muted)]">{label}</span><span>{pct.toFixed(0)}%</span></div><p className="mt-1 truncate text-[11px] font-medium">{money(value)}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div></div>;
}

function Tab({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`mxm-segment-button ${active ? "is-active" : ""}`}><span>{label}</span>{typeof count === "number" ? <span className={`shrink-0 text-[9px] ${active ? "text-white" : "text-[var(--muted-2)]"}`}>{count}</span> : null}</button>;
}

function Empty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="mxm-empty-state rounded-[16px] border border-[var(--border-soft)]"><span className="mxm-empty-icon"><WalletCards size={17} /></span><p className="font-medium text-white">{title}</p><small className="mt-1 max-w-sm text-[8px] leading-4 text-[var(--muted-2)]">{detail}</small>{action ? <div className="mt-3">{action}</div> : null}</div>;
}
