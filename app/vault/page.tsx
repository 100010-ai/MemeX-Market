"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ListPlus, LockKeyhole, WalletCards, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset, Holding, PortfolioPoint, Profile } from "@/lib/types";
import { ago, compact, money, percent, price } from "@/lib/format";
import { CoinAvatar } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { PortfolioChart } from "@/components/portfolio-chart";

const realtimeTables = ["coins", "trades", "virtual_gifts", "gift_trades", "market_events"];
type HistoryItem = { id: string; kind: "coin" | "gift"; label: string; amount: number; pnl: number; createdAt: string; href: string };
type Payload = { holdings: Holding[]; gifts: GiftAsset[]; profile: Profile; analytics: { realizedPnl: number; unrealizedPnl: number; unrealizedCoinPnl: number; unrealizedGiftPnl: number }; history: HistoryItem[]; portfolioSeries: PortfolioPoint[] };
type TabKey = "gifts" | "coins" | "listed" | "history";

export default function VaultPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<TabKey>("gifts");
  const [message, setMessage] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<"fixed" | "floor">("floor");
  const [fixedPrice, setFixedPrice] = useState("");
  const [floorOffset, setFloorOffset] = useState("-3");
  const [bulkBusy, setBulkBusy] = useState(false);
  const load = useCallback(async () => { setData(await apiFetch<Payload>("/api/portfolio")); }, []);
  useEffect(() => { load().catch((e) => setMessage(e instanceof Error ? e.message : "Не удалось загрузить хранилище")); }, [load]);
  const realtimeReload = useCallback(() => { void load(); }, [load]);

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
      setMessage(`Выставлено Gifts: ${selected.size}`);
      setSelected(new Set());
      setSelecting(false);
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Не удалось выставить выбранные Gifts");
    } finally {
      setBulkBusy(false);
    }
  }

  const listed = useMemo(() => data?.gifts.filter((gift) => gift.status === "listed") || [], [data]);
  if (!data) return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-40 rounded-[22px]" /><div className="mxm-skeleton mt-3 h-72 rounded-[22px]" />{message ? <p className="mt-3 text-xs text-[var(--negative)]">{message}</p> : null}</div>;

  const giftPct = data.profile.netWorth > 0 ? data.profile.giftValue / data.profile.netWorth * 100 : 0;
  const coinPct = data.profile.netWorth > 0 ? data.profile.coinValue / data.profile.netWorth * 100 : 0;
  const cashPct = data.profile.netWorth > 0 ? data.profile.balance / data.profile.netWorth * 100 : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <RealtimeRefresh channelName="mxm-vault" tables={realtimeTables} onChange={realtimeReload} />

      <section className="mxm-summary-card mb-4 p-4">
        <div>
          <p className="text-[10px] text-[var(--muted)]">Капитал</p>
          <h1 className="mt-1 text-base font-semibold tracking-[-.02em]">{money(data.profile.netWorth)}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px]"><span className={data.analytics.realizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>Realized {data.analytics.realizedPnl >= 0 ? "+" : ""}{money(data.analytics.realizedPnl)}</span><span className={data.analytics.unrealizedPnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>Unrealized {data.analytics.unrealizedPnl >= 0 ? "+" : ""}{money(data.analytics.unrealizedPnl)}</span></div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-4"><Allocation label="Баланс" value={data.profile.balance} pct={cashPct} /><Allocation label="Подарки" value={data.profile.giftValue} pct={giftPct} /><Allocation label="Мемкоины" value={data.profile.coinValue} pct={coinPct} /></div>
        {data.profile.reservedBalance > 0 ? <div className="mt-3 flex items-center justify-between border-t border-[var(--border-soft)] pt-2 text-[10px]"><span className="flex items-center gap-1.5 text-[var(--muted)]"><LockKeyhole size={12} />В офферах</span><span>{money(data.profile.reservedBalance)} · {money(data.profile.availableBalance)} доступно</span></div> : null}
      </section>

      <section className="mb-4"><PortfolioChart points={data.portfolioSeries || []} /></section>

      {message ? <div className="mb-3 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)]">{message}</div> : null}

      <div className="mxm-segment mb-3 overflow-x-auto">
        <Tab label="Подарки" count={data.gifts.length} active={tab === "gifts"} onClick={() => setTab("gifts")} />
        <Tab label="Мемкоины" count={data.holdings.length} active={tab === "coins"} onClick={() => setTab("coins")} />
        <Tab label="Лоты" count={listed.length} active={tab === "listed"} onClick={() => setTab("listed")} />
        <Tab label="История" active={tab === "history"} onClick={() => setTab("history")} />
      </div>

      {tab === "gifts" || tab === "listed" ? (
        (tab === "listed" ? listed : data.gifts).length ? <div>
          {tab === "gifts" ? <div className="mb-3 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-2.5">
            <div className="flex items-center justify-between gap-2"><div><p className="text-[11px] font-medium">Массовая продажа</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">До 50 Gifts одной атомарной операцией.</p></div><button type="button" onClick={() => { setSelecting((value) => !value); setSelected(new Set()); }} className="inline-flex items-center gap-1.5 rounded-[14px] bg-[var(--panel-2)] px-3 py-2 text-[10px]">{selecting ? <X size={12} /> : <ListPlus size={12} />}{selecting ? "Отмена" : "Выбрать"}</button></div>
            {selecting ? <div className="mt-2 border-t border-[var(--border-soft)] pt-2"><div className="flex flex-wrap items-center gap-2"><select value={bulkMode} onChange={(event) => setBulkMode(event.target.value as "fixed" | "floor")} className="h-9 rounded-[13px] border border-[var(--border-soft)] bg-[var(--surface)] px-2 text-[10px] outline-none"><option value="floor">Относительно floor</option><option value="fixed">Одна цена каждому</option></select>{bulkMode === "floor" ? <label className="flex h-9 items-center gap-1 rounded-[13px] border border-[var(--border-soft)] bg-[var(--surface)] px-2 text-[10px]"><span>Floor</span><input value={floorOffset} onChange={(event) => setFloorOffset(event.target.value)} inputMode="decimal" className="w-12 bg-transparent text-right outline-none" /><span>%</span></label> : <label className="flex h-9 items-center gap-1 rounded-[13px] border border-[var(--border-soft)] bg-[var(--surface)] px-2 text-[10px]"><input value={fixedPrice} onChange={(event) => setFixedPrice(event.target.value)} inputMode="decimal" placeholder="Цена" className="w-20 bg-transparent outline-none" /><span>TON</span></label>}<button type="button" disabled={!selected.size || bulkBusy} onClick={() => void bulkList()} className="ml-auto rounded-[13px] bg-[var(--accent)] px-3 py-2 text-[10px] font-semibold text-black disabled:opacity-40">{bulkBusy ? "Выставляем…" : `Выставить ${selected.size || ""}`}</button></div></div> : null}
          </div> : null}
          <div className="market-grid grid gap-2">{(tab === "listed" ? listed : data.gifts).map((gift) => <div key={gift.virtualGiftId} className="relative">{selecting && tab === "gifts" ? <button type="button" aria-label={selected.has(gift.virtualGiftId) ? "Убрать из выбора" : "Выбрать Gift"} onClick={() => toggleSelected(gift.virtualGiftId)} className={`absolute right-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-full border ${selected.has(gift.virtualGiftId) ? "border-[var(--accent)] bg-[var(--accent)] text-black" : "border-white/20 bg-black/55 text-white"}`}>{selected.has(gift.virtualGiftId) ? <Check size={14} /> : null}</button> : null}<div className={selecting && tab === "gifts" && !selected.has(gift.virtualGiftId) ? "opacity-80" : ""}><GiftCard gift={gift} /></div></div>)}</div>
        </div> : <Empty title={tab === "listed" ? "Лотов нет" : "Подарков нет"} action={tab === "gifts" ? <Link href="/market" className="inline-flex rounded-[13px] bg-[var(--panel-3)] px-4 py-2.5 text-[10px] font-medium">Маркет</Link> : undefined} />
      ) : tab === "coins" ? (
        data.holdings.length ? <div className="overflow-hidden"><div className="divide-y divide-[var(--border-soft)]">{data.holdings.map((holding) => <Link href={`/coin/${holding.coinId}`} key={holding.coinId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_1fr_1fr]"><div className="flex min-w-0 items-center gap-2.5"><CoinAvatar symbol={holding.symbol} imageUrl={holding.imageUrl} /><div className="min-w-0"><p className="truncate text-xs font-medium">{holding.name}</p><p className="text-[10px] text-[var(--muted)]">{compact(holding.quantity)} {holding.symbol}</p></div></div><div className="text-right sm:text-left"><p className="text-xs">{money(holding.marketValue)}</p><p className={`text-[10px] ${holding.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{holding.costBasis ? percent(holding.pnl / holding.costBasis * 100) : "—"}</p></div><div className="hidden sm:block"><p className="text-[10px] text-[var(--muted)]">Текущая цена</p><p className="text-xs">{price(holding.currentPrice)}</p></div></Link>)}</div></div> : <Empty title="Мемкоинов нет" action={<Link href="/market" className="inline-flex rounded-[13px] bg-[var(--panel-3)] px-4 py-2.5 text-[10px] font-medium">Маркет</Link>} />
      ) : (
        data.history.length ? <div className="overflow-hidden"><div className="divide-y divide-[var(--border-soft)]">{data.history.map((item) => <Link href={item.href} key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{item.label}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{ago(item.createdAt)} · {item.kind === "coin" ? "мемкоин" : "подарок"}</p></div><div className="text-right"><p className="text-xs">{money(item.amount)}</p>{item.pnl !== 0 ? <p className={`text-[10px] ${item.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{item.pnl > 0 ? "+" : ""}{money(item.pnl)}</p> : null}</div></Link>)}</div></div> : <Empty title="История пуста" />
      )}
    </div>
  );
}

function Allocation({ label, value, pct }: { label: string; value: number; pct: number }) {
  return <div className="min-w-0"><div className="flex justify-between gap-1 text-[9px]"><span className="truncate text-[var(--muted)]">{label}</span><span>{pct.toFixed(0)}%</span></div><p className="mt-1 truncate text-[11px] font-medium">{money(value)}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div></div>;
}

function Tab({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`mxm-segment-button ${active ? "is-active" : ""}`}><span>{label}</span>{typeof count === "number" ? <span className={`shrink-0 text-[9px] ${active ? "text-white" : "text-[var(--muted-2)]"}`}>{count}</span> : null}</button>;
}

function Empty({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="mxm-card p-8 text-center"><WalletCards size={22} className="mx-auto text-[var(--muted-2)]" /><p className="mt-3 text-xs font-medium">{title}</p>{action ? <div className="mt-4">{action}</div> : null}</div>;
}
