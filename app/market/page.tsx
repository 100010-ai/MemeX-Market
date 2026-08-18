"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Flame, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ActivityItem, Coin, GiftAsset, GiftCollection } from "@/lib/types";
import { ago, money, percent, price } from "@/lib/format";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { useTelegramProfile } from "@/components/telegram-provider";
import { RealtimeRefresh } from "@/components/realtime-refresh";

const realtimeTables = ["coins", "trades", "virtual_gifts", "gift_trades", "market_events"];
type MarketPayload = { coins: Coin[]; gifts: GiftAsset[]; collections: GiftCollection[]; activity: ActivityItem[] };

export default function MarketPage() {
  const [data, setData] = useState<MarketPayload>({ coins: [], gifts: [], collections: [], activity: [] });
  const [tab, setTab] = useState<"gifts" | "coins">("gifts");
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("all");
  const [model, setModel] = useState("all");
  const [backdrop, setBackdrop] = useState("all");
  const [symbol, setSymbol] = useState("all");
  const [sort, setSort] = useState<"price" | "number" | "rarity">("price");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try { setData(await apiFetch<MarketPayload>("/api/market")); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load market"); }
    finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const realtimeReload = useCallback(() => { void load(true); }, [load]);

  async function syncGifts() {
    setSyncing(true); setError(null); haptic("medium");
    try {
      await apiFetch("/api/gifts/sync", { method: "POST" });
      await Promise.all([load(true), refreshProfile()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Gift sync failed"); }
    finally { setSyncing(false); }
  }

  const models = useMemo(() => [...new Set(data.gifts.map((gift) => gift.modelName))].sort(), [data.gifts]);
  const backdrops = useMemo(() => [...new Set(data.gifts.map((gift) => gift.backdropName))].sort(), [data.gifts]);
  const symbols = useMemo(() => [...new Set(data.gifts.map((gift) => gift.symbolName))].sort(), [data.gifts]);

  const gifts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.gifts.filter((gift) => {
      if (q && !`${gift.baseName} ${gift.number} ${gift.modelName} ${gift.backdropName} ${gift.symbolName}`.toLowerCase().includes(q)) return false;
      if (collection !== "all" && gift.baseName !== collection) return false;
      if (model !== "all" && gift.modelName !== model) return false;
      if (backdrop !== "all" && gift.backdropName !== backdrop) return false;
      if (symbol !== "all" && gift.symbolName !== symbol) return false;
      return true;
    }).sort((a, b) => {
      if (sort === "number") return a.number - b.number;
      if (sort === "rarity") return (a.modelRarityPerMille + a.backdropRarityPerMille + a.symbolRarityPerMille) - (b.modelRarityPerMille + b.backdropRarityPerMille + b.symbolRarityPerMille);
      return Number(a.listingPrice) - Number(b.listingPrice);
    });
  }, [data.gifts, query, collection, model, backdrop, symbol, sort]);

  const coins = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.coins.filter((coin) => !q || `${coin.name} ${coin.symbol}`.toLowerCase().includes(q));
  }, [data.coins, query]);

  const giftVolume = data.collections.reduce((sum, item) => sum + item.volume24h, 0);
  const coinVolume = data.coins.reduce((sum, item) => sum + item.volume24h, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName="mxm-market" tables={realtimeTables} onChange={realtimeReload} />

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Metric label="24h volume" value={money(giftVolume + coinVolume)} />
        <Metric label="Gift listings" value={String(data.gifts.length)} />
        <Metric label="Active coins" value={String(data.coins.length)} />
      </div>

      <div className="mb-3 flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1">
        <button onClick={() => setTab("gifts")} className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium ${tab === "gifts" ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><Sparkles size={15} /> Gifts</button>
        <button onClick={() => setTab("coins")} className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium ${tab === "coins" ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><BarChart3 size={15} /> Coins</button>
      </div>

      <div className="mb-3 flex gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3">
          <Search size={15} className="shrink-0 text-[var(--muted)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "gifts" ? "Search Gift / number" : "Search coin"} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-2)]" />
        </label>
        {tab === "gifts" ? <button onClick={syncGifts} disabled={syncing} className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 text-xs text-[#c9ccd1] disabled:opacity-50"><RefreshCw size={14} className={syncing ? "animate-spin" : ""} />Sync</button> : <Link href="/create" className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 text-xs font-semibold text-black"><Plus size={15} />Create</Link>}
      </div>

      {error ? <div className="mb-3 rounded-xl border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

      {tab === "gifts" ? (
        <>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            <FilterSelect value={collection} onChange={setCollection} label="Collection" options={data.collections.map((item) => item.baseName)} />
            <FilterSelect value={model} onChange={setModel} label="Model" options={models} />
            <FilterSelect value={backdrop} onChange={setBackdrop} label="Backdrop" options={backdrops} />
            <FilterSelect value={symbol} onChange={setSymbol} label="Symbol" options={symbols} />
            <label className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-xs text-[#b8bbc1]"><SlidersHorizontal size={13} /><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="bg-transparent outline-none"><option value="price">Price</option><option value="number">Number</option><option value="rarity">Rarity</option></select></label>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              {loading ? <GridSkeleton /> : gifts.length ? <div className="market-grid grid gap-2.5">{gifts.map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} />)}</div> : <EmptyMarket icon={<Sparkles />} title="No Gift listings" text="Sync your Telegram collectibles, then list a virtual Gift in Vault." action={<PrimaryButton onClick={syncGifts} disabled={syncing}>Sync Telegram Gifts</PrimaryButton>} />}
            </div>
            <MarketSide activity={data.activity} collections={data.collections} />
          </div>
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-sm font-medium"><Flame size={15} className="text-[var(--accent)]" /> Trending</div>
            {loading ? <div className="p-3"><div className="mxm-skeleton h-14 rounded-lg" /><div className="mxm-skeleton mt-2 h-14 rounded-lg" /><div className="mxm-skeleton mt-2 h-14 rounded-lg" /></div> : coins.length ? <div className="divide-y divide-[var(--border-soft)]">{coins.map((coin, index) => <CoinRow key={coin.id} coin={coin} index={index + 1} />)}</div> : <EmptyMarket icon={<BarChart3 />} title="No coins yet" text="The first player-created coin will appear here." action={<Link href="/create" className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-black">Create coin</Link>} />}
          </div>
          <MarketSide activity={data.activity} collections={data.collections} />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: string[] }) {
  return <label className="flex h-9 shrink-0 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-xs text-[#b8bbc1]"><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-32 bg-transparent outline-none"><option value="all">{label}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function CoinRow({ coin, index }: { coin: Coin; index: number }) {
  return (
    <Link href={`/coin/${coin.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 hover:bg-[var(--panel-2)] md:grid-cols-[minmax(0,1.3fr)_0.8fr_0.8fr_0.8fr]">
      <div className="flex min-w-0 items-center gap-2.5"><span className="w-4 text-[10px] text-[var(--muted)]">{index}</span><CoinAvatar symbol={coin.symbol} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}</p><p className="text-[11px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} holders</p></div></div>
      <div className="text-right md:text-left"><p className="text-xs font-medium">{price(coin.currentPrice)}</p><p className={`text-[11px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></div>
      <div className="hidden md:block"><p className="text-[10px] text-[var(--muted)]">Market cap</p><p className="mt-0.5 text-xs">{money(coin.marketCap)}</p></div>
      <div className="hidden md:block"><p className="text-[10px] text-[var(--muted)]">24h volume</p><p className="mt-0.5 text-xs">{money(coin.volume24h)}</p></div>
    </Link>
  );
}

function MarketSide({ activity, collections }: { activity: ActivityItem[]; collections: GiftCollection[] }) {
  return <aside className="hidden space-y-3 lg:block"><section className="rounded-xl border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium">Gift collections</div><div className="divide-y divide-[var(--border-soft)]">{collections.slice(0, 6).map((item) => <div key={item.baseName} className="px-3 py-2.5"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs">{item.baseName}</span><span className={`text-[10px] ${item.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(item.change24h)}</span></div><p className="mt-1 text-[10px] text-[var(--muted)]">Floor {item.floorPrice == null ? "—" : money(item.floorPrice)} · {item.listedCount} listed</p></div>)}</div></section><section className="rounded-xl border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium">Live feed</div><div className="divide-y divide-[var(--border-soft)]">{activity.slice(0, 8).map((item) => <Link href={item.href} key={item.id} className="block px-3 py-2.5 hover:bg-[var(--panel-2)]"><p className="truncate text-[11px]"><span className="text-[#cfd2d7]">{item.label}</span> <span className="text-white">{item.detail}</span></p><div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]"><span>{item.amount == null ? item.kind : money(item.amount)}</span><span>{ago(item.createdAt)}</span></div></Link>)}</div></section></aside>;
}

function EmptyMarket({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode }) { return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-10 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[var(--panel-2)] text-[var(--muted)]">{icon}</div><p className="mt-3 text-sm font-medium">{title}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">{text}</p><div className="mt-4">{action}</div></div>; }
function GridSkeleton() { return <div className="market-grid grid gap-2.5">{Array.from({ length: 8 }, (_, i) => <div key={i} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]"><div className="mxm-skeleton aspect-square" /><div className="p-2.5"><div className="mxm-skeleton h-4 rounded" /><div className="mxm-skeleton mt-2 h-8 rounded" /></div></div>)}</div>; }
