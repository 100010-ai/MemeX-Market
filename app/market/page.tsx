"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronDown, Flame, Gift, ListFilter, Plus, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ActivityItem, Coin, GiftAsset, GiftCollection } from "@/lib/types";
import { ago, money, percent, price } from "@/lib/format";
import { CoinAvatar } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";

const realtimeTables = ["coins", "trades", "virtual_gifts", "gift_trades", "market_events"];
type MarketPayload = { coins: Coin[]; gifts: GiftAsset[]; collections: GiftCollection[]; activity: ActivityItem[] };
type GiftSort = "price" | "newest" | "number" | "rarity" | "offers";
type PriceBand = "all" | "under50" | "50to250" | "250to1000" | "over1000";

export default function MarketPage() {
  const [data, setData] = useState<MarketPayload>({ coins: [], gifts: [], collections: [], activity: [] });
  const [tab, setTab] = useState<"gifts" | "coins">("gifts");
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("all");
  const [model, setModel] = useState("all");
  const [backdrop, setBackdrop] = useState("all");
  const [symbol, setSymbol] = useState("all");
  const [sort, setSort] = useState<GiftSort>("price");
  const [priceBand, setPriceBand] = useState<PriceBand>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try { setData(await apiFetch<MarketPayload>("/api/market")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load market"); }
    finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const realtimeReload = useCallback(() => { void load(true); }, [load]);

  const models = useMemo(() => [...new Set(data.gifts.map((gift) => gift.modelName))].sort(), [data.gifts]);
  const backdrops = useMemo(() => [...new Set(data.gifts.map((gift) => gift.backdropName))].sort(), [data.gifts]);
  const symbols = useMemo(() => [...new Set(data.gifts.map((gift) => gift.symbolName))].sort(), [data.gifts]);
  const hasGiftFilters = collection !== "all" || model !== "all" || backdrop !== "all" || symbol !== "all" || priceBand !== "all" || sort !== "price";

  const gifts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.gifts.filter((gift) => {
      if (gift.isBurned) return false;
      if (q && !`${gift.baseName} ${gift.number} ${gift.modelName} ${gift.backdropName} ${gift.symbolName}`.toLowerCase().includes(q)) return false;
      if (collection !== "all" && gift.baseName !== collection) return false;
      if (model !== "all" && gift.modelName !== model) return false;
      if (backdrop !== "all" && gift.backdropName !== backdrop) return false;
      if (symbol !== "all" && gift.symbolName !== symbol) return false;
      const listing = gift.listingPrice;
      if (listing == null) return false;
      if (priceBand === "under50" && listing >= 50) return false;
      if (priceBand === "50to250" && (listing < 50 || listing > 250)) return false;
      if (priceBand === "250to1000" && (listing < 250 || listing > 1000)) return false;
      if (priceBand === "over1000" && listing <= 1000) return false;
      return true;
    }).sort((a, b) => {
      if (sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === "number") return a.number - b.number;
      if (sort === "rarity") return (a.modelRarityPerMille + a.backdropRarityPerMille + a.symbolRarityPerMille) - (b.modelRarityPerMille + b.backdropRarityPerMille + b.symbolRarityPerMille);
      if (sort === "offers") return b.offerCount - a.offerCount || Number(a.listingPrice) - Number(b.listingPrice);
      return Number(a.listingPrice) - Number(b.listingPrice);
    });
  }, [data.gifts, query, collection, model, backdrop, symbol, priceBand, sort]);

  const coins = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.coins.filter((coin) => !q || `${coin.name} ${coin.symbol}`.toLowerCase().includes(q));
  }, [data.coins, query]);

  function resetGiftFilters() {
    setCollection("all"); setModel("all"); setBackdrop("all"); setSymbol("all"); setPriceBand("all"); setSort("price");
  }

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName="mxm-market-v05" tables={realtimeTables} onChange={realtimeReload} />

      <div className="mb-3 grid grid-cols-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0.5">
        <button onClick={() => setTab("gifts")} className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium ${tab === "gifts" ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><Gift size={15} />Gifts</button>
        <button onClick={() => setTab("coins")} className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium ${tab === "coins" ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><BarChart3 size={15} />Coins</button>
      </div>

      <div className="mb-2.5 flex gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 focus-within:border-[#4a4d52]">
          <Search size={15} className="shrink-0 text-[var(--muted)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "gifts" ? "Search NFT / number" : "Search coin / ticker"} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-2)]" />
          {query ? <button aria-label="Clear search" onClick={() => setQuery("")} className="text-[var(--muted)]"><X size={14} /></button> : null}
        </label>
        <Link href="/hub" className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-xs text-[#c7c9cd]"><Sparkles size={14} />Feed</Link>
      </div>

      {tab === "gifts" ? (
        <>
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1 mxm-scrollbar-none">
            <FilterSelect value={collection} onChange={setCollection} label="Collection" options={data.collections.map((item) => item.baseName)} />
            <FilterSelect value={model} onChange={setModel} label="Model" options={models} />
            <FilterSelect value={backdrop} onChange={setBackdrop} label="Backdrop" options={backdrops} />
            <FilterSelect value={symbol} onChange={setSymbol} label="Symbol" options={symbols} />
            <label className={`relative flex h-9 shrink-0 items-center rounded-lg border px-2.5 text-xs ${priceBand !== "all" ? "border-[#55585e] bg-[var(--panel-3)] text-white" : "border-[var(--border)] bg-[var(--panel-2)] text-[#b8bbc1]"}`}><select aria-label="Price band" value={priceBand} onChange={(event) => setPriceBand(event.target.value as PriceBand)} className="appearance-none bg-transparent pr-5 outline-none"><option value="all">Price</option><option value="under50">Under 50</option><option value="50to250">50–250</option><option value="250to1000">250–1K</option><option value="over1000">1K+</option></select><ChevronDown size={12} className="pointer-events-none absolute right-2" /></label>
            <label className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-xs text-[#b8bbc1]">
              <ListFilter size={13} />
              <select aria-label="Sort Gifts" value={sort} onChange={(event) => setSort(event.target.value as GiftSort)} className="appearance-none bg-transparent pr-4 outline-none">
                <option value="price">Price</option><option value="newest">Newest</option><option value="offers">Offers</option><option value="number">Number</option><option value="rarity">Rarity</option>
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2" />
            </label>
          </div>
          <div className="mb-3 flex h-7 items-center justify-between gap-3 text-[10px] text-[var(--muted)]">
            <span>{loading ? "Loading listings…" : `${gifts.length} listings · ${data.collections.length} collections`}</span>
            {hasGiftFilters ? <button onClick={resetGiftFilters} className="flex items-center gap-1 text-[#c8cbd0]"><SlidersHorizontal size={11} />Reset</button> : null}
          </div>
        </>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-3"><span className="text-[10px] text-[var(--muted)]">Live meme coin market</span><Link href="/create" className="flex h-9 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-black"><Plus size={14} />Create coin</Link></div>
      )}

      {error ? <div className="mb-3 rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

      {tab === "gifts" ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>{loading ? <GridSkeleton /> : gifts.length ? <div className="market-grid grid gap-2.5">{gifts.map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} />)}</div> : <EmptyMarket icon={<Gift />} title="No listings found" text="Try another filter or sync your Telegram Gifts in Vault." action={<Link href="/vault" className="inline-flex rounded-lg bg-[var(--panel-3)] px-4 py-2.5 text-sm font-medium">Open Vault</Link>} />}</div>
          <MarketSide activity={data.activity} collections={data.collections} />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-sm font-medium"><Flame size={15} className="text-[var(--accent)]" />Trending</div>
            {loading ? <RowsSkeleton /> : coins.length ? <div className="divide-y divide-[var(--border-soft)]">{coins.map((coin, index) => <CoinRow key={coin.id} coin={coin} index={index + 1} />)}</div> : <EmptyMarket icon={<BarChart3 />} title="No coins yet" text="Coins appear after a player launches one." action={<Link href="/create" className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-black">Create coin</Link>} />}
          </div>
          <MarketSide activity={data.activity} collections={data.collections} />
        </div>
      )}
    </div>
  );
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: string[] }) {
  const active = value !== "all";
  return <label className={`relative flex h-9 shrink-0 items-center rounded-lg border px-2.5 text-xs ${active ? "border-[#55585e] bg-[var(--panel-3)] text-white" : "border-[var(--border)] bg-[var(--panel-2)] text-[#b8bbc1]"}`}><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="max-w-32 appearance-none bg-transparent pr-5 outline-none"><option value="all">{label}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><ChevronDown size={12} className="pointer-events-none absolute right-2" /></label>;
}

function CoinRow({ coin, index }: { coin: Coin; index: number }) {
  return <Link href={`/coin/${coin.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 active:bg-[var(--panel-2)] md:grid-cols-[minmax(0,1.3fr)_0.8fr_0.8fr_0.8fr]"><div className="flex min-w-0 items-center gap-2.5"><span className="w-4 text-[10px] text-[var(--muted)]">{index}</span><CoinAvatar symbol={coin.symbol} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}</p><p className="text-[11px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} holders</p></div></div><div className="text-right md:text-left"><p className="text-xs font-medium">{price(coin.currentPrice)}</p><p className={`text-[11px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></div><div className="hidden md:block"><p className="text-[10px] text-[var(--muted)]">Market cap</p><p className="mt-0.5 text-xs">{money(coin.marketCap)}</p></div><div className="hidden md:block"><p className="text-[10px] text-[var(--muted)]">24h volume</p><p className="mt-0.5 text-xs">{money(coin.volume24h)}</p></div></Link>;
}

function MarketSide({ activity, collections }: { activity: ActivityItem[]; collections: GiftCollection[] }) {
  return <aside className="hidden space-y-3 lg:block"><section className="rounded-lg border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium">Collections</div><div className="divide-y divide-[var(--border-soft)]">{collections.slice(0, 7).map((item) => <div key={item.baseName} className="px-3 py-2.5"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs">{item.baseName}</span><span className={`text-[10px] ${item.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(item.change24h)}</span></div><p className="mt-1 text-[10px] text-[var(--muted)]">Floor {item.floorPrice == null ? "—" : money(item.floorPrice)} · {item.listedCount} listed · {item.holderCount} holders</p></div>)}</div></section><section className="rounded-lg border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium">Live feed</div><div className="divide-y divide-[var(--border-soft)]">{activity.slice(0, 9).map((item) => <Link href={item.href} key={item.id} className="block px-3 py-2.5 hover:bg-[var(--panel-2)]"><p className="truncate text-[11px]"><span className="text-[#cfd2d7]">{item.label}</span> <span className="text-white">{item.detail}</span></p><div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]"><span>{item.amount == null ? item.kind : money(item.amount)}</span><span>{ago(item.createdAt)}</span></div></Link>)}</div></section></aside>;
}

function EmptyMarket({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode }) { return <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-9 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-[var(--panel-2)] text-[var(--muted)]">{icon}</div><p className="mt-3 text-sm font-medium">{title}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">{text}</p><div className="mt-4">{action}</div></div>; }
function GridSkeleton() { return <div className="market-grid grid gap-2.5">{Array.from({ length: 8 }, (_, index) => <div key={index} className="overflow-hidden rounded-[7px] border border-[var(--border)] bg-[var(--panel)]"><div className="mxm-skeleton aspect-square" /><div className="p-2"><div className="mxm-skeleton h-4 rounded" /><div className="mxm-skeleton mt-2 h-8 rounded" /></div></div>)}</div>; }
function RowsSkeleton() { return <div className="p-3"><div className="mxm-skeleton h-14 rounded-lg" /><div className="mxm-skeleton mt-2 h-14 rounded-lg" /><div className="mxm-skeleton mt-2 h-14 rounded-lg" /></div>; }
