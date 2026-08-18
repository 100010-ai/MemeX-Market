"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronDown, Flame, RefreshCw, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ActivityItem, Coin, GiftAsset, GiftCollection } from "@/lib/types";
import { ago, money, percent, price } from "@/lib/format";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { useTelegramProfile } from "@/components/telegram-provider";

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
  const [message, setMessage] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try { setData(await apiFetch<MarketPayload>("/api/market")); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true).catch(() => undefined), 8000);
    return () => clearInterval(timer);
  }, []);

  async function syncGifts() {
    setSyncing(true); setMessage(null); haptic("medium");
    try {
      const result = await apiFetch<{ uniqueImported: number }>("/api/gifts/sync", { method: "POST" });
      setMessage(`Synced ${result.uniqueImported} unique Telegram Gifts`);
      await Promise.all([load(true), refreshProfile()]);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Sync failed"); }
    finally { setSyncing(false); }
  }

  const models = useMemo(() => [...new Set(data.gifts.map((g) => g.modelName))].sort(), [data.gifts]);
  const backdrops = useMemo(() => [...new Set(data.gifts.map((g) => g.backdropName))].sort(), [data.gifts]);
  const symbols = useMemo(() => [...new Set(data.gifts.map((g) => g.symbolName))].sort(), [data.gifts]);

  const gifts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.gifts.filter((g) => {
      if (q && !`${g.baseName} ${g.number} ${g.modelName} ${g.backdropName} ${g.symbolName}`.toLowerCase().includes(q)) return false;
      if (collection !== "all" && g.baseName !== collection) return false;
      if (model !== "all" && g.modelName !== model) return false;
      if (backdrop !== "all" && g.backdropName !== backdrop) return false;
      if (symbol !== "all" && g.symbolName !== symbol) return false;
      return true;
    }).sort((a, b) => {
      if (sort === "number") return a.number - b.number;
      if (sort === "rarity") return (a.modelRarityPerMille + a.backdropRarityPerMille + a.symbolRarityPerMille) - (b.modelRarityPerMille + b.backdropRarityPerMille + b.symbolRarityPerMille);
      return (a.listingPrice ?? Infinity) - (b.listingPrice ?? Infinity);
    });
  }, [data.gifts, query, collection, model, backdrop, symbol, sort]);

  const coins = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.coins.filter((c) => !q || `${c.name} ${c.symbol}`.toLowerCase().includes(q));
  }, [data.coins, query]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 overflow-hidden rounded-xl border border-[#4a4425] bg-[linear-gradient(100deg,#29230d,#3b3313,#24200f)] px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-black"><Sparkles size={18} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Telegram Gifts + Meme Coins</p>
            <p className="truncate text-[11px] text-[#c6bd8c]">Real Telegram gift metadata, simulated ownership and virtual-money trading.</p>
          </div>
          <button onClick={syncGifts} disabled={syncing} className="hidden rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-50 sm:block">{syncing ? "Syncing…" : "Sync gifts"}</button>
        </div>
      </div>
      {message ? <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)]">{message}</div> : null}

      <div className="mb-3 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1">
        <button onClick={() => setTab("gifts")} className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-sm font-medium ${tab === "gifts" ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><Sparkles size={15} /> Gifts</button>
        <button onClick={() => setTab("coins")} className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-sm font-medium ${tab === "coins" ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><BarChart3 size={15} /> Coins</button>
      </div>

      <div className="mb-3 flex gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3">
          <Search size={15} className="shrink-0 text-[var(--muted)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "gifts" ? "Search NFT / number" : "Search coin"} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-2)]" />
        </label>
        <button onClick={() => load()} aria-label="Refresh market" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
      </div>

      {tab === "gifts" ? (
        <>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            <FilterSelect value={collection} onChange={setCollection} label="Collection" options={data.collections.map((c) => c.baseName)} />
            <FilterSelect value={model} onChange={setModel} label="Model" options={models} />
            <FilterSelect value={backdrop} onChange={setBackdrop} label="Backdrop" options={backdrops} />
            <FilterSelect value={symbol} onChange={setSymbol} label="Symbol" options={symbols} />
            <label className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-xs text-[#b8bbc1]"><SlidersHorizontal size={13} /><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="bg-transparent outline-none"><option value="price">Price</option><option value="number">Number</option><option value="rarity">Rarity</option></select></label>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              {loading && !data.gifts.length ? <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-sm text-[var(--muted)]">Loading gift market…</div> : gifts.length ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">{gifts.map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} />)}</div>
              ) : (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center">
                  <Sparkles className="mx-auto text-[var(--muted)]" />
                  <p className="mt-3 text-sm font-medium">No matching gifts</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">Sync Telegram Gifts or clear the current filters.</p>
                  <PrimaryButton onClick={syncGifts} disabled={syncing} className="mt-4">{syncing ? "Syncing…" : "Sync Telegram Gifts"}</PrimaryButton>
                </div>
              )}
            </div>
            <MarketSide collections={data.collections} activity={data.activity} />
          </div>
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-sm font-medium"><Flame size={15} className="text-[var(--accent)]" /> Trending coins</div>
            <div className="divide-y divide-[var(--border-soft)]">
              {coins.map((coin, index) => (
                <Link href={`/coin/${coin.id}`} key={coin.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 hover:bg-[var(--panel-2)] md:grid-cols-[minmax(0,1.2fr)_1fr_1fr_1fr]">
                  <div className="flex min-w-0 items-center gap-2.5"><span className="w-4 text-[10px] text-[var(--muted)]">{index + 1}</span><CoinAvatar symbol={coin.symbol} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}</p><p className="text-[11px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} holders</p></div></div>
                  <div className="text-right md:text-left"><p className="text-xs font-medium">{price(coin.currentPrice)}</p><p className={`text-[11px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></div>
                  <div className="hidden md:block"><p className="text-[10px] text-[var(--muted)]">Market cap</p><p className="mt-0.5 text-xs">{money(coin.marketCap)}</p></div>
                  <div className="hidden md:block"><p className="text-[10px] text-[var(--muted)]">24h volume</p><p className="mt-0.5 text-xs">{money(coin.volume24h)}</p></div>
                </Link>
              ))}
            </div>
          </div>
          <MarketSide collections={data.collections} activity={data.activity} />
        </div>
      )}
      <button onClick={syncGifts} disabled={syncing} className="mt-4 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] py-2.5 text-xs text-[var(--muted)] sm:hidden">{syncing ? "Syncing Telegram Gifts…" : "Sync Telegram Gifts"}</button>
    </div>
  );
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: string[] }) {
  return <label className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-xs text-[#b8bbc1]"><select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-28 bg-transparent outline-none"><option value="all">{label}</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select><ChevronDown size={12} /></label>;
}

function MarketSide({ collections, activity }: { collections: GiftCollection[]; activity: ActivityItem[] }) {
  return (
    <aside className="space-y-3">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium">Collection floors</div>
        <div className="divide-y divide-[var(--border-soft)]">{collections.slice(0, 5).map((c) => <div key={c.baseName} className="flex items-center justify-between gap-2 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs">{c.baseName}</p><p className="text-[10px] text-[var(--muted)]">{c.listedCount} listed</p></div><div className="text-right"><p className="text-xs">{c.floorPrice ? money(c.floorPrice) : "—"}</p><p className={`text-[10px] ${c.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(c.change24h)}</p></div></div>)}</div>
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border-soft)] px-3 py-2.5 text-xs font-medium">Feed</div>
        <div className="divide-y divide-[var(--border-soft)]">{activity.length ? activity.slice(0, 7).map((a) => <div key={a.id} className="px-3 py-2.5"><div className="flex items-center justify-between gap-2"><p className="truncate text-[11px]">{a.label}</p><span className="shrink-0 text-[10px] text-[var(--muted)]">{ago(a.createdAt)}</span></div><div className="mt-1 flex items-center justify-between gap-2"><span className="truncate text-[10px] text-[var(--muted)]">{a.detail}</span><span className="text-[10px] text-[var(--accent)]">{money(a.amount)}</span></div></div>) : <p className="px-3 py-4 text-xs text-[var(--muted)]">Trades will appear here.</p>}</div>
      </section>
    </aside>
  );
}
