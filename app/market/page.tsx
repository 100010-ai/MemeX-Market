"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronDown, Flame, Gift, ListFilter, Plus, Search, SlidersHorizontal, Sparkles, Star, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ActivityItem, Coin, GiftAsset, GiftCollection, Watchlist } from "@/lib/types";
import { ago, money, percent, price } from "@/lib/format";
import { CoinAvatar } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";

const realtimeTables = ["coins", "trades", "virtual_gifts", "gift_trades", "market_events"];
type MarketPayload = { coins: Coin[]; gifts: GiftAsset[]; collections: GiftCollection[]; watchlist: Watchlist; activity: ActivityItem[] };
type GiftSort = "price" | "newest" | "number" | "rarity" | "offers";
type CoinSort = "trending" | "gainers" | "volume" | "marketcap" | "newest";
type PriceBand = "all" | "under50" | "50to250" | "250to1000" | "over1000";

const emptyWatchlist: Watchlist = { coinIds: [], giftCollections: [] };

export default function MarketPage() {
  const [data, setData] = useState<MarketPayload>({ coins: [], gifts: [], collections: [], watchlist: emptyWatchlist, activity: [] });
  const [tab, setTab] = useState<"gifts" | "coins">("gifts");
  const [query, setQuery] = useState("");
  const [watchOnly, setWatchOnly] = useState(false);
  const [collection, setCollection] = useState("all");
  const [model, setModel] = useState("all");
  const [backdrop, setBackdrop] = useState("all");
  const [symbol, setSymbol] = useState("all");
  const [giftSort, setGiftSort] = useState<GiftSort>("price");
  const [coinSort, setCoinSort] = useState<CoinSort>("trending");
  const [priceBand, setPriceBand] = useState<PriceBand>("all");
  const [loading, setLoading] = useState(true);
  const [watchBusy, setWatchBusy] = useState<string | null>(null);
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
  const watchedCoins = useMemo(() => new Set(data.watchlist.coinIds), [data.watchlist.coinIds]);
  const watchedCollections = useMemo(() => new Set(data.watchlist.giftCollections), [data.watchlist.giftCollections]);
  const hasGiftFilters = collection !== "all" || model !== "all" || backdrop !== "all" || symbol !== "all" || priceBand !== "all" || giftSort !== "price" || watchOnly;

  const gifts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.gifts.filter((gift) => {
      if (gift.isBurned) return false;
      if (watchOnly && !watchedCollections.has(gift.baseName)) return false;
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
      if (giftSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (giftSort === "number") return a.number - b.number;
      if (giftSort === "rarity") return (a.modelRarityPerMille + a.backdropRarityPerMille + a.symbolRarityPerMille) - (b.modelRarityPerMille + b.backdropRarityPerMille + b.symbolRarityPerMille);
      if (giftSort === "offers") return b.offerCount - a.offerCount || Number(a.listingPrice) - Number(b.listingPrice);
      return Number(a.listingPrice) - Number(b.listingPrice);
    });
  }, [data.gifts, query, collection, model, backdrop, symbol, priceBand, giftSort, watchOnly, watchedCollections]);

  const coins = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.coins.filter((coin) => {
      if (watchOnly && !watchedCoins.has(coin.id)) return false;
      return !q || `${coin.name} ${coin.symbol}`.toLowerCase().includes(q);
    }).sort((a, b) => {
      if (coinSort === "gainers") return b.change24h - a.change24h;
      if (coinSort === "volume") return b.volume24h - a.volume24h;
      if (coinSort === "marketcap") return b.marketCap - a.marketCap;
      if (coinSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return b.volume24h - a.volume24h || b.tradeCount24h - a.tradeCount24h || b.holderCount - a.holderCount;
    });
  }, [data.coins, query, watchOnly, watchedCoins, coinSort]);

  function resetGiftFilters() {
    setCollection("all"); setModel("all"); setBackdrop("all"); setSymbol("all"); setPriceBand("all"); setGiftSort("price"); setWatchOnly(false);
  }

  async function toggleWatch(kind: "coin" | "gift_collection", id: string, enabled: boolean) {
    const key = `${kind}:${id}`;
    if (watchBusy) return;
    setWatchBusy(key);
    try {
      await apiFetch("/api/watchlist", {
        method: "POST",
        body: JSON.stringify(kind === "coin" ? { kind, coinId: id, enabled } : { kind, baseName: id, enabled }),
      });
      setData((current) => ({
        ...current,
        watchlist: kind === "coin"
          ? { ...current.watchlist, coinIds: enabled ? [...new Set([...current.watchlist.coinIds, id])] : current.watchlist.coinIds.filter((value) => value !== id) }
          : { ...current.watchlist, giftCollections: enabled ? [...new Set([...current.watchlist.giftCollections, id])] : current.watchlist.giftCollections.filter((value) => value !== id) },
      }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update watchlist");
    } finally {
      setWatchBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName="mxm-market-v06" tables={realtimeTables} onChange={realtimeReload} />

      <div className="mb-3 flex items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0.5">
          <button onClick={() => setTab("gifts")} className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium ${tab === "gifts" ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><Gift size={15} />Gifts</button>
          <button onClick={() => setTab("coins")} className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium ${tab === "coins" ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><BarChart3 size={15} />Coins</button>
        </div>
        <button onClick={() => setWatchOnly((value) => !value)} aria-label="Show watchlist only" className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${watchOnly ? "border-[var(--accent)] bg-[rgba(255,212,0,.08)] text-[var(--accent)]" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"}`}><Star size={16} fill={watchOnly ? "currentColor" : "none"} /></button>
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
          {!loading && data.collections.length ? <CollectionRail collections={data.collections} watched={watchedCollections} busy={watchBusy} onWatch={(name, enabled) => toggleWatch("gift_collection", name, enabled)} /> : null}
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1 mxm-scrollbar-none">
            <FilterSelect value={collection} onChange={setCollection} label="Collection" options={data.collections.map((item) => item.baseName)} />
            <FilterSelect value={model} onChange={setModel} label="Model" options={models} />
            <FilterSelect value={backdrop} onChange={setBackdrop} label="Backdrop" options={backdrops} />
            <FilterSelect value={symbol} onChange={setSymbol} label="Symbol" options={symbols} />
            <label className={`relative flex h-9 shrink-0 items-center rounded-lg border px-2.5 text-xs ${priceBand !== "all" ? "border-[#55585e] bg-[var(--panel-3)] text-white" : "border-[var(--border)] bg-[var(--panel-2)] text-[#b8bbc1]"}`}><select aria-label="Price band" value={priceBand} onChange={(event) => setPriceBand(event.target.value as PriceBand)} className="appearance-none bg-transparent pr-5 outline-none"><option value="all">Price</option><option value="under50">Under 50</option><option value="50to250">50–250</option><option value="250to1000">250–1K</option><option value="over1000">1K+</option></select><ChevronDown size={12} className="pointer-events-none absolute right-2" /></label>
            <label className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-xs text-[#b8bbc1]">
              <ListFilter size={13} />
              <select aria-label="Sort Gifts" value={giftSort} onChange={(event) => setGiftSort(event.target.value as GiftSort)} className="appearance-none bg-transparent pr-4 outline-none"><option value="price">Price</option><option value="newest">Newest</option><option value="offers">Offers</option><option value="number">Number</option><option value="rarity">Rarity</option></select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2" />
            </label>
          </div>
          <div className="mb-3 flex h-7 items-center justify-between gap-3 text-[10px] text-[var(--muted)]">
            <span>{loading ? "Loading listings…" : `${gifts.length} listings · ${data.collections.length} collections${watchOnly ? " · watchlist" : ""}`}</span>
            {hasGiftFilters ? <button onClick={resetGiftFilters} className="flex items-center gap-1 text-[#c8cbd0]"><SlidersHorizontal size={11} />Reset</button> : null}
          </div>
        </>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 gap-1 overflow-x-auto mxm-scrollbar-none">{(["trending","gainers","volume","marketcap","newest"] as CoinSort[]).map((value) => <button key={value} onClick={() => setCoinSort(value)} className={`shrink-0 rounded-lg px-2.5 py-2 text-[10px] capitalize ${coinSort === value ? "bg-[var(--panel-3)] text-white" : "bg-[var(--panel)] text-[var(--muted)]"}`}>{value === "marketcap" ? "Market cap" : value}</button>)}</div>
          <Link href="/create" className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-black"><Plus size={14} />Create</Link>
        </div>
      )}

      {error ? <div className="mb-3 rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

      {tab === "gifts" ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>{loading ? <GridSkeleton /> : gifts.length ? <div className="market-grid grid gap-2.5">{gifts.map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} />)}</div> : <EmptyMarket icon={<Gift />} title={watchOnly ? "Watchlist is empty" : "No listings found"} text={watchOnly ? "Star a Gift collection to keep its listings in one place." : "Try another filter or sync your Telegram Gifts in Vault."} action={<Link href={watchOnly ? "/market" : "/vault"} onClick={watchOnly ? () => setWatchOnly(false) : undefined} className="inline-flex rounded-lg bg-[var(--panel-3)] px-4 py-2.5 text-sm font-medium">{watchOnly ? "Show all" : "Open Vault"}</Link>} />}</div>
          <MarketSide activity={data.activity} collections={data.collections} />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-soft)] px-3 py-3"><div className="flex items-center gap-2 text-sm font-medium"><Flame size={15} className="text-[var(--accent)]" />{coinSort === "trending" ? "Trending" : coinSort === "gainers" ? "Top gainers" : coinSort === "volume" ? "Volume" : coinSort === "marketcap" ? "Market cap" : "New coins"}</div><span className="text-[9px] text-[var(--muted)]">{coins.length} assets</span></div>
            {loading ? <RowsSkeleton /> : coins.length ? <div className="divide-y divide-[var(--border-soft)]">{coins.map((coin, index) => <CoinRow key={coin.id} coin={coin} index={index + 1} watched={watchedCoins.has(coin.id)} busy={watchBusy === `coin:${coin.id}`} onWatch={(enabled) => toggleWatch("coin", coin.id, enabled)} />)}</div> : <EmptyMarket icon={<BarChart3 />} title={watchOnly ? "No watched coins" : "No coins yet"} text={watchOnly ? "Star a coin from the market or its trading page." : "Coins appear after a player launches one."} action={<Link href={watchOnly ? "/market" : "/create"} onClick={watchOnly ? () => setWatchOnly(false) : undefined} className={`inline-flex rounded-lg px-4 py-2.5 text-sm font-semibold ${watchOnly ? "bg-[var(--panel-3)]" : "bg-[var(--accent)] text-black"}`}>{watchOnly ? "Show all" : "Create coin"}</Link>} />}
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

function CollectionRail({ collections, watched, busy, onWatch }: { collections: GiftCollection[]; watched: Set<string>; busy: string | null; onWatch: (name: string, enabled: boolean) => void }) {
  return <div className="mb-3 flex gap-2 overflow-x-auto pb-1 mxm-scrollbar-none">{collections.slice(0, 12).map((item) => { const active = watched.has(item.baseName); return <div key={item.baseName} className="w-[188px] shrink-0 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2.5"><div className="flex items-start justify-between gap-2"><Link href={`/collections/${encodeURIComponent(item.baseName)}`} className="min-w-0"><p className="truncate text-xs font-medium">{item.baseName}</p><p className="mt-1 text-[9px] text-[var(--muted)]">{item.listedCount} listed · {item.holderCount} holders</p></Link><button disabled={Boolean(busy)} onClick={() => onWatch(item.baseName, !active)} aria-label={active ? "Remove collection from watchlist" : "Add collection to watchlist"} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${active ? "bg-[rgba(255,212,0,.09)] text-[var(--accent)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}><Star size={12} fill={active ? "currentColor" : "none"} /></button></div><Link href={`/collections/${encodeURIComponent(item.baseName)}`} className="mt-2 flex items-end justify-between gap-2"><div><p className="text-[9px] text-[var(--muted)]">Floor</p><p className="mt-0.5 text-xs font-semibold">{item.floorPrice == null ? "—" : money(item.floorPrice)}</p></div><span className={`text-[10px] ${item.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(item.change24h)}</span></Link></div>; })}</div>;
}

function CoinRow({ coin, index, watched, busy, onWatch }: { coin: Coin; index: number; watched: boolean; busy: boolean; onWatch: (enabled: boolean) => void }) {
  const flowTotal = coin.buyVolume24h + coin.sellVolume24h;
  const buyShare = flowTotal > 0 ? Math.round((coin.buyVolume24h / flowTotal) * 100) : 0;
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-2.5 md:grid-cols-[minmax(0,1.25fr)_0.7fr_0.72fr_0.72fr_auto]">
    <Link href={`/coin/${coin.id}`} className="flex min-w-0 items-center gap-2.5"><span className="w-4 text-[10px] text-[var(--muted)]">{index}</span><CoinAvatar symbol={coin.symbol} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}</p><p className="truncate text-[10px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} holders · {buyShare}% buys</p></div></Link>
    <Link href={`/coin/${coin.id}`} className="text-right md:text-left"><p className="text-xs font-medium">{price(coin.currentPrice)}</p><p className={`text-[10px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></Link>
    <Link href={`/coin/${coin.id}`} className="hidden md:block"><p className="text-[9px] text-[var(--muted)]">Market cap</p><p className="mt-0.5 text-xs">{money(coin.marketCap)}</p></Link>
    <Link href={`/coin/${coin.id}`} className="hidden md:block"><p className="text-[9px] text-[var(--muted)]">24h volume</p><p className="mt-0.5 text-xs">{money(coin.volume24h)}</p></Link>
    <button disabled={busy} onClick={() => onWatch(!watched)} aria-label={watched ? "Remove coin from watchlist" : "Add coin to watchlist"} className={`grid h-8 w-8 place-items-center rounded-md ${watched ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}><Star size={14} fill={watched ? "currentColor" : "none"} /></button>
  </div>;
}

function MarketSide({ activity, collections }: { activity: ActivityItem[]; collections: GiftCollection[] }) {
  return <aside className="hidden space-y-3 lg:block"><section className="rounded-lg border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium">Collections</div><div className="divide-y divide-[var(--border-soft)]">{collections.slice(0, 7).map((item) => <Link href={`/collections/${encodeURIComponent(item.baseName)}`} key={item.baseName} className="block px-3 py-2.5 hover:bg-[var(--panel-2)]"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs">{item.baseName}</span><span className={`text-[10px] ${item.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(item.change24h)}</span></div><p className="mt-1 text-[10px] text-[var(--muted)]">Floor {item.floorPrice == null ? "—" : money(item.floorPrice)} · {item.listedCount} listed</p></Link>)}</div></section><section className="rounded-lg border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium">Live feed</div><div className="divide-y divide-[var(--border-soft)]">{activity.slice(0, 9).map((item) => <Link href={item.href} key={item.id} className="block px-3 py-2.5 hover:bg-[var(--panel-2)]"><p className="truncate text-[11px]"><span className="text-[#cfd2d7]">{item.label}</span> <span className="text-white">{item.detail}</span></p><div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]"><span>{item.amount == null ? item.kind : money(item.amount)}</span><span>{ago(item.createdAt)}</span></div></Link>)}</div></section></aside>;
}

function EmptyMarket({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode }) { return <div className="p-9 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-[var(--panel-2)] text-[var(--muted)]">{icon}</div><p className="mt-3 text-sm font-medium">{title}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">{text}</p><div className="mt-4">{action}</div></div>; }
function GridSkeleton() { return <div className="market-grid grid gap-2.5">{Array.from({ length: 8 }, (_, index) => <div key={index} className="overflow-hidden rounded-[7px] border border-[var(--border)] bg-[var(--panel)]"><div className="mxm-skeleton aspect-square" /><div className="p-2"><div className="mxm-skeleton h-4 rounded" /><div className="mxm-skeleton mt-2 h-8 rounded" /></div></div>)}</div>; }
function RowsSkeleton() { return <div className="p-3"><div className="mxm-skeleton h-14 rounded-lg" /><div className="mxm-skeleton mt-2 h-14 rounded-lg" /><div className="mxm-skeleton mt-2 h-14 rounded-lg" /></div>; }
