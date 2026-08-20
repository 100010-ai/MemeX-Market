"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Flame, Gift, Plus, Search, ShoppingCart, SlidersHorizontal, Sparkles, Star, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Coin, GiftAsset, GiftCollection, Watchlist } from "@/lib/types";
import { money, percent, price } from "@/lib/format";
import { CoinAvatar } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { GiftFiltersDrawer } from "@/components/gifts/gift-filters-drawer";

const realtimeTables = ["coins", "trades", "virtual_gifts", "gift_trades", "market_events"];
type GenesisState = { total: number; released: number; remainingToRelease: number; completed: boolean; npcAvailable: number };
type GiftFilterOptions = { collections: string[]; models: string[]; backdrops: string[]; symbols: string[] };
type MarketPayload = { coins: Coin[]; gifts: GiftAsset[]; collections: GiftCollection[]; watchlist: Watchlist; cartIds: string[]; totalGifts: number; nextOffset: number | null; marketSeed: string | null; bootstrapRecommended: boolean; genesis: GenesisState | null; filterOptions?: GiftFilterOptions };
type GiftPageChunk = { gifts: GiftAsset[]; nextOffset: number | null; marketSeed: string };
type UnifiedSearch = {
  gifts: GiftAsset[];
  coins: Coin[];
  collections: Array<{ baseName: string; itemCount: number; holderCount: number; listedCount: number; floorPrice: number | null; volume24h: number; change24h: number; tradeCount24h: number }>;
  users: Array<{ id: string; name: string; username: string | null; firstName: string; photoUrl: string | null }>;
};
type GiftSort = "random" | "price" | "newest" | "number" | "rarity" | "offers";
type CoinSort = "gainers" | "volume" | "marketcap" | "newest";
type PriceBand = "all" | "under50" | "50to250" | "250to1000" | "over1000";
type GiftView = "all" | "deals" | "rare" | "new" | "offers";

const emptyMarketPayload = (): MarketPayload => ({ coins: [], gifts: [], collections: [], watchlist: { coinIds: [], giftCollections: [], giftIds: [] }, cartIds: [], totalGifts: 0, nextOffset: null, marketSeed: null, bootstrapRecommended: false, genesis: null, filterOptions: { collections: [], models: [], backdrops: [], symbols: [] } });

function weightedCoinScore(coin: Coin) {
  const volume = Math.log1p(Math.max(0, coin.volume24h));
  const trades = Math.log1p(Math.max(0, coin.tradeCount24h));
  const holders = Math.log1p(Math.max(0, coin.holderCount));
  const liquidity = Math.log1p(Math.max(0, coin.liquidity));
  const momentum = Math.max(-60, Math.min(180, coin.change24h)) / 100;
  return volume * .34 + trades * .28 + holders * .18 + liquidity * .16 + momentum * .04;
}

function weightedCollectionScore(collection: GiftCollection) {
  const volume = Math.log1p(Math.max(0, collection.volume24h));
  const trades = Math.log1p(Math.max(0, collection.tradeCount24h));
  const holders = Math.log1p(Math.max(0, collection.holderCount));
  const momentum = Math.max(-60, Math.min(180, collection.change24h)) / 100;
  const listingHealth = collection.itemCount > 0 ? Math.min(.35, collection.listedCount / collection.itemCount) : 0;
  return volume * .38 + trades * .30 + holders * .20 + momentum * .07 + listingHealth * .05;
}
const marketCache = new Map<"gifts" | "coins", { at: number; payload: MarketPayload }>();
const MARKET_CACHE_MS = 30_000;
const GIFT_PAGE_SIZE = 24;

export default function MarketPage() {
  const [data, setData] = useState<MarketPayload>(() => emptyMarketPayload());
  const [tab, setTab] = useState<"gifts" | "coins">("gifts");
  const [query, setQuery] = useState("");
  const [marketNow] = useState(() => Date.now());
  const deferredQuery = useDeferredValue(query);
  const [watchOnly, setWatchOnly] = useState(false);
  const [collection, setCollection] = useState("all");
  const [model, setModel] = useState("all");
  const [backdrop, setBackdrop] = useState("all");
  const [symbol, setSymbol] = useState("all");
  const [giftSort, setGiftSort] = useState<GiftSort>("random");
  const [giftView, setGiftView] = useState<GiftView>("all");
  const [coinSort, setCoinSort] = useState<CoinSort>("volume");
  const [priceBand, setPriceBand] = useState<PriceBand>("all");
  const [loading, setLoading] = useState(true);
  const [watchBusy, setWatchBusy] = useState<string | null>(null);
  const [cartBusy, setCartBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteSearch, setRemoteSearch] = useState<UnifiedSearch | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const bootstrapInFlight = useRef(false);
  const activeTabRef = useRef(tab);
  useEffect(() => { activeTabRef.current = tab; }, [tab]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadSeq = useRef(0);
  const scopeDataRef = useRef<Partial<Record<"gifts" | "coins", MarketPayload>>>({});

  const load = useCallback(async (silent = false) => {
    const seq = ++loadSeq.current;
    const forced = typeof window !== "undefined" && sessionStorage.getItem("mxm-market-dirty") === "1";
    if (forced) {
      marketCache.clear();
      scopeDataRef.current = {};
    }
    const cached = forced ? undefined : marketCache.get(tab);
    const remembered = forced ? undefined : scopeDataRef.current[tab];
    const warmPayload = cached?.payload || remembered;
    const cacheFresh = cached && Date.now() - cached.at < MARKET_CACHE_MS;
    if (warmPayload && !silent) { setData(warmPayload); setLoading(false); }
    else if (!silent) { setData(emptyMarketPayload()); setLoading(true); }
    if (!silent) setError(null);
    if (cacheFresh && !silent) silent = true;
    try {
      const payload = await apiFetch<MarketPayload>(`/api/market?scope=${tab}&limit=${tab === "gifts" ? GIFT_PAGE_SIZE : 72}&t=${forced ? Date.now() : 0}`);
      if (seq !== loadSeq.current) return;
      marketCache.set(tab, { at: Date.now(), payload });
      scopeDataRef.current[tab] = payload;
      setData(payload);
      setError(null);
      if (forced) sessionStorage.removeItem("mxm-market-dirty");
    } catch (cause) {
      if (seq !== loadSeq.current) return;
      if (!warmPayload) setError(cause instanceof Error ? cause.message : "Не удалось загрузить рынок");
      else console.error("market revalidate", cause);
    } finally { if (seq === loadSeq.current) setLoading(false); }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setRemoteSearch(null); setSearchLoading(false); return; }
    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void apiFetch<UnifiedSearch>(`/api/market/search?q=${encodeURIComponent(q)}`)
        .then((result) => { if (!cancelled) setRemoteSearch(result); })
        .catch((cause) => { if (!cancelled) console.error("market search", cause); })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 240);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const loadMoreGifts = useCallback(async () => {
    if (tab !== "gifts" || loadingMore || data.nextOffset == null || !data.marketSeed || query.trim().length >= 2) return;
    setLoadingMore(true);
    try {
      const payload = await apiFetch<GiftPageChunk>(`/api/market?scope=gifts&lean=1&offset=${data.nextOffset}&limit=${GIFT_PAGE_SIZE}&seed=${encodeURIComponent(data.marketSeed)}`, { cacheMs: 0 });
      if (activeTabRef.current !== "gifts") return;
      setData((current) => {
        const seen = new Set(current.gifts.map((gift) => gift.virtualGiftId));
        const mergedGifts = [...current.gifts, ...payload.gifts.filter((gift) => !seen.has(gift.virtualGiftId))];
        const collectionMap = new Map(current.collections.map((item) => [item.baseName, item] as const));
        const next: MarketPayload = {
          ...current,
          gifts: mergedGifts,
          collections: [...collectionMap.values()],
          nextOffset: payload.nextOffset,
          marketSeed: current.marketSeed || payload.marketSeed,
          bootstrapRecommended: false,
          genesis: current.genesis,
        };
        scopeDataRef.current.gifts = next;
        marketCache.set("gifts", { at: Date.now(), payload: next });
        return next;
      });
    } catch (cause) {
      console.error("gift market pagination", cause);
    } finally {
      setLoadingMore(false);
    }
  }, [tab, loadingMore, data.nextOffset, data.marketSeed, query]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || tab !== "gifts" || data.nextOffset == null || query.trim().length >= 2) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreGifts();
    }, { rootMargin: "280px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab, data.nextOffset, query, loadMoreGifts]);

  const realtimeReload = useCallback(() => { void load(true); }, [load]);

  const bootstrapGifts = useCallback(async () => {
    if (bootstrapInFlight.current || tab !== "gifts") return;
    bootstrapInFlight.current = true;
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      await apiFetch<{ ok: boolean; listed: number }>("/api/gifts/bootstrap", { method: "POST", timeoutMs: 55_000 });
      marketCache.delete("gifts");
      delete scopeDataRef.current.gifts;
      if (activeTabRef.current === "gifts") await load(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось загрузить Telegram Gifts";
      setBootstrapError(message);
      if (activeTabRef.current === "gifts") setError(message);
    } finally {
      bootstrapInFlight.current = false;
      setBootstrapLoading(false);
    }
  }, [load, tab]);

  useEffect(() => {
    if (tab !== "gifts" || loading || !data.bootstrapRecommended || data.totalGifts > 0 || bootstrapLoading || bootstrapError) return;
    void bootstrapGifts();
  }, [tab, loading, data.bootstrapRecommended, data.totalGifts, bootstrapLoading, bootstrapError, bootstrapGifts]);

  const filterOptions = data.filterOptions || { collections: [], models: [], backdrops: [], symbols: [] };
  const filterCollections = useMemo(() => filterOptions.collections.length ? filterOptions.collections : data.collections.map((item) => item.baseName), [filterOptions.collections, data.collections]);
  const models = useMemo(() => filterOptions.models.length ? filterOptions.models : [...new Set(data.gifts.map((gift) => gift.modelName))].sort(), [filterOptions.models, data.gifts]);
  const backdrops = useMemo(() => filterOptions.backdrops.length ? filterOptions.backdrops : [...new Set(data.gifts.map((gift) => gift.backdropName))].sort(), [filterOptions.backdrops, data.gifts]);
  const symbols = useMemo(() => filterOptions.symbols.length ? filterOptions.symbols : [...new Set(data.gifts.map((gift) => gift.symbolName))].sort(), [filterOptions.symbols, data.gifts]);
  const watchedCoins = useMemo(() => new Set(data.watchlist.coinIds), [data.watchlist.coinIds]);
  const watchedCollections = useMemo(() => new Set(data.watchlist.giftCollections), [data.watchlist.giftCollections]);
  const cartIds = useMemo(() => new Set(data.cartIds), [data.cartIds]);
  const hasGiftFilters = collection !== "all" || model !== "all" || backdrop !== "all" || symbol !== "all" || priceBand !== "all" || giftSort !== "random" || giftView !== "all" || watchOnly;
  const advancedFilterCount = [collection !== "all", model !== "all", backdrop !== "all", symbol !== "all", priceBand !== "all", giftSort !== "random"].filter(Boolean).length;

  const gifts = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const source = deferredQuery.trim().length >= 2 && remoteSearch ? remoteSearch.gifts : data.gifts;
    return source.filter((gift) => {
      if (gift.isBurned) return false;
      if (watchOnly && !watchedCollections.has(gift.baseName)) return false;
      if (q && !`${gift.baseName} ${gift.number} ${gift.modelName} ${gift.backdropName} ${gift.symbolName}`.toLowerCase().includes(q)) return false;
      if (collection !== "all" && gift.baseName !== collection) return false;
      if (model !== "all" && gift.modelName !== model) return false;
      if (backdrop !== "all" && gift.backdropName !== backdrop) return false;
      if (symbol !== "all" && gift.symbolName !== symbol) return false;
      if (giftView === "deals" && !(gift.listingPrice != null && gift.estimatedValue != null && gift.estimatedValue > 0 && gift.listingPrice <= gift.estimatedValue * 0.78)) return false;
      if (giftView === "rare" && Math.min(gift.modelRarityPerMille, gift.backdropRarityPerMille, gift.symbolRarityPerMille) > 30) return false;
      if (giftView === "new" && marketNow - new Date(gift.createdAt).getTime() > 48 * 60 * 60 * 1000) return false;
      if (giftView === "offers" && gift.offerCount < 1) return false;
      const listing = gift.listingPrice;
      if (listing == null) return false;
      if (priceBand === "under50" && listing >= 50) return false;
      if (priceBand === "50to250" && (listing < 50 || listing > 250)) return false;
      if (priceBand === "250to1000" && (listing < 250 || listing > 1000)) return false;
      if (priceBand === "over1000" && listing <= 1000) return false;
      return true;
    }).sort((a, b) => {
      if (giftSort === "random") return 0;
      if (giftSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (giftSort === "number") return a.number - b.number;
      if (giftSort === "rarity") return (a.modelRarityPerMille + a.backdropRarityPerMille + a.symbolRarityPerMille) - (b.modelRarityPerMille + b.backdropRarityPerMille + b.symbolRarityPerMille);
      if (giftSort === "offers") return b.offerCount - a.offerCount || Number(a.listingPrice) - Number(b.listingPrice);
      return Number(a.listingPrice) - Number(b.listingPrice);
    });
  }, [data.gifts, remoteSearch, deferredQuery, collection, model, backdrop, symbol, priceBand, giftSort, giftView, watchOnly, watchedCollections, marketNow]);

  useEffect(() => {
    if (tab !== "gifts" || loading || loadingMore || query.trim().length >= 2) return;
    if (!hasGiftFilters || gifts.length >= 12 || data.nextOffset == null) return;
    void loadMoreGifts();
  }, [tab, loading, loadingMore, query, hasGiftFilters, gifts.length, data.nextOffset, loadMoreGifts]);

  const coins = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const source = deferredQuery.trim().length >= 2 && remoteSearch ? remoteSearch.coins : data.coins;
    return source.filter((coin) => {
      if (watchOnly && !watchedCoins.has(coin.id)) return false;
      return !q || `${coin.name} ${coin.symbol}`.toLowerCase().includes(q);
    }).sort((a, b) => {
      if (coinSort === "gainers") return b.change24h - a.change24h;
      if (coinSort === "volume") return b.volume24h - a.volume24h;
      if (coinSort === "marketcap") return b.marketCap - a.marketCap;
      if (coinSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return weightedCoinScore(b) - weightedCoinScore(a);
    });
  }, [data.coins, remoteSearch, deferredQuery, watchOnly, watchedCoins, coinSort]);


  function switchTab(next: "gifts" | "coins") {
    if (next === tab) return;
    const remembered = scopeDataRef.current[next] || marketCache.get(next)?.payload;
    setData(remembered || emptyMarketPayload());
    setLoading(!remembered);
    setQuery("");
    setRemoteSearch(null);
    setSearchLoading(false);
    setTab(next);
  }

  function resetGiftFilters() {
    setCollection("all"); setModel("all"); setBackdrop("all"); setSymbol("all"); setPriceBand("all"); setGiftSort("random"); setGiftView("all"); setWatchOnly(false);
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
      setData((current) => {
        const next = {
          ...current,
          watchlist: kind === "coin"
            ? { ...current.watchlist, coinIds: enabled ? [...new Set([...current.watchlist.coinIds, id])] : current.watchlist.coinIds.filter((value) => value !== id) }
            : { ...current.watchlist, giftCollections: enabled ? [...new Set([...current.watchlist.giftCollections, id])] : current.watchlist.giftCollections.filter((value) => value !== id) },
        };
        scopeDataRef.current[tab] = next;
        marketCache.set(tab, { at: Date.now(), payload: next });
        return next;
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить избранное");
    } finally {
      setWatchBusy(null);
    }
  }

  async function toggleCart(gift: GiftAsset, enabled: boolean) {
    if (cartBusy) return;
    setCartBusy(gift.virtualGiftId);
    try {
      await apiFetch("/api/cart", { method: "POST", body: JSON.stringify({ action: enabled ? "add" : "remove", virtualGiftId: gift.virtualGiftId }) });
      setData((current) => {
        const next = { ...current, cartIds: enabled ? [...new Set([...current.cartIds, gift.virtualGiftId])] : current.cartIds.filter((id) => id !== gift.virtualGiftId) };
        scopeDataRef.current[tab] = next;
        return next;
      });
      marketCache.clear();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить корзину");
    } finally { setCartBusy(null); }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName="mxm-market-v09" tables={realtimeTables} onChange={realtimeReload} debounceMs={1500} />

      <div className="mxm-market-head mb-4">
        <div className="mxm-segment min-w-0 flex-1">
          <button onClick={() => switchTab("gifts")} className={`mxm-segment-button ${tab === "gifts" ? "is-active" : ""}`}><Gift size={15} />Подарки</button>
          <button onClick={() => switchTab("coins")} className={`mxm-segment-button ${tab === "coins" ? "is-active" : ""}`}><BarChart3 size={15} />Мемкоины</button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setWatchOnly((value) => !value)} aria-label="Показать только избранное" className={`header-action ${watchOnly ? "is-active" : ""}`}><Star size={16} fill={watchOnly ? "currentColor" : "none"} /></button>
          <Link href="/cart" aria-label="Корзина" className="header-action relative"><ShoppingCart size={16} />{data.cartIds.length ? <span className="mxm-action-badge">{data.cartIds.length}</span> : null}</Link>
        </div>
      </div>

      <div className="mxm-market-searchbar mb-4">
        <Search size={16} className="shrink-0 text-[var(--muted)]" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "gifts" ? "Найти подарок или номер" : "Найти коин или тикер"} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted-2)]" />
        {query ? <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")} className="mxm-clear-search"><X size={14} /></button> : null}
        <Link href="/hub" aria-label="Лента" className="mxm-feed-link"><Sparkles size={14} /><span className="hidden sm:inline">Лента</span></Link>
      </div>
      {query.trim().length >= 2 && remoteSearch && (remoteSearch.collections.length || remoteSearch.users.length || (tab === "gifts" && remoteSearch.coins.length)) ? <div className="mb-4 border-y border-[var(--border-soft)] py-2">
        <div className="mxm-hscroll gap-2">
          {remoteSearch.collections.slice(0, 4).map((item) => <Link key={`collection:${item.baseName}`} href={`/collections/${encodeURIComponent(item.baseName)}`} className="shrink-0 rounded-[13px] bg-[var(--panel-2)] px-3 py-2 text-[10px]"><span className="font-medium">{item.baseName}</span><span className="ml-2 text-[var(--muted)]">floor {item.floorPrice == null ? "—" : money(item.floorPrice)}</span></Link>)}
          {remoteSearch.users.slice(0, 4).map((user) => <Link key={`user:${user.id}`} href={`/u/${user.id}`} className="flex shrink-0 items-center gap-2 rounded-[13px] bg-[var(--panel-2)] px-3 py-2 text-[10px]">{user.photoUrl ? <img src={user.photoUrl} alt="" className="h-5 w-5 rounded-full object-cover" /> : null}<span className="font-medium">{user.name}</span><span className="text-[var(--muted)]">профиль</span></Link>)}
          {tab === "gifts" ? remoteSearch.coins.slice(0, 4).map((coin) => <Link key={`coin:${coin.id}`} href={`/coin/${coin.id}`} className="shrink-0 rounded-[13px] bg-[var(--panel-2)] px-3 py-2 text-[10px]"><span className="font-medium">${coin.symbol}</span><span className="ml-2 text-[var(--muted)]">{percent(coin.change24h)}</span></Link>) : null}
        </div>
      </div> : null}

      {tab === "gifts" ? (
        <>
          <div className="mxm-view-tabs mxm-hscroll mb-3 gap-5">
            {([
              ["all","Все"],["deals","Выгодно"],["rare","Редкие"],["new","Новые"],["offers","С офферами"]
            ] as [GiftView,string][]).map(([value,label]) => <button key={value} onClick={() => setGiftView(value)} className={`mxm-tab-chip ${giftView === value ? "is-active" : ""}`}>{label}</button>)}
          </div>
          <div className="mxm-market-tools mb-4">
            <button type="button" onClick={() => setFiltersOpen(true)} className={`mxm-market-filter-trigger ${advancedFilterCount ? "is-active" : ""}`}>
              <SlidersHorizontal size={14} /><span>Фильтры</span>{advancedFilterCount ? <b>{advancedFilterCount}</b> : null}
            </button>
            <span className="mxm-market-result-count">{loading ? "Загрузка…" : bootstrapLoading ? "Синхронизация…" : searchLoading ? "Поиск…" : `${gifts.length} ${gifts.length === 1 ? "лот" : "лотов"}${watchOnly ? " · избранное" : ""}`}</span>
            {hasGiftFilters ? <button onClick={resetGiftFilters} className="mxm-market-clear">Сбросить</button> : null}
          </div>
          <GiftFiltersDrawer
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            values={{ collection, model, backdrop, symbol, priceBand, giftSort }}
            onChange={(key, value) => {
              if (key === "collection") setCollection(value);
              else if (key === "model") setModel(value);
              else if (key === "backdrop") setBackdrop(value);
              else if (key === "symbol") setSymbol(value);
              else if (key === "priceBand") setPriceBand(value as PriceBand);
              else setGiftSort(value as GiftSort);
            }}
            onReset={() => { setCollection("all"); setModel("all"); setBackdrop("all"); setSymbol("all"); setPriceBand("all"); setGiftSort("random"); }}
            collections={filterCollections} models={models} backdrops={backdrops} symbols={symbols}
          />
        </>
      ) : (
        <div className="mxm-view-tabs mxm-hscroll mb-4 gap-5">
          {(["gainers","volume","marketcap","newest"] as CoinSort[]).map((value) => <button key={value} onClick={() => setCoinSort(value)} className={`mxm-tab-chip capitalize ${coinSort === value ? "is-active" : ""}`}>{value === "marketcap" ? "Капитализация" : value === "trending" ? "В тренде" : value === "gainers" ? "Рост" : value === "volume" ? "Объём" : "Новые"}</button>)}
          <Link href="/create" className="mxm-filter-chip is-active"><Plus size={14} />Создать</Link>
        </div>
      )}

      {error ? <div className="mb-3 flex items-center justify-between gap-3 mxm-alert mxm-alert-error"><span>{error}</span>{tab === "gifts" && data.totalGifts === 0 ? <button disabled={bootstrapLoading} onClick={() => { setError(null); setBootstrapError(null); void bootstrapGifts(); }} className="shrink-0 rounded-xl border border-[#704149] px-2.5 py-1.5 text-[10px] font-medium text-[#ffc2c8] disabled:opacity-50">Повторить</button> : null}</div> : null}

      {tab === "gifts" ? (
        <div>{loading ? <GridSkeleton /> : gifts.length ? <><div className="market-grid grid gap-x-2.5 gap-y-5 md:gap-x-3">{gifts.map((gift, index) => <GiftCard key={gift.virtualGiftId} gift={gift} priority={index < 4} inCart={cartIds.has(gift.virtualGiftId)} cartBusy={cartBusy === gift.virtualGiftId} onCart={toggleCart} />)}</div>{data.nextOffset != null && query.trim().length < 2 ? <div ref={loadMoreRef} className="h-12 text-center text-[9px] text-[var(--muted)]">{loadingMore ? "Загружаем ещё…" : ""}</div> : null}</> : <EmptyMarket icon={<Gift />} title={watchOnly ? "В избранном пока пусто" : "Ничего не найдено"} text={watchOnly ? "Добавь коллекции в избранное." : "Нет активных лотов."} action={<button disabled={bootstrapLoading} onClick={watchOnly ? () => setWatchOnly(false) : data.totalGifts === 0 ? () => void bootstrapGifts() : resetGiftFilters} className="inline-flex rounded-[14px] bg-[var(--panel-3)] px-4 py-2.5 text-[11px] font-medium disabled:opacity-50">{watchOnly ? "Показать всё" : data.totalGifts === 0 ? (bootstrapLoading ? "Загружаем…" : "Загрузить Gifts") : "Сбросить фильтры"}</button>} />}</div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-soft)] py-2.5"><div className="flex items-center gap-2 text-sm font-medium"><Flame size={15} className="text-[var(--accent)]" />{coinSort === "gainers" ? "Лидеры роста" : coinSort === "volume" ? "Объём" : coinSort === "marketcap" ? "Капитализация" : "Новые коины"}</div><span className="text-[9px] text-[var(--muted)]">{loading ? "Загрузка…" : `${coins.length} активов`}</span></div>
          {loading ? <RowsSkeleton /> : coins.length ? <div className="divide-y divide-[var(--border-soft)]">{coins.map((coin, index) => <CoinRow key={coin.id} coin={coin} index={index + 1} watched={watchedCoins.has(coin.id)} busy={watchBusy === `coin:${coin.id}`} onWatch={(enabled) => toggleWatch("coin", coin.id, enabled)} />)}</div> : <EmptyMarket icon={<BarChart3 />} title={watchOnly ? "В избранном нет коинов" : "Коинов пока нет"} text={watchOnly ? "Добавь коин в избранное." : "Коинов пока нет."} action={<Link href={watchOnly ? "/market" : "/create"} onClick={watchOnly ? () => setWatchOnly(false) : undefined} className={`inline-flex rounded-2xl px-4 py-2.5 text-sm font-semibold ${watchOnly ? "bg-[var(--panel-3)]" : "bg-[var(--accent)] text-black"}`}>{watchOnly ? "Показать всё" : "Создать коин"}</Link>} />}
        </div>
      )}

      {tab === "gifts" && data.cartIds.length ? <Link href="/cart" className="fixed bottom-[calc(68px+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-[17px] border border-[rgba(198,170,88,.25)] bg-[rgba(19,20,22,.96)] px-4 py-2.5 text-[11px] font-semibold mxm-floating-glass shadow-[0_10px_28px_rgba(0,0,0,.38)] lg:bottom-5"><ShoppingCart size={14} className="text-[var(--accent)]"/><span>Корзина · {data.cartIds.length}</span></Link> : null}
    </div>
  );
}

function CoinRow({ coin, index, watched, busy, onWatch }: { coin: Coin; index: number; watched: boolean; busy: boolean; onWatch: (enabled: boolean) => void }) {
  const flowTotal = coin.buyVolume24h + coin.sellVolume24h;
  const buyShare = flowTotal > 0 ? Math.round((coin.buyVolume24h / flowTotal) * 100) : 0;
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2.5 md:grid-cols-[minmax(0,1.25fr)_0.7fr_0.72fr_0.72fr_auto]">
    <Link href={`/coin/${coin.id}`} className="flex min-w-0 items-center gap-2.5"><span className="w-4 text-[10px] text-[var(--muted)]">{index}</span><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}</p><p className="truncate text-[10px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} · {buyShare}% buy</p></div></Link>
    <Link href={`/coin/${coin.id}`} className="text-right md:text-left"><p className="text-xs font-medium">{price(coin.currentPrice)}</p><p className={`text-[10px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></Link>
    <Link href={`/coin/${coin.id}`} className="hidden md:block"><p className="text-[9px] text-[var(--muted)]">Капитализация</p><p className="mt-0.5 text-xs">{money(coin.marketCap)}</p></Link>
    <Link href={`/coin/${coin.id}`} className="hidden md:block"><p className="text-[9px] text-[var(--muted)]">Объём 24ч</p><p className="mt-0.5 text-xs">{money(coin.volume24h)}</p></Link>
    <button disabled={busy} onClick={() => onWatch(!watched)} aria-label={watched ? "Убрать коин из избранного" : "Добавить коин в избранное"} className={`grid h-8 w-8 place-items-center rounded-2xl ${watched ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}><Star size={14} fill={watched ? "currentColor" : "none"} /></button>
  </div>;
}

function EmptyMarket({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode }) { return <div className="p-7 text-center"><div className="mx-auto grid h-8 w-8 place-items-center text-[var(--muted)]">{icon}</div><p className="mt-3 text-xs font-medium">{title}</p><p className="mx-auto mt-1 max-w-sm text-[11px] leading-5 text-[var(--muted)]">{text}</p><div className="mt-4">{action}</div></div>; }
function GridSkeleton() { return <div className="market-grid grid gap-x-2.5 gap-y-5 md:gap-x-3">{Array.from({ length: 8 }, (_, index) => <div key={index}><div className="mxm-skeleton aspect-square rounded-[18px]" /><div className="mt-2.5 px-0.5"><div className="mxm-skeleton h-3.5 w-2/3 rounded" /><div className="mxm-skeleton mt-2 h-3 w-1/2 rounded" /></div></div>)}</div>; }
function RowsSkeleton() { return <div className="p-3"><div className="mxm-skeleton h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /></div>; }
