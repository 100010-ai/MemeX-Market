"use client";

import Link from "next/link";
import Image from "next/image";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Coins, Flame, Gem, Gift, Layers3, List, Plus, RefreshCw, Search, ShoppingCart, SlidersHorizontal, Sparkles, Star, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ActivityItem, Coin, GiftAsset, GiftCollection, Watchlist } from "@/lib/types";
import { money, percent, price } from "@/lib/format";
import { CoinAvatar } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { GiftFiltersDrawer } from "@/components/gifts/gift-filters-drawer";
import { telegramAvatarProxyUrl } from "@/lib/avatar";

type GenesisState = { total: number; released: number; remainingToRelease: number; completed: boolean; npcAvailable: number };
type GiftFilterOptions = { collections: string[]; models: string[]; backdrops: string[]; symbols: string[] };
type LiquidityState = { mode: "npc_bootstrap" | "player_only"; playerOnly: boolean; playerOwned: number; playerListed: number; activeSellers: number; npcListed: number; playerOwnedThreshold: number; playerListedThreshold: number; activeSellersThreshold: number; ready: boolean; transitionedAt: string | null };
type MarketPayload = { coins: Coin[]; newCoins: Coin[]; gifts: GiftAsset[]; collections: GiftCollection[]; watchlist: Watchlist; cartIds: string[]; totalGifts: number; nextOffset: number | null; marketSeed: string | null; bootstrapRecommended: boolean; genesis: GenesisState | null; liquidity?: LiquidityState | null; filterOptions?: GiftFilterOptions };
type GiftPageChunk = { gifts: GiftAsset[]; totalGifts: number; nextOffset: number | null; marketSeed: string };
type UnifiedSearch = {
  gifts: GiftAsset[];
  coins: Coin[];
  collections: Array<{ baseName: string; itemCount: number; holderCount: number; listedCount: number; floorPrice: number | null; volume24h: number; change24h: number; tradeCount24h: number }>;
  users: Array<{ id: string; name: string; username: string | null; firstName: string; photoUrl: string | null }>;
};
type GiftSort = "random" | "price" | "newest" | "number" | "rarity" | "offers";
type GiftMarketMode = "items" | "collections" | "feed";
type MarketCollectionCard = { baseName: string; listedCount: number; floorPrice: number | null; previewTotal: number; previews: Array<{ virtualGiftId: string; giftNumber: number; listingPrice: number; imageUrl: string | null; modelName: string; backdropName: string; symbolName: string }> };
type CoinSort = "gainers" | "volume" | "marketcap" | "newest";
type PriceBand = "all" | "under50" | "50to250" | "250to1000" | "over1000";
type GiftView = "all" | "deals" | "rare" | "new" | "offers";

const emptyMarketPayload = (): MarketPayload => ({ coins: [], newCoins: [], gifts: [], collections: [], watchlist: { coinIds: [], giftCollections: [], giftIds: [] }, cartIds: [], totalGifts: 0, nextOffset: null, marketSeed: null, bootstrapRecommended: false, genesis: null, liquidity: null, filterOptions: { collections: [], models: [], backdrops: [], symbols: [] } });

function weightedCoinScore(coin: Coin) {
  const volume = Math.log1p(Math.max(0, coin.volume24h));
  const trades = Math.log1p(Math.max(0, coin.tradeCount24h));
  const holders = Math.log1p(Math.max(0, coin.holderCount));
  const momentum = Math.max(-1, Math.min(3, coin.change24h / 100));
  return volume * .36 + trades * .30 + holders * .20 + momentum * .14;
}

function weightedCollectionScore(collection: GiftCollection) {
  const volume = Math.log1p(Math.max(0, collection.volume24h));
  const trades = Math.log1p(Math.max(0, collection.tradeCount24h));
  const holders = Math.log1p(Math.max(0, collection.holderCount));
  const momentum = Math.max(-1, Math.min(3, collection.change24h / 100));
  return volume * .36 + trades * .30 + holders * .20 + momentum * .14;
}

function liquidityMaturity(state: LiquidityState) {
  if (state.playerOnly) return 100;
  const owned = state.playerOwnedThreshold > 0 ? state.playerOwned / state.playerOwnedThreshold : 0;
  const listed = state.playerListedThreshold > 0 ? state.playerListed / state.playerListedThreshold : 0;
  const sellers = state.activeSellersThreshold > 0 ? state.activeSellers / state.activeSellersThreshold : 0;
  return Math.max(0, Math.min(100, Math.floor(Math.min(owned, listed, sellers) * 100)));
}
const marketCache = new Map<string, { at: number; payload: MarketPayload }>();
const MARKET_CACHE_MS = 30_000;
const GIFT_PAGE_SIZE = 24;
const MARKET_UI_STATE_KEY = "mxm-market-ui-v0642";
type MarketUiState = {
  tab?: "gifts" | "coins"; query?: string; watchOnly?: boolean; collection?: string; model?: string; backdrop?: string; symbol?: string;
  giftSort?: GiftSort; giftView?: GiftView; giftMode?: GiftMarketMode; coinSort?: CoinSort; priceBand?: PriceBand; scrollY?: number;
};

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
  const [giftMode, setGiftMode] = useState<GiftMarketMode>("items");
  const realtimeTables = useMemo(() => {
    if (tab === "coins") return ["coins", "trades"];
    if (giftMode === "feed") return ["gift_trades", "gift_listing_events", "market_events"];
    return ["virtual_gifts", "gift_trades"];
  }, [tab, giftMode]);
  const realtimeChannelName = `mxm-market-${tab}-${giftMode}`;
  const [collectionCards, setCollectionCards] = useState<MarketCollectionCard[]>([]);
  const [feedItems, setFeedItems] = useState<ActivityItem[]>([]);
  const [modeLoading, setModeLoading] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [coinSort, setCoinSort] = useState<CoinSort>("volume");
  const [priceBand, setPriceBand] = useState<PriceBand>("all");
  const [loading, setLoading] = useState(true);
  const [watchBusy, setWatchBusy] = useState<string | null>(null);
  const [cartBusy, setCartBusy] = useState<string | null>(null);
  const [collectionCartBusy, setCollectionCartBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [remoteSearchState, setRemoteSearchState] = useState<{ query: string; result: UnifiedSearch } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const giftCatalogQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (collection !== "all") params.set("collection", collection);
    if (model !== "all") params.set("model", model);
    if (backdrop !== "all") params.set("backdrop", backdrop);
    if (symbol !== "all") params.set("symbol", symbol);
    if (priceBand !== "all") params.set("priceBand", priceBand);
    if (giftView !== "all") params.set("view", giftView);
    if (giftSort !== "random") params.set("sort", giftSort);
    return params.toString();
  }, [collection, model, backdrop, symbol, priceBand, giftView, giftSort]);
  const activeScopeKey = tab === "gifts" ? `gifts:${giftCatalogQuery}` : "coins";
  const giftScopeKey = `gifts:${giftCatalogQuery}`;
  const normalizedQuery = query.trim();
  const remoteSearch = normalizedQuery.length >= 2 && remoteSearchState?.query === normalizedQuery ? remoteSearchState.result : null;
  const searchLoading = normalizedQuery.length >= 2 && remoteSearchState?.query !== normalizedQuery;
  const bootstrapInFlight = useRef(false);
  const watchInFlight = useRef(false);
  const cartInFlight = useRef(false);
  const activeTabRef = useRef(tab);
  useEffect(() => { activeTabRef.current = tab; }, [tab]);
  const activeScopeKeyRef = useRef(activeScopeKey);
  useEffect(() => { activeScopeKeyRef.current = activeScopeKey; }, [activeScopeKey]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadSeq = useRef(0);
  const scopeDataRef = useRef<Record<string, MarketPayload>>({});
  const uiStateReadyRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || uiStateReadyRef.current) return;
    uiStateReadyRef.current = true;
    let saved: MarketUiState = {};
    try { saved = JSON.parse(sessionStorage.getItem(MARKET_UI_STATE_KEY) || "{}") as MarketUiState; } catch { saved = {}; }
    const params = new URLSearchParams(window.location.search);
    const explicitCollection = params.get("collection")?.trim() || "";
    const explicitQuery = params.get("q")?.trim() || "";
    const explicitTab = params.get("tab");
    const explicitMode = params.get("mode");
    const hasExplicitMarketState = Boolean(explicitCollection || explicitQuery || explicitTab || explicitMode);
    if (hasExplicitMarketState) {
      if (explicitTab === "coins") setTab("coins");
      else setTab("gifts");
      if (explicitMode === "feed" || explicitMode === "collections" || explicitMode === "items") setGiftMode(explicitMode);
      else setGiftMode("items");
      if (explicitCollection) setCollection(explicitCollection);
      setQuery(explicitQuery);
    } else {
      if (saved.tab === "coins" || saved.tab === "gifts") setTab(saved.tab);
      if (typeof saved.query === "string") setQuery(saved.query.slice(0, 120));
      if (typeof saved.watchOnly === "boolean") setWatchOnly(saved.watchOnly);
      if (typeof saved.collection === "string") setCollection(saved.collection);
      if (typeof saved.model === "string") setModel(saved.model);
      if (typeof saved.backdrop === "string") setBackdrop(saved.backdrop);
      if (typeof saved.symbol === "string") setSymbol(saved.symbol);
      if (["random","price","newest","number","rarity","offers"].includes(String(saved.giftSort))) setGiftSort(saved.giftSort as GiftSort);
      if (["all","deals","rare","new","offers"].includes(String(saved.giftView))) setGiftView(saved.giftView as GiftView);
      if (["items","collections","feed"].includes(String(saved.giftMode))) setGiftMode(saved.giftMode as GiftMarketMode);
      if (["gainers","volume","marketcap","newest"].includes(String(saved.coinSort))) setCoinSort(saved.coinSort as CoinSort);
      if (["all","under50","50to250","250to1000","over1000"].includes(String(saved.priceBand))) setPriceBand(saved.priceBand as PriceBand);
    }
    const savedScroll = Number(saved.scrollY || 0);
    if (!hasExplicitMarketState && savedScroll > 0) window.setTimeout(() => window.scrollTo({ top: savedScroll, behavior: "auto" }), 120);
  }, []);

  useEffect(() => {
    if (!uiStateReadyRef.current || typeof window === "undefined") return;
    const state: MarketUiState = { tab, query, watchOnly, collection, model, backdrop, symbol, giftSort, giftView, giftMode, coinSort, priceBand, scrollY: window.scrollY };
    try { sessionStorage.setItem(MARKET_UI_STATE_KEY, JSON.stringify(state)); } catch { /* storage can be disabled */ }
  }, [tab, query, watchOnly, collection, model, backdrop, symbol, giftSort, giftView, giftMode, coinSort, priceBand]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saveScroll = () => {
      try {
        const current = JSON.parse(sessionStorage.getItem(MARKET_UI_STATE_KEY) || "{}") as MarketUiState;
        sessionStorage.setItem(MARKET_UI_STATE_KEY, JSON.stringify({ ...current, scrollY: window.scrollY }));
      } catch { /* storage can be disabled */ }
    };
    window.addEventListener("pagehide", saveScroll);
    return () => { saveScroll(); window.removeEventListener("pagehide", saveScroll); };
  }, []);

  const load = useCallback(async (silent = false, fresh = false) => {
    const seq = ++loadSeq.current;
    const forced = typeof window !== "undefined" && sessionStorage.getItem("mxm-market-dirty") === "1";
    if (forced) {
      marketCache.clear();
      scopeDataRef.current = {};
    }
    const cached = forced ? undefined : marketCache.get(activeScopeKey);
    const remembered = forced ? undefined : scopeDataRef.current[activeScopeKey];
    const warmPayload = cached?.payload || remembered;
    const cacheFresh = cached && Date.now() - cached.at < MARKET_CACHE_MS;
    if (warmPayload && !silent) { setData(warmPayload); setLoading(false); }
    else if (!silent) { setData(emptyMarketPayload()); setLoading(true); }
    if (!silent) { setError(null); setLoadError(null); }
    if (cacheFresh && !silent) silent = true;
    try {
      const catalogParams = tab === "gifts" && giftCatalogQuery ? `&${giftCatalogQuery}` : "";
      const payload = await apiFetch<MarketPayload>(`/api/market?scope=${tab}&limit=${tab === "gifts" ? GIFT_PAGE_SIZE : 72}&t=${forced || fresh ? Date.now() : 0}${catalogParams}`, {
        cacheMs: fresh ? 0 : undefined,
        dedupe: !fresh,
      });
      if (seq !== loadSeq.current) return;
      marketCache.set(activeScopeKey, { at: Date.now(), payload });
      scopeDataRef.current[activeScopeKey] = payload;
      setData(payload);
      setError(null);
      setLoadError(null);
      if (forced) sessionStorage.removeItem("mxm-market-dirty");
    } catch (cause) {
      if (seq !== loadSeq.current) return;
      if (!warmPayload) {
        const message = cause instanceof Error ? cause.message : "Не удалось загрузить рынок";
        setError(message);
        setLoadError(message);
      }
      else console.error("market revalidate", cause);
    } finally { if (seq === loadSeq.current) setLoading(false); }
  }, [tab, activeScopeKey, giftCatalogQuery]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRemoteSearchState(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void apiFetch<UnifiedSearch>(`/api/market/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, cacheMs: 4_000 })
        .then((result) => setRemoteSearchState({ query: q, result }))
        .catch((cause) => {
          if (controller.signal.aborted) return;
          console.error("market search", cause);
          setRemoteSearchState({ query: q, result: { gifts: [], coins: [], collections: [], users: [] } });
        });
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  const loadMoreGifts = useCallback(async () => {
    if (tab !== "gifts" || loadingMore || data.nextOffset == null || !data.marketSeed || query.trim().length >= 2) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const catalogParams = giftCatalogQuery ? `&${giftCatalogQuery}` : "";
      const payload = await apiFetch<GiftPageChunk>(`/api/market?scope=gifts&lean=1&offset=${data.nextOffset}&limit=${GIFT_PAGE_SIZE}&seed=${encodeURIComponent(data.marketSeed)}${catalogParams}`, { cacheMs: 0 });
      if (activeTabRef.current !== "gifts") return;
      setData((current) => {
        const seen = new Set(current.gifts.map((gift) => gift.virtualGiftId));
        const mergedGifts = [...current.gifts, ...payload.gifts.filter((gift) => !seen.has(gift.virtualGiftId))];
        const collectionMap = new Map(current.collections.map((item) => [item.baseName, item] as const));
        const next: MarketPayload = {
          ...current,
          gifts: mergedGifts,
          collections: [...collectionMap.values()],
          totalGifts: payload.totalGifts,
          nextOffset: payload.nextOffset,
          marketSeed: current.marketSeed || payload.marketSeed,
          bootstrapRecommended: false,
          genesis: current.genesis,
        };
        scopeDataRef.current[giftScopeKey] = next;
        marketCache.set(giftScopeKey, { at: Date.now(), payload: next });
        return next;
      });
    } catch (cause) {
      console.error("gift market pagination", cause);
      setLoadMoreError(cause instanceof Error ? cause.message : "Не удалось загрузить следующую страницу подарков");
    } finally {
      setLoadingMore(false);
    }
  }, [tab, loadingMore, data.nextOffset, data.marketSeed, query, giftCatalogQuery, giftScopeKey]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || tab !== "gifts" || data.nextOffset == null || query.trim().length >= 2 || loadMoreError) return;
    const device = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };
    const effectiveType = device.connection?.effectiveType || "";
    const constrainedNetwork = Boolean(device.connection?.saveData || effectiveType.includes("2g"));
    // На слабой сети не тянем следующую страницу за сотни пикселей до viewport:
    // пользователь всё ещё получает автоподгрузку, но без лишнего фонового трафика.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreGifts();
    }, { rootMargin: constrainedNetwork ? "72px 0px" : "280px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab, data.nextOffset, query, loadMoreError, loadMoreGifts]);

  const loadGiftMode = useCallback(async (mode: GiftMarketMode, fresh = false) => {
    if (mode === "items") return;
    setModeLoading(true);
    setModeError(null);
    try {
      if (mode === "collections") {
        const payload = await apiFetch<{ collections: MarketCollectionCard[] }>("/api/market/collections?limit=40", {
          cacheMs: fresh ? 0 : 10_000,
          dedupe: !fresh,
        });
        setCollectionCards(Array.isArray(payload.collections) ? payload.collections : []);
      } else {
        const payload = await apiFetch<{ activity: ActivityItem[] }>("/api/feed?limit=50", {
          cacheMs: fresh ? 0 : 5_000,
          dedupe: !fresh,
        });
        setFeedItems(Array.isArray(payload.activity) ? payload.activity : []);
      }
    } catch (cause) {
      setModeError(cause instanceof Error ? cause.message : "Не удалось загрузить раздел рынка");
    } finally {
      setModeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "gifts" || giftMode === "items") return;
    void loadGiftMode(giftMode);
  }, [tab, giftMode, loadGiftMode]);

  const realtimeReload = useCallback(() => {
    void load(true, true);
    if (tab === "gifts" && giftMode !== "items") void loadGiftMode(giftMode, true);
  }, [load, loadGiftMode, tab, giftMode]);

  const bootstrapGifts = useCallback(async () => {
    if (bootstrapInFlight.current || tab !== "gifts") return;
    bootstrapInFlight.current = true;
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const bootstrap = await apiFetch<{ ok: boolean; listed: number; pending?: boolean; retryAfterMs?: number }>("/api/gifts/bootstrap", { method: "POST", timeoutMs: 55_000 });
      if (bootstrap.pending) await new Promise((resolve) => window.setTimeout(resolve, Math.max(1_500, Math.min(8_000, bootstrap.retryAfterMs || 5_000))));
      for (const key of marketCache.keys()) if (key.startsWith("gifts:")) marketCache.delete(key);
      for (const key of Object.keys(scopeDataRef.current)) if (key.startsWith("gifts:")) delete scopeDataRef.current[key];
      if (activeTabRef.current === "gifts") await load(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось загрузить Telegram-подарки";
      setBootstrapError(message);
      if (activeTabRef.current === "gifts") setError(message);
    } finally {
      bootstrapInFlight.current = false;
      setBootstrapLoading(false);
    }
  }, [load, tab]);

  useEffect(() => {
    if (tab !== "gifts" || loading || !data.bootstrapRecommended || data.totalGifts > 0 || bootstrapLoading || bootstrapError) return;
    const timer = window.setTimeout(() => void bootstrapGifts(), 0);
    return () => window.clearTimeout(timer);
  }, [tab, loading, data.bootstrapRecommended, data.totalGifts, bootstrapLoading, bootstrapError, bootstrapGifts]);

  const filterOptions = data.filterOptions || { collections: [], models: [], backdrops: [], symbols: [] };
  const filterCollections = useMemo(() => filterOptions.collections.length ? filterOptions.collections : data.collections.map((item) => item.baseName), [filterOptions.collections, data.collections]);
  const models = useMemo(() => filterOptions.models.length ? filterOptions.models : [...new Set(data.gifts.map((gift) => gift.modelName))].sort(), [filterOptions.models, data.gifts]);
  const backdrops = useMemo(() => filterOptions.backdrops.length ? filterOptions.backdrops : [...new Set(data.gifts.map((gift) => gift.backdropName))].sort(), [filterOptions.backdrops, data.gifts]);
  const symbols = useMemo(() => filterOptions.symbols.length ? filterOptions.symbols : [...new Set(data.gifts.map((gift) => gift.symbolName))].sort(), [filterOptions.symbols, data.gifts]);
  const watchedCoins = useMemo(() => new Set(data.watchlist.coinIds), [data.watchlist.coinIds]);
  const watchedCollections = useMemo(() => new Set(data.watchlist.giftCollections), [data.watchlist.giftCollections]);
  const cartIds = useMemo(() => new Set(data.cartIds), [data.cartIds]);
  const hotCoins = useMemo(() => data.coins
    .filter((coin) => coin.volume24h > 0 || coin.tradeCount24h > 0 || coin.change24h !== 0)
    .slice()
    .sort((a, b) => weightedCoinScore(b) - weightedCoinScore(a))
    .slice(0, 5), [data.coins]);
  const hotCollections = useMemo(() => data.collections
    .filter((item) => item.volume24h > 0 || item.tradeCount24h > 0 || item.change24h !== 0)
    .slice()
    .sort((a, b) => weightedCollectionScore(b) - weightedCollectionScore(a))
    .slice(0, 5), [data.collections]);
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
    if (!hasGiftFilters || gifts.length >= 12 || data.nextOffset == null || loadMoreError) return;
    const timer = window.setTimeout(() => void loadMoreGifts(), 0);
    return () => window.clearTimeout(timer);
  }, [tab, loading, loadingMore, query, hasGiftFilters, gifts.length, data.nextOffset, loadMoreError, loadMoreGifts]);

  const visibleCollectionCards = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return collectionCards.filter((item) => !q || item.baseName.toLowerCase().includes(q));
  }, [collectionCards, deferredQuery]);

  const visibleFeedItems = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return feedItems.filter((item) => !q || `${item.label} ${item.detail}`.toLowerCase().includes(q));
  }, [feedItems, deferredQuery]);

  const coins = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const source = deferredQuery.trim().length >= 2 && remoteSearch
      ? remoteSearch.coins
      : coinSort === "newest" ? data.newCoins : data.coins;
    return source.filter((coin) => {
      if (watchOnly && !watchedCoins.has(coin.id)) return false;
      return !q || `${coin.name} ${coin.symbol}`.toLowerCase().includes(q);
    }).sort((a, b) => {
      if (coinSort === "gainers") return b.change24h - a.change24h;
      if (coinSort === "volume") return b.volume24h - a.volume24h;
      if (coinSort === "marketcap") return b.marketCap - a.marketCap;
      const aBoost = a.boostedUntil && new Date(a.boostedUntil).getTime() > marketNow ? new Date(a.boostedUntil).getTime() : 0;
      const bBoost = b.boostedUntil && new Date(b.boostedUntil).getTime() > marketNow ? new Date(b.boostedUntil).getTime() : 0;
      if (aBoost !== bBoost) return bBoost - aBoost;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [data.coins, data.newCoins, remoteSearch, deferredQuery, watchOnly, watchedCoins, coinSort, marketNow]);


  function switchTab(next: "gifts" | "coins") {
    if (next === tab) return;
    const nextKey = next === "gifts" ? giftScopeKey : "coins";
    const remembered = scopeDataRef.current[nextKey] || marketCache.get(nextKey)?.payload;
    setData(remembered || emptyMarketPayload());
    setLoading(!remembered);
    setQuery("");
    setRemoteSearchState(null);
    setLoadError(null);
    setLoadMoreError(null);
    if (next === "coins") setGiftMode("items");
    setTab(next);
  }

  function resetGiftFilters() {
    setCollection("all"); setModel("all"); setBackdrop("all"); setSymbol("all"); setPriceBand("all"); setGiftSort("random"); setGiftView("all"); setWatchOnly(false);
  }

  const toggleWatch = useCallback(async (kind: "coin" | "gift_collection", id: string, enabled: boolean) => {
    const key = `${kind}:${id}`;
    if (watchInFlight.current) return;
    watchInFlight.current = true;
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
        const activeKey = activeScopeKeyRef.current;
        scopeDataRef.current[activeKey] = next;
        marketCache.set(activeKey, { at: Date.now(), payload: next });
        return next;
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить избранное");
    } finally {
      watchInFlight.current = false;
      setWatchBusy(null);
    }
  }, []);

  const toggleCart = useCallback(async (gift: GiftAsset, enabled: boolean) => {
    if (cartInFlight.current) return;
    cartInFlight.current = true;
    setCartBusy(gift.virtualGiftId);
    try {
      await apiFetch("/api/cart", { method: "POST", body: JSON.stringify({ action: enabled ? "add" : "remove", virtualGiftId: gift.virtualGiftId }) });
      setData((current) => {
        const next = { ...current, cartIds: enabled ? [...new Set([...current.cartIds, gift.virtualGiftId])] : current.cartIds.filter((id) => id !== gift.virtualGiftId) };
        scopeDataRef.current[activeScopeKeyRef.current] = next;
        return next;
      });
      marketCache.clear();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить корзину");
    } finally {
      cartInFlight.current = false;
      setCartBusy(null);
    }
  }, []);

  const addCollectionPreviewToCart = useCallback(async (card: MarketCollectionCard) => {
    if (collectionCartBusy) return;
    const ids = card.previews.slice(0, 3).map((gift) => gift.virtualGiftId).filter((id) => !cartIds.has(id));
    if (!ids.length) return;
    setCollectionCartBusy(card.baseName);
    try {
      const result = await apiFetch<{ added?: string[] }>("/api/cart/bulk", { method: "POST", body: JSON.stringify({ virtualGiftIds: ids }) });
      const added = Array.isArray(result.added) ? result.added : [];
      setData((current) => {
        const next = { ...current, cartIds: [...new Set([...current.cartIds, ...added])] };
        scopeDataRef.current[activeScopeKeyRef.current] = next;
        return next;
      });
      marketCache.clear();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось добавить набор в корзину");
    } finally {
      setCollectionCartBusy(null);
    }
  }, [cartIds, collectionCartBusy]);

  return (
    <div className="mx-auto max-w-6xl">
      <RealtimeRefresh channelName={realtimeChannelName} tables={realtimeTables} onChange={realtimeReload} debounceMs={1800} />

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
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "gifts" ? "Найти подарок или номер" : "Найти мемкоин или тикер"} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted-2)]" />
        {query ? <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")} className="mxm-clear-search"><X size={14} /></button> : null}
        {tab === "gifts" ? <button type="button" onClick={() => setGiftMode("feed")} aria-label="Лента рынка" className={`mxm-feed-link ${giftMode === "feed" ? "is-active" : ""}`}><List size={14} /><span>Лента</span></button> : <Link href="/hub" aria-label="Лента" className="mxm-feed-link"><Sparkles size={14} /><span className="hidden sm:inline">Лента</span></Link>}
      </div>
      {tab === "gifts" ? <div className="mxm-hscroll mb-3 gap-2">
        <button type="button" onClick={() => setGiftMode("items")} className={`mxm-filter-chip ${giftMode === "items" ? "is-active" : ""}`}><Gift size={13} />Подарки</button>
        <button type="button" onClick={() => setGiftMode("collections")} className={`mxm-filter-chip ${giftMode === "collections" ? "is-active" : ""}`}><Layers3 size={13} />Коллекции</button>
        {data.liquidity ? <span className={`ml-auto shrink-0 py-1.5 text-[9px] ${data.liquidity.playerOnly ? "text-[var(--positive)]" : "text-[var(--muted-2)]"}`}>{data.liquidity.playerOnly ? "Рынок игроков" : `Развитие рынка · ${liquidityMaturity(data.liquidity)}%`}</span> : null}
      </div> : null}

      {query.trim().length >= 2 && remoteSearch && (remoteSearch.collections.length || remoteSearch.users.length || (tab === "gifts" && remoteSearch.coins.length)) ? <div className="mb-4 border-y border-[var(--border-soft)] py-2">
        <div className="mxm-hscroll gap-2">
          {remoteSearch.collections.slice(0, 4).map((item) => <Link key={`collection:${item.baseName}`} href={`/collections/${encodeURIComponent(item.baseName)}`} className="shrink-0 rounded-[13px] bg-[var(--panel-2)] px-3 py-2 text-[10px]"><span className="font-medium">{item.baseName}</span><span className="ml-2 text-[var(--muted)]">от {item.floorPrice == null ? "—" : money(item.floorPrice)}</span></Link>)}
          {remoteSearch.users.slice(0, 4).map((user) => <Link key={`user:${user.id}`} href={`/u/${user.id}`} className="flex shrink-0 items-center gap-2 rounded-[13px] bg-[var(--panel-2)] px-3 py-2 text-[10px]">{telegramAvatarProxyUrl(user.photoUrl) ? <Image unoptimized src={telegramAvatarProxyUrl(user.photoUrl)!} alt="" width={20} height={20} className="h-5 w-5 rounded-full object-cover" /> : null}<span className="font-medium">{user.name}</span><span className="text-[var(--muted)]">профиль</span></Link>)}
          {tab === "gifts" ? remoteSearch.coins.slice(0, 4).map((coin) => <Link key={`coin:${coin.id}`} href={`/coin/${coin.id}`} className="shrink-0 rounded-[13px] bg-[var(--panel-2)] px-3 py-2 text-[10px]"><span className="font-medium">${coin.symbol}</span><span className="ml-2 text-[var(--muted)]">{percent(coin.change24h)}</span></Link>) : null}
        </div>
      </div> : null}

      {tab !== "gifts" || giftMode === "items" ? <HotNowStrip tab={tab} coins={hotCoins} collections={hotCollections} loading={loading} /> : null}

      {tab === "gifts" && giftMode === "items" ? (
        <>
          <div className="mxm-view-tabs mxm-hscroll mb-3 gap-5">
            {([
              ["all","Все"],["deals","Выгодно"],["rare","Редкие"],["new","Новые"],["offers","С предложениями"]
            ] as [GiftView,string][]).map(([value,label]) => <button key={value} onClick={() => setGiftView(value)} className={`mxm-tab-chip ${giftView === value ? "is-active" : ""}`}>{label}</button>)}
          </div>
          <div className="mxm-market-tools mb-4">
            <button type="button" onClick={() => setFiltersOpen(true)} className={`mxm-market-filter-trigger ${advancedFilterCount ? "is-active" : ""}`}>
              <SlidersHorizontal size={14} /><span>Фильтры</span>{advancedFilterCount ? <b>{advancedFilterCount}</b> : null}
            </button>
            <span className="mxm-market-result-count">{loading ? "Загрузка…" : bootstrapLoading ? "Синхронизация…" : searchLoading ? "Поиск…" : `${gifts.length}${query.trim().length < 2 && !watchOnly ? ` из ${data.totalGifts}` : ""} лотов${watchOnly ? " · избранное" : ""}`}</span>
            {hasGiftFilters ? <button onClick={resetGiftFilters} className="mxm-market-clear">Сбросить</button> : null}
          </div>
          {hasGiftFilters ? <div className="mxm-hscroll mxm-active-filters mb-3 gap-1.5">
            {collection !== "all" ? <button type="button" onClick={() => setCollection("all")}>{collection}<X size={9} /></button> : null}
            {model !== "all" ? <button type="button" onClick={() => setModel("all")}>{model}<X size={9} /></button> : null}
            {backdrop !== "all" ? <button type="button" onClick={() => setBackdrop("all")}>{backdrop}<X size={9} /></button> : null}
            {symbol !== "all" ? <button type="button" onClick={() => setSymbol("all")}>{symbol}<X size={9} /></button> : null}
            {priceBand !== "all" ? <button type="button" onClick={() => setPriceBand("all")}>{priceBand === "under50" ? "до 50" : priceBand === "50to250" ? "50–250" : priceBand === "250to1000" ? "250–1000" : "1000+"}<X size={9} /></button> : null}
          </div> : null}
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
      ) : tab === "coins" ? (
        <div className="mxm-view-tabs mxm-hscroll mb-4 gap-5">
          {(["gainers","volume","marketcap","newest"] as CoinSort[]).map((value) => <button key={value} onClick={() => setCoinSort(value)} className={`mxm-tab-chip capitalize ${coinSort === value ? "is-active" : ""}`}>{value === "marketcap" ? "Капитализация" : value === "gainers" ? "Рост" : value === "volume" ? "Объём" : "Новые"}</button>)}
          <Link href="/create" className="mxm-filter-chip is-active"><Plus size={14} />Создать</Link>
        </div>
      ) : null}

      {error ? <div className="mb-3 flex items-center justify-between gap-3 mxm-alert mxm-alert-error">
        <span>{error}</span>
        {loadError ? <button disabled={loading} onClick={() => void load(false)} className="shrink-0 rounded-xl border border-[#704149] px-2.5 py-1.5 text-[10px] font-medium text-[#ffc2c8] disabled:opacity-50">{loading ? "Загрузка…" : "Повторить"}</button>
          : tab === "gifts" && data.totalGifts === 0 ? <button disabled={bootstrapLoading} onClick={() => { setError(null); setBootstrapError(null); void bootstrapGifts(); }} className="shrink-0 rounded-xl border border-[#704149] px-2.5 py-1.5 text-[10px] font-medium text-[#ffc2c8] disabled:opacity-50">Повторить</button> : null}
      </div> : null}

      {tab === "gifts" ? (
        giftMode === "items" ? (
          <div>{loading ? <GridSkeleton /> : gifts.length ? <><div className="market-grid grid gap-x-2.5 gap-y-5 md:gap-x-3">{gifts.map((gift, index) => <GiftCard key={gift.virtualGiftId} gift={gift} priority={index < 4} inCart={cartIds.has(gift.virtualGiftId)} cartBusy={cartBusy === gift.virtualGiftId} onCart={toggleCart} />)}</div>{data.nextOffset != null && query.trim().length < 2 ? <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center text-center text-[9px] text-[var(--muted)]">{loadMoreError ? <div className="flex items-center gap-2"><span>{loadMoreError}</span><button type="button" onClick={() => void loadMoreGifts()} className="rounded-xl border border-[var(--border)] px-2.5 py-1.5 text-[10px] text-white">Повторить</button></div> : loadingMore ? "Загружаем ещё…" : ""}</div> : null}</> : <EmptyMarket icon={<Gift />} title={watchOnly ? "В избранном пока пусто" : "Ничего не найдено"} text={watchOnly ? "Сохраняй интересные лоты звездой." : data.liquidity?.playerOnly ? "Активных лотов игроков пока нет." : "Активных лотов пока нет."} action={<button disabled={bootstrapLoading || Boolean(data.liquidity?.playerOnly)} onClick={watchOnly ? () => setWatchOnly(false) : data.totalGifts === 0 && !data.liquidity?.playerOnly ? () => void bootstrapGifts() : resetGiftFilters} className="inline-flex rounded-[14px] bg-[var(--panel-3)] px-4 py-2.5 text-[11px] font-medium disabled:opacity-50">{watchOnly ? "Показать всё" : data.liquidity?.playerOnly ? "Ждём лоты игроков" : data.totalGifts === 0 ? (bootstrapLoading ? "Загружаем…" : "Загрузить подарки") : "Сбросить фильтры"}</button>} />}</div>
        ) : giftMode === "collections" ? (
          <MarketCollectionsView collections={visibleCollectionCards} loading={modeLoading} error={modeError} onRetry={() => void loadGiftMode("collections")} cartIds={cartIds} busyCollection={collectionCartBusy} onAddPreviews={addCollectionPreviewToCart} />
        ) : (
          <MarketFeedView items={visibleFeedItems} loading={modeLoading} error={modeError} onRetry={() => void loadGiftMode("feed")} />
        )
      ) : (
        <div>
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-soft)] py-2.5"><div className="flex items-center gap-2 text-sm font-medium"><Flame size={15} className="text-[var(--accent)]" />{coinSort === "gainers" ? "Лидеры роста" : coinSort === "volume" ? "Объём" : coinSort === "marketcap" ? "Капитализация" : "Новые мемкоины"}</div><span className="text-[9px] text-[var(--muted)]">{loading ? "Загрузка…" : `${coins.length} активов`}</span></div>
          {loading ? <RowsSkeleton /> : coins.length ? <div className="divide-y divide-[var(--border-soft)]">{coins.map((coin, index) => <CoinRow key={coin.id} coin={coin} index={index + 1} watched={watchedCoins.has(coin.id)} busy={watchBusy === `coin:${coin.id}`} onWatch={toggleWatch} />)}</div> : <EmptyMarket icon={<BarChart3 />} title={watchOnly ? "В избранном нет мемкоинов" : "Мемкоинов пока нет"} text={watchOnly ? "Добавьте мемкоин в избранное." : "Мемкоинов пока нет."} action={<Link href={watchOnly ? "/market" : "/create"} onClick={watchOnly ? () => setWatchOnly(false) : undefined} className={`inline-flex rounded-2xl px-4 py-2.5 text-sm font-semibold ${watchOnly ? "bg-[var(--panel-3)]" : "bg-[var(--accent)] text-black"}`}>{watchOnly ? "Показать всё" : "Создать мемкоин"}</Link>} />}
        </div>
      )}

      {tab === "gifts" && data.cartIds.length ? <Link href="/cart" className="fixed bottom-[calc(68px+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-[17px] border border-[rgba(198,170,88,.25)] bg-[rgba(19,20,22,.96)] px-4 py-2.5 text-[11px] font-semibold mxm-floating-glass shadow-[0_10px_28px_rgba(0,0,0,.38)] lg:bottom-5"><ShoppingCart size={14} className="text-[var(--accent)]"/><span>Корзина · {data.cartIds.length}</span></Link> : null}
    </div>
  );
}


function MarketCollectionsView({ collections, loading, error, onRetry, cartIds, busyCollection, onAddPreviews }: { collections: MarketCollectionCard[]; loading: boolean; error: string | null; onRetry: () => void; cartIds: Set<string>; busyCollection: string | null; onAddPreviews: (card: MarketCollectionCard) => void }) {
  if (loading) return <RowsSkeleton />;
  if (error) return <div className="mxm-alert mxm-alert-error flex items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={onRetry} className="rounded-xl border border-[var(--border)] px-2.5 py-1.5 text-[10px]">Повторить</button></div>;
  if (!collections.length) return <EmptyMarket icon={<Layers3 />} title="Коллекций с лотами пока нет" text="Как только владельцы начнут выставлять подарки, коллекции появятся здесь автоматически." action={<span className="text-[10px] text-[var(--muted)]">Только реальные активные лоты</span>} />;

  return <div className="mxm-collection-grid grid gap-3 md:grid-cols-2">{collections.map((item) => {
    const previews = item.previews.slice(0, 3);
    const canAdd = previews.some((gift) => !cartIds.has(gift.virtualGiftId));
    return <article key={item.baseName} className="mxm-collection-card">
      <div className="mxm-collection-card-head">
        <Link href={`/collections/${encodeURIComponent(item.baseName)}`} className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold tracking-[-.018em] text-white">{item.baseName}</h3>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[9px] text-[var(--muted)]">
            <span>{item.listedCount} {russianPlural(item.listedCount, "лот", "лота", "лотов")}</span>
            <span className="text-[var(--muted-2)]">·</span>
            <span>{item.floorPrice == null ? "цена не определена" : <>от {money(item.floorPrice)}</>}</span>
          </p>
        </Link>
        <span className="mxm-collection-count" title="Активные лоты"><Gift size={12} strokeWidth={2} /><span>{item.listedCount}</span></span>
      </div>

      <div className="mxm-collection-previews">
        {previews.map((gift) => <Link href={`/gifts/${gift.virtualGiftId}`} key={gift.virtualGiftId} className="mxm-collection-preview">
          <div className="relative aspect-square overflow-hidden">
            <div className="absolute inset-0 grid place-items-center text-[var(--muted)]"><Gift size={20} /></div>
            {gift.imageUrl ? <img src={gift.imageUrl} alt={`${item.baseName} #${gift.giftNumber}`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.opacity = "0"; }} className="relative h-full w-full object-cover" /> : null}
            <span className="mxm-collection-preview-number">#{gift.giftNumber}</span>
          </div>
        </Link>)}
        {Array.from({ length: Math.max(0, 3 - previews.length) }, (_, index) => <div key={`empty-${index}`} className="mxm-collection-preview grid aspect-square place-items-center text-[var(--muted-2)]"><Gift size={18} /></div>)}
      </div>

      <div className="mxm-collection-card-actions">
        <Link href={`/collections/${encodeURIComponent(item.baseName)}`} className="mxm-collection-cheapest">
          {item.previewTotal > 0 ? <><span>{previews.length} самых дешёвых</span><span className="mxm-collection-cheapest-price"><Gem size={10} fill="currentColor" />{money(item.previewTotal)}</span></> : <span>Открыть коллекцию</span>}
        </Link>
        <button type="button" disabled={busyCollection === item.baseName || !canAdd} onClick={() => onAddPreviews(item)} aria-label="Добавить самые дешёвые подарки в корзину" className="mxm-collection-cart">
          {busyCollection === item.baseName ? <RefreshCw size={14} className="animate-spin" /> : <ShoppingCart size={15} />}
        </button>
      </div>
    </article>;
  })}</div>;
}

function russianPlural(value: number, one: string, few: string, many: string) {
  const n = Math.abs(Math.trunc(value));
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function MarketFeedView({ items, loading, error, onRetry }: { items: ActivityItem[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <RowsSkeleton />;
  if (error) return <div className="mxm-alert mxm-alert-error flex items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={onRetry} className="rounded-xl border border-[var(--border)] px-2.5 py-1.5 text-[10px]">Повторить</button></div>;
  if (!items.length) return <EmptyMarket icon={<List />} title="Лента пока пуста" text="Здесь появятся новые сделки и лоты." action={<button type="button" onClick={onRetry} className="rounded-[13px] bg-[var(--panel-3)] px-3 py-2 text-[10px]">Обновить</button>} />;
  return <div className="space-y-1.5">{items.map((item) => <Link href={item.href} key={item.id} className="mxm-feed-row grid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[14px] border border-[var(--border-soft)] bg-[var(--panel)] px-2.5 py-2">
    <div className="relative h-[38px] w-[38px] overflow-hidden rounded-[10px] bg-[var(--panel-2)]"><div className="absolute inset-0 grid place-items-center text-[var(--muted)]">{item.kind === "coin" || item.kind === "launch" ? <Coins size={14} /> : <Gift size={14} />}</div>{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.opacity = "0"; }} className="relative h-full w-full object-cover" /> : null}</div>
    <div className="min-w-0"><p className="truncate text-[11px] font-medium">{item.detail}</p><p className={`mt-1 truncate text-[9px] ${item.kind === "listing" ? "text-[var(--accent)]" : item.kind === "reprice" ? "text-[#8eb8d8]" : "text-[var(--muted)]"}`}>{item.label}</p></div>
    <div className="shrink-0 text-right">{item.amount != null && Number.isFinite(item.amount) ? <p className="text-[11px] font-medium">{money(item.amount)}</p> : null}<p className="mt-1 text-[8px] text-[var(--muted-2)]">{formatMarketTime(item.createdAt)}</p></div>
  </Link>)}</div>;
}

function formatMarketTime(value: string) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return "—";
  return time.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const CoinRow = memo(function CoinRow({ coin, index, watched, busy, onWatch }: { coin: Coin; index: number; watched: boolean; busy: boolean; onWatch: (kind: "coin" | "gift_collection", id: string, enabled: boolean) => void }) {
  const flowTotal = coin.buyVolume24h + coin.sellVolume24h;
  const buyShare = flowTotal > 0 ? Math.round((coin.buyVolume24h / flowTotal) * 100) : 0;
  const boosted = Boolean(coin.boostedUntil);
  return <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2.5 md:grid-cols-[minmax(0,1.25fr)_0.7fr_0.72fr_0.72fr_auto] ${boosted ? "rounded-[16px] border border-[rgba(198,170,88,.24)] bg-[linear-gradient(90deg,rgba(198,170,88,.11),rgba(198,170,88,.025))] px-2" : ""}`}>
    <Link href={`/coin/${coin.id}`} className="flex min-w-0 items-center gap-2.5"><span className="w-4 text-[10px] text-[var(--muted)]">{index}</span><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}{boosted ? <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-[rgba(198,170,88,.16)] px-1.5 py-0.5 align-middle text-[8px] font-semibold uppercase tracking-wide text-[var(--accent)]"><Sparkles size={8} />Продвижение</span> : null}</p><p className="truncate text-[10px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} · {buyShare}% покупок</p></div></Link>
    <Link href={`/coin/${coin.id}`} className="text-right md:text-left"><p className="text-xs font-medium">{price(coin.currentPrice)}</p><p className={`text-[10px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></Link>
    <Link href={`/coin/${coin.id}`} className="hidden md:block"><p className="text-[9px] text-[var(--muted)]">Капитализация</p><p className="mt-0.5 text-xs">{money(coin.marketCap)}</p></Link>
    <Link href={`/coin/${coin.id}`} className="hidden md:block"><p className="text-[9px] text-[var(--muted)]">Объём 24ч</p><p className="mt-0.5 text-xs">{money(coin.volume24h)}</p></Link>
    <button disabled={busy} onClick={() => onWatch("coin", coin.id, !watched)} aria-label={watched ? "Убрать мемкоин из избранного" : "Добавить мемкоин в избранное"} className={`grid h-8 w-8 place-items-center rounded-2xl ${watched ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}><Star size={14} fill={watched ? "currentColor" : "none"} /></button>
  </div>;
});

const HotNowStrip = memo(function HotNowStrip({ tab, coins, collections, loading }: { tab: "gifts" | "coins"; coins: Coin[]; collections: GiftCollection[]; loading: boolean }) {
  const hasItems = tab === "gifts" ? collections.length > 0 : coins.length > 0;
  return <section className="mxm-market-pulse mb-4 border-y border-[var(--border-soft)] py-2.5" aria-label="В тренде">
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[.12em]"><Flame size={14} className="text-[var(--accent)]" />В ТРЕНДЕ</span>
      
    </div>
    {loading ? <div className="mxm-skeleton h-[62px] rounded-[15px]" /> : hasItems ? <div className="mxm-hscroll gap-2">
      {tab === "gifts" ? collections.map((item, index) => <Link key={item.baseName} href={`/collections/${encodeURIComponent(item.baseName)}`} className="flex min-w-[220px] shrink-0 items-center justify-between gap-3 rounded-[15px] bg-[var(--panel-2)] px-3 py-2.5">
        <div className="min-w-0"><p className="truncate text-[11px] font-medium"><span className="mr-1.5 text-[9px] text-[var(--muted)]">#{index + 1}</span>{item.baseName}</p><p className="mt-1 text-[9px] text-[var(--muted)]">{item.tradeCount24h} сделок · {item.holderCount} держателей</p></div>
        <div className="shrink-0 text-right"><p className="text-[10px] font-medium">{money(item.volume24h)}</p><p className={`mt-1 text-[9px] ${item.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(item.change24h)}</p></div>
      </Link>) : coins.map((coin, index) => <Link key={coin.id} href={`/coin/${coin.id}`} className="flex min-w-[220px] shrink-0 items-center gap-2.5 rounded-[15px] bg-[var(--panel-2)] px-3 py-2.5">
        <span className="text-[9px] text-[var(--muted)]">#{index + 1}</span><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} />
        <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{coin.name} <span className="text-[var(--muted)]">${coin.symbol}</span></p><p className="mt-1 text-[9px] text-[var(--muted)]">{coin.tradeCount24h} сделок · {coin.holderCount} держателей</p></div>
        <div className="shrink-0 text-right"><p className="text-[10px] font-medium">{money(coin.volume24h)}</p><p className={`mt-1 text-[9px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(coin.change24h)}</p></div>
      </Link>)}
    </div> : <p className="py-2 text-[10px] text-[var(--muted)]">Пока мало активности.</p>}
  </section>;
});

function EmptyMarket({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode }) { return <div className="p-7 text-center"><div className="mx-auto grid h-8 w-8 place-items-center text-[var(--muted)]">{icon}</div><p className="mt-3 text-xs font-medium">{title}</p><p className="mx-auto mt-1 max-w-sm text-[11px] leading-5 text-[var(--muted)]">{text}</p><div className="mt-4">{action}</div></div>; }
function GridSkeleton() { return <div className="market-grid grid gap-x-2.5 gap-y-5 md:gap-x-3">{Array.from({ length: 8 }, (_, index) => <div key={index}><div className="mxm-skeleton aspect-square rounded-[18px]" /><div className="mt-2.5 px-0.5"><div className="mxm-skeleton h-3.5 w-2/3 rounded" /><div className="mxm-skeleton mt-2 h-3 w-1/2 rounded" /></div></div>)}</div>; }
function RowsSkeleton() { return <div className="p-3"><div className="mxm-skeleton h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /><div className="mxm-skeleton mt-2 h-14 rounded-2xl" /></div>; }
