"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LockKeyhole, WalletCards } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset, Holding, Profile } from "@/lib/types";
import { ago, compact, money, percent, price } from "@/lib/format";
import { CoinAvatar } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";

const realtimeTables = ["coins", "trades", "virtual_gifts", "gift_trades", "market_events"];
type HistoryItem = { id: string; kind: "coin" | "gift"; label: string; amount: number; pnl: number; createdAt: string; href: string };
type Payload = { holdings: Holding[]; gifts: GiftAsset[]; profile: Profile; history: HistoryItem[] };
type TabKey = "gifts" | "coins" | "listed" | "history";

export default function VaultPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<TabKey>("gifts");
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => { setData(await apiFetch<Payload>("/api/portfolio")); }, []);
  useEffect(() => { load().catch((e) => setMessage(e instanceof Error ? e.message : "Не удалось загрузить портфель")); }, [load]);
  const realtimeReload = useCallback(() => { void load(); }, [load]);

  const listed = useMemo(() => data?.gifts.filter((gift) => gift.status === "listed") || [], [data]);
  if (!data) return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-40 rounded-[22px]" /><div className="mxm-skeleton mt-3 h-72 rounded-[22px]" />{message ? <p className="mt-3 text-xs text-[var(--negative)]">{message}</p> : null}</div>;

  const giftPct = data.profile.netWorth > 0 ? data.profile.giftValue / data.profile.netWorth * 100 : 0;
  const coinPct = data.profile.netWorth > 0 ? data.profile.coinValue / data.profile.netWorth * 100 : 0;
  const cashPct = data.profile.netWorth > 0 ? data.profile.balance / data.profile.netWorth * 100 : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <RealtimeRefresh channelName="mxm-vault" tables={realtimeTables} onChange={realtimeReload} />

      <section className="mb-3 rounded-[22px] border border-[var(--border)] bg-[var(--panel)] p-3">
        <div>
          <p className="text-[10px] text-[var(--muted)]">Капитал</p>
          <h1 className="mt-1 text-base font-semibold tracking-[-.02em]">{money(data.profile.netWorth)}</h1>
          <p className={`mt-1 text-[11px] ${data.profile.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{data.profile.pnl >= 0 ? "+" : ""}{money(data.profile.pnl)} с начала игры</p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5"><Allocation label="Баланс" value={data.profile.balance} pct={cashPct} /><Allocation label="Подарки" value={data.profile.giftValue} pct={giftPct} /><Allocation label="Мемкоины" value={data.profile.coinValue} pct={coinPct} /></div>
        {data.profile.reservedBalance > 0 ? <div className="mt-2 flex items-center justify-between rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[10px]"><span className="flex items-center gap-1.5 text-[var(--muted)]"><LockKeyhole size={12} />В офферах</span><span>{money(data.profile.reservedBalance)} · {money(data.profile.availableBalance)} доступно</span></div> : null}
      </section>

      {message ? <div className="mb-3 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)]">{message}</div> : null}

      <div className="mb-3 grid grid-cols-4 gap-1 rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-1">
        <Tab label="Подарки" count={data.gifts.length} active={tab === "gifts"} onClick={() => setTab("gifts")} />
        <Tab label="Коины" count={data.holdings.length} active={tab === "coins"} onClick={() => setTab("coins")} />
        <Tab label="Лоты" count={listed.length} active={tab === "listed"} onClick={() => setTab("listed")} />
        <Tab label="История" active={tab === "history"} onClick={() => setTab("history")} />
      </div>

      {tab === "gifts" || tab === "listed" ? (
        (tab === "listed" ? listed : data.gifts).length ? <div className="market-grid grid gap-2">{(tab === "listed" ? listed : data.gifts).map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} />)}</div> : <Empty title={tab === "listed" ? "Нет активных лотов" : "В портфеле пока нет подарков"} action={tab === "gifts" ? <Link href="/market" className="inline-flex rounded-[17px] bg-[var(--panel-3)] px-4 py-2 text-xs font-medium">Открыть маркет</Link> : undefined} />
      ) : tab === "coins" ? (
        data.holdings.length ? <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{data.holdings.map((holding) => <Link href={`/coin/${holding.coinId}`} key={holding.coinId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 hover:bg-[var(--panel-2)] sm:grid-cols-[minmax(0,1fr)_1fr_1fr]"><div className="flex min-w-0 items-center gap-2.5"><CoinAvatar symbol={holding.symbol} /><div className="min-w-0"><p className="truncate text-xs font-medium">{holding.name}</p><p className="text-[10px] text-[var(--muted)]">{compact(holding.quantity)} {holding.symbol}</p></div></div><div className="text-right sm:text-left"><p className="text-xs">{money(holding.marketValue)}</p><p className={`text-[10px] ${holding.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{holding.costBasis ? percent(holding.pnl / holding.costBasis * 100) : "—"}</p></div><div className="hidden sm:block"><p className="text-[10px] text-[var(--muted)]">Текущая цена</p><p className="text-xs">{price(holding.currentPrice)}</p></div></Link>)}</div></div> : <Empty title="Нет позиций по мемкоинам" action={<Link href="/market" className="inline-flex rounded-[17px] bg-[var(--panel-3)] px-4 py-2 text-xs font-medium">Открыть маркет</Link>} />
      ) : (
        data.history.length ? <div className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{data.history.map((item) => <Link href={item.href} key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 hover:bg-[var(--panel-2)]"><div className="min-w-0"><p className="truncate text-xs font-medium">{item.label}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{ago(item.createdAt)} · {item.kind === "coin" ? "мемкоин" : "подарок"}</p></div><div className="text-right"><p className="text-xs">{money(item.amount)}</p>{item.pnl !== 0 ? <p className={`text-[10px] ${item.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{item.pnl > 0 ? "+" : ""}{money(item.pnl)}</p> : null}</div></Link>)}</div></div> : <Empty title="История сделок пуста" />
      )}
    </div>
  );
}

function Allocation({ label, value, pct }: { label: string; value: number; pct: number }) {
  return <div className="min-w-0 rounded-[17px] bg-[var(--panel-2)] p-2.5"><div className="flex justify-between gap-1 text-[9px]"><span className="truncate text-[var(--muted)]">{label}</span><span>{pct.toFixed(0)}%</span></div><p className="mt-1 truncate text-[11px] font-medium">{money(value)}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div></div>;
}

function Tab({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`flex min-w-0 items-center justify-center gap-1 rounded-[16px] px-1.5 py-2 text-[10px] whitespace-nowrap ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><span className="truncate">{label}</span>{typeof count === "number" ? <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${active ? "bg-white/8 text-white" : "bg-[var(--surface)] text-[var(--muted-2)]"}`}>{count}</span> : null}</button>;
}

function Empty({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="rounded-[22px] border border-[var(--border)] bg-[var(--panel)] p-8 text-center"><WalletCards size={22} className="mx-auto text-[var(--muted-2)]" /><p className="mt-3 text-xs font-medium">{title}</p>{action ? <div className="mt-4">{action}</div> : null}</div>;
}
