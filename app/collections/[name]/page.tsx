"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BarChart3, Gem, Layers3, Star, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ago, money, percent } from "@/lib/format";
import type { GiftCollectionDetail, GiftTraitGroup } from "@/lib/types";
import { CoinChart } from "@/components/coin-chart";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";

const realtimeTables = ["virtual_gifts", "gift_trades", "market_events"];

type TraitTab = "models" | "backdrops" | "symbols";

export default function GiftCollectionPage() {
  const { name } = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(name);
  const [data, setData] = useState<GiftCollectionDetail | null>(null);
  const [traitTab, setTraitTab] = useState<TraitTab>("models");
  const [busyWatch, setBusyWatch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setData(null);
    try {
      const next = await apiFetch<GiftCollectionDetail>(`/api/collections/${encodeURIComponent(decodedName)}`);
      setData(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Gift collection");
    }
  }, [decodedName]);

  useEffect(() => { void load(); }, [load]);
  const reload = useCallback(() => { void load(true); }, [load]);

  async function toggleWatch() {
    if (!data || busyWatch) return;
    setBusyWatch(true);
    const enabled = !data.watched;
    try {
      await apiFetch("/api/watchlist", { method: "POST", body: JSON.stringify({ kind: "gift_collection", baseName: data.collection.baseName, enabled }) });
      setData((current) => current ? { ...current, watched: enabled } : current);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update watchlist");
    } finally {
      setBusyWatch(false);
    }
  }

  if (!data) {
    return <div className="mx-auto max-w-6xl"><div className="mxm-skeleton h-[520px] rounded-xl" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  }

  const traits = traitTab === "models" ? data.models : traitTab === "backdrops" ? data.backdrops : data.symbols;
  const c = data.collection;

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName={`mxm-collection-${encodeURIComponent(c.baseName)}`} tables={realtimeTables} onChange={reload} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/market" className="inline-flex items-center gap-2 text-xs text-[var(--muted)] hover:text-white"><ArrowLeft size={15} />Market</Link>
        <button onClick={toggleWatch} disabled={busyWatch} aria-label={data.watched ? "Remove collection from watchlist" : "Add collection to watchlist"} className={`grid h-9 w-9 place-items-center rounded-lg border ${data.watched ? "border-[var(--accent)] bg-[rgba(255,212,0,.08)] text-[var(--accent)]" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"}`}><Star size={16} fill={data.watched ? "currentColor" : "none"} /></button>
      </div>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="px-3 py-4 md:px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[.16em] text-[var(--muted)]">Telegram Gift collection</p>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{c.baseName}</h1>
              <p className="mt-1 text-xs text-[var(--muted)]">{c.itemCount} synced items · {c.listedCount} listed</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[var(--muted)]">Floor</p>
              <p className="mt-1 flex items-center justify-end gap-1 text-lg font-semibold"><Gem size={14} fill="currentColor" />{c.floorPrice == null ? "—" : money(c.floorPrice).replace("$", "")}</p>
              <p className={`mt-1 text-[11px] ${c.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(c.change24h)} 24h</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 border-t border-[var(--border-soft)]">
          <Metric icon={<BarChart3 size={12} />} label="24h volume" value={money(c.volume24h)} />
          <Metric icon={<Users size={12} />} label="Holders" value={String(c.holderCount)} />
          <Metric icon={<Layers3 size={12} />} label="Listings" value={String(c.listedCount)} />
          <Metric icon={<Gem size={12} />} label="Last sale" value={c.lastSalePrice == null ? "—" : money(c.lastSalePrice)} />
        </div>
      </section>

      {error ? <div className="mt-3 rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"><CoinChart candles={data.candles} height={320} baseFrame="1h" /></section>

          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <div className="grid grid-cols-3 border-b border-[var(--border-soft)] p-1">
              <TraitTabButton active={traitTab === "models"} onClick={() => setTraitTab("models")}>Models</TraitTabButton>
              <TraitTabButton active={traitTab === "backdrops"} onClick={() => setTraitTab("backdrops")}>Backdrops</TraitTabButton>
              <TraitTabButton active={traitTab === "symbols"} onClick={() => setTraitTab("symbols")}>Symbols</TraitTabButton>
            </div>
            <TraitTable rows={traits} />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium">Listed Gifts</h2><span className="text-[10px] text-[var(--muted)]">{data.gifts.length} visible</span></div>
            {data.gifts.length ? <div className="market-grid grid gap-2.5">{data.gifts.map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} />)}</div> : <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-xs text-[var(--muted)]">No active listings in this collection.</div>}
          </section>
        </div>

        <aside className="space-y-3">
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] lg:sticky lg:top-[72px]">
            <div className="border-b border-[var(--border-soft)] px-3 py-3 text-xs font-medium">Recent sales</div>
            {data.recentSales.length ? <div className="divide-y divide-[var(--border-soft)]">{data.recentSales.slice(0, 18).map((sale) => <div key={sale.id} className="px-3 py-2.5"><div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-[11px]"><span className="text-[var(--muted)]">{sale.sellerName || "—"}</span> → {sale.buyerName}</p><p className="flex shrink-0 items-center gap-1 text-xs font-medium"><Gem size={10} fill="currentColor" />{money(sale.price).replace("$", "")}</p></div><p className="mt-1 text-[9px] text-[var(--muted)]">{ago(sale.createdAt)}</p></div>)}</div> : <div className="p-6 text-center text-xs text-[var(--muted)]">No completed sales yet.</div>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="min-w-0 border-r border-[var(--border-soft)] px-2 py-2.5 last:border-r-0"><p className="flex items-center gap-1 text-[9px] text-[var(--muted)]">{icon}<span className="truncate">{label}</span></p><p className="mt-1 truncate text-[11px] font-medium">{value}</p></div>;
}

function TraitTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-md py-2 text-[11px] ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{children}</button>;
}

function TraitTable({ rows }: { rows: GiftTraitGroup[] }) {
  if (!rows.length) return <div className="p-6 text-center text-xs text-[var(--muted)]">No traits found.</div>;
  return <div className="divide-y divide-[var(--border-soft)]">{rows.slice(0, 40).map((row) => <div key={row.name} className="grid grid-cols-[minmax(0,1fr)_56px_74px] items-center gap-2 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs">{row.name}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{row.count} items · {row.listedCount} listed{row.rarityPerMille == null ? "" : ` · ${(row.rarityPerMille / 10).toFixed(row.rarityPerMille % 10 ? 1 : 0)}%`}</p></div><span className="text-right text-[10px] text-[var(--muted)]">floor</span><span className="truncate text-right text-xs font-medium">{row.floorPrice == null ? "—" : money(row.floorPrice)}</span></div>)}</div>;
}
